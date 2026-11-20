'use strict';

/**
 * Integrazione: services/removal (cascata istituto/edifici/aule/utente).
 * Senza HTTP; l'adattatore file e' un registratore iniettato.
 */

const { Booking, Room, Building, Institute, User, MonteOreProposal } = require('../../models');
const removal = require('../../services/removal');
const {
  createInstitute,
  createBuilding,
  createRoom,
  createUser,
  createBooking,
} = require('../factories');

function recorder() {
  const calls = [];
  return {
    calls,
    removeStored: vi.fn(async (u) => calls.push(['stored', u])),
    removeProfilePhoto: vi.fn(async (u) => calls.push(['profile', u])),
  };
}

function fkError() {
  return Object.assign(new Error('fk'), { name: 'SequelizeForeignKeyConstraintError' });
}

async function tree() {
  const institute = await createInstitute({ logoUrl: '/storage/logo.png' });
  const building = await createBuilding({ institute });
  const room = await createRoom({ building, photoUrl: '/storage/room1.webp' });
  const user = await createUser();
  const booking = await createBooking({ room, user });
  return { institute, building, room, user, booking };
}

describe('services/removal', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    vi.restoreAllMocks();
  });

  it('removeInstitute: cascata completa (prenotazioni, aule, edifici, istituto) e file', async () => {
    const { institute, building, room, booking } = await tree();
    const files = recorder();
    const r = await removal.removeInstitute(institute.id, { files });
    expect(r).toMatchObject({ removedBookings: 1, removedRooms: 1, removedBuildings: 1 });
    expect(await Booking.findByPk(booking.id)).toBeNull();
    expect(await Room.findByPk(room.id)).toBeNull();
    expect(await Room.findByPk(room.id, { paranoid: false })).not.toBeNull();
    expect(await Building.findByPk(building.id)).toBeNull();
    expect(await Institute.findByPk(institute.id)).toBeNull();
    expect(files.calls).toEqual(
      expect.arrayContaining([
        ['stored', '/storage/room1.webp'],
        ['stored', '/storage/logo.png'],
      ]),
    );
  });

  it('removeInstitute: istituto inesistente -> 404', async () => {
    await expect(removal.removeInstitute(99999, { files: recorder() })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('removeBuildings: aule e prenotazioni dentro la cascata', async () => {
    const { building, room, booking } = await tree();
    const files = recorder();
    const r = await removal.removeBuildings([building.id], { files });
    expect(r).toEqual({
      deleted: 1,
      removedRooms: 1,
      removedBookings: 1,
      cancelledBookings: 0,
    });
    expect(await Room.findByPk(room.id)).toBeNull();
    expect(await Booking.findByPk(booking.id)).toBeNull();
    expect(files.calls).toEqual([['stored', '/storage/room1.webp']]);
  });

  it('removeRooms: elimina aule e prenotazioni, rimuove la foto', async () => {
    const { room, booking } = await tree();
    const files = recorder();
    const r = await removal.removeRooms([room.id], { files });
    expect(r).toMatchObject({ deleted: 1, removedBookings: 1 });
    expect(await Booking.findByPk(booking.id)).toBeNull();
    expect(files.calls).toEqual([['stored', '/storage/room1.webp']]);
  });

  it('rollback su errore: nulla cancellato e nessun file rimosso', async () => {
    const { building, room, booking } = await tree();
    const files = recorder();
    vi.spyOn(Building, 'destroy').mockRejectedValueOnce(new Error('boom'));
    await expect(removal.removeBuildings([building.id], { files })).rejects.toThrow('boom');
    expect(await Room.findByPk(room.id)).not.toBeNull();
    expect(await Booking.findByPk(booking.id)).not.toBeNull();
    expect(files.calls).toEqual([]);
  });

  it('FK -> 409 unico, con testo storico, e nessun file rimosso', async () => {
    const { room } = await tree();
    const files = recorder();
    vi.spyOn(Room, 'destroy').mockRejectedValueOnce(fkError());
    await expect(removal.removeRooms([room.id], { files })).rejects.toMatchObject({
      status: 409,
      message: 'Eliminazione bloccata da vincoli di integrità.',
    });
    expect(files.calls).toEqual([]);
  });

  it('FK su utente singolo -> 409 FK_CONSTRAINT', async () => {
    const user = await createUser();
    vi.spyOn(User, 'destroy').mockRejectedValueOnce(fkError());
    await expect(removal.removeUser(user.id, { files: recorder() })).rejects.toMatchObject({
      status: 409,
      code: 'FK_CONSTRAINT',
    });
  });

  it('file rimossi solo dopo il commit', async () => {
    const { room } = await tree();
    let roomGoneAtCleanup = null;
    const files = {
      removeStored: vi.fn(async () => {
        roomGoneAtCleanup = (await Room.findByPk(room.id)) === null;
      }),
      removeProfilePhoto: vi.fn(),
    };
    await removal.removeRooms([room.id], { files });
    expect(files.removeStored).toHaveBeenCalledTimes(1);
    expect(roomGoneAtCleanup).toBe(true);
  });

  it('errore del filesystem non fa fallire la rimozione', async () => {
    const { room } = await tree();
    const files = { removeStored: vi.fn().mockRejectedValue(new Error('EIO')) };
    await expect(removal.removeRooms([room.id], { files })).resolves.toMatchObject({ deleted: 1 });
  });

  it('removeUser: rimuove sempre la foto profilo, prenotazioni e proposte monte ore', async () => {
    const user = await createUser({ profilePhotoUrl: '/storage/user-1-a.webp' });
    const booking = await createBooking({ user });
    const proposal = await MonteOreProposal.create({
      userId: user.id,
      academicYear: '2027/2028',
      validFrom: '2027-11-01',
      validTo: '2028-06-30',
      status: 'draft',
    });
    const files = recorder();
    const r = await removal.removeUser(user.id, { files });
    expect(r).toMatchObject({ removedBookings: 1, removedMonteOreProposals: 1 });
    expect(await MonteOreProposal.findByPk(proposal.id)).toBeNull();
    expect(await User.findByPk(user.id)).toBeNull();
    expect(await Booking.findByPk(booking.id)).toBeNull();
    expect(files.calls).toEqual([['profile', '/storage/user-1-a.webp']]);
  });

  it('removeUser: prepare nella stessa transazione, rollback se fallisce', async () => {
    const user = await createUser({ profilePhotoUrl: '/storage/user-2-a.webp' });
    const files = recorder();
    await expect(
      removal.removeUser(user.id, {
        files,
        prepare: async (u, t) => {
          await u.update({ firstName: 'Anon' }, { transaction: t });
          throw new Error('stop');
        },
      }),
    ).rejects.toThrow('stop');
    const fresh = await User.findByPk(user.id);
    expect(fresh.firstName).not.toBe('Anon');
    expect(files.calls).toEqual([]);
  });

  it('removeUsers (bulk): foto di tutti gli utenti', async () => {
    const a = await createUser({ profilePhotoUrl: '/storage/user-3-a.webp' });
    const b = await createUser();
    const files = recorder();
    const r = await removal.removeUsers([a.id, b.id], { files });
    expect(r.deleted).toBe(2);
    expect(files.calls).toEqual([['profile', '/storage/user-3-a.webp']]);
  });

  it("politica 'cancel': annulla solo le future attive, non cancella la riga", async () => {
    const { room, user } = await tree();
    const past = await createBooking({
      room,
      user,
      startTime: new Date(Date.now() - 3 * 3600_000),
      endTime: new Date(Date.now() - 2 * 3600_000),
    });
    const r = await removal.removeUser(user.id, { bookings: 'cancel', files: recorder() });
    expect(r).toMatchObject({ removedBookings: 0, cancelledBookings: 1 });
    const rows = await Booking.findAll({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((b) => b.status === 'cancelled')).toHaveLength(1);
    expect((await Booking.findByPk(past.id)).status).toBe('confirmed');
  });

  it("politica 'purge' vs 'cancel' sulle aule", async () => {
    const { room, booking } = await tree();
    await removal.removeRooms([room.id], { bookings: 'cancel', files: recorder() });
    const kept = await Booking.findByPk(booking.id);
    expect(kept.status).toBe('cancelled');
  });

  it('politica non valida -> errore', async () => {
    await expect(removal.removeRooms([1], { bookings: 'boh' })).rejects.toThrow(/politica/);
  });
});
