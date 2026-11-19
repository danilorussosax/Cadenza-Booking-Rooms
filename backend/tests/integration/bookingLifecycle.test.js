'use strict';

/**
 * Integrazione: services/bookingLifecycle (book / bookSeries / move / approve / cancel).
 *
 * Matrice canale x politica aula x origine x conflitto. Gli effetti si
 * asseriscono tramite le righe prodotte (MailOutbox, BookingWaitlist,
 * Booking), non spiando i metodi interni.
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const { Booking, BookingWaitlist, MailOutbox } = require('../../models');
const lifecycle = require('../../services/bookingLifecycle');
const {
  createAuthedUser,
  createAdmin,
  createCourse,
  createRoom,
  createBookingRule,
  createBooking,
} = require('../factories');

const app = buildApp({ serveFrontend: false });

async function setup({ requiresApproval = false } = {}) {
  const course = await createCourse();
  const { user: student } = await createAuthedUser({
    role: 'studente',
    courseId: course.id,
    matricola: `LC-${Math.random().toString(36).slice(2, 8)}`,
  });
  await createBookingRule({ role: 'studente' });
  const { user: admin } = await createAdmin();
  const room = await createRoom({ requiresApproval });
  return { student, admin, room };
}

function slot(offsetHours = 24) {
  const start = dayjs().add(offsetHours, 'hour').minute(0).second(0).millisecond(0);
  return { startTime: start.toDate(), endTime: start.add(1, 'hour').toDate() };
}

const mailKinds = async () => (await MailOutbox.findAll()).map((m) => m.kind).sort();

describe('bookingLifecycle.book — canale x politica aula', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  const channels = [
    { name: 'web (default)', params: {}, ownerMail: true },
    { name: 'bot (senza mail utente)', params: { notifyOwner: false }, ownerMail: false },
  ];

  for (const ch of channels) {
    it(`${ch.name}, aula libera: confirmed + ${ch.ownerMail ? 'mail conferma' : 'nessuna mail'}`, async () => {
      const { student, room } = await setup();
      const { booking, status } = await lifecycle.book({
        actor: student,
        roomId: room.id,
        ...slot(),
        ...ch.params,
      });
      expect(status).toBe('confirmed');
      expect(booking.origin).toBe('manual');
      expect(await mailKinds()).toEqual(ch.ownerMail ? ['confirmation'] : []);
    });

    it(`${ch.name}, aula con approvazione: pending + notifica admin (non l'utente)`, async () => {
      const { student, admin, room } = await setup({ requiresApproval: true });
      const { status } = await lifecycle.book({
        actor: student,
        roomId: room.id,
        ...slot(),
        ...ch.params,
      });
      expect(status).toBe('pending_approval');
      const rows = await MailOutbox.findAll();
      expect(rows.map((r) => r.kind)).toEqual(['booking_pending_admin']);
      expect(rows[0].to).toBe(admin.email);
    });
  }

  it('admin su aula con approvazione: confirmed (bypass)', async () => {
    const { admin, room } = await setup({ requiresApproval: true });
    await createBookingRule({ role: 'admin' });
    const { status } = await lifecycle.book({ actor: admin, roomId: room.id, ...slot() });
    expect(status).toBe('confirmed');
  });

  it("admin per conto di un utente: stato dell'admin, proprietario l'utente, quote bypassate", async () => {
    const { student, admin, room } = await setup({ requiresApproval: true });
    await createBookingRule({ role: 'admin' });
    const { booking } = await lifecycle.book({
      actor: admin,
      owner: student,
      roomId: room.id,
      ...slot(),
      bypass: { quotas: true },
    });
    expect(booking.userId).toBe(student.id);
    expect(booking.status).toBe('confirmed');
  });
});

describe('bookingLifecycle.book — origine', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it("'monte_ore' ammessa come parametro e persistita", async () => {
    const { student, room } = await setup();
    const { booking } = await lifecycle.book({
      actor: student,
      roomId: room.id,
      ...slot(),
      origin: 'monte_ore',
      notifyOwner: false,
    });
    expect(booking.origin).toBe('monte_ore');
    const row = await Booking.findByPk(booking.id);
    expect(row.origin).toBe('monte_ore');
  });

  it('origine sconosciuta rifiutata con BookingError', async () => {
    const { student, room } = await setup();
    await expect(
      lifecycle.book({ actor: student, roomId: room.id, ...slot(), origin: 'altro' }),
    ).rejects.toBeInstanceOf(lifecycle.BookingError);
  });

  it('il collegamento opzionale `within` gira nella stessa transazione', async () => {
    const { student, room } = await setup();
    let seen = null;
    const { booking } = await lifecycle.book({
      actor: student,
      roomId: room.id,
      ...slot(),
      within: async (t, b) => {
        seen = { id: b.id, hasTx: !!t };
      },
    });
    expect(seen).toEqual({ id: booking.id, hasTx: true });
  });
});

describe('bookingLifecycle.book — conflitto', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('slot occupato: BookingError 400 BOOKING_CONFLICT, nessuna riga e nessuna mail', async () => {
    const { student, room } = await setup();
    const s = slot();
    await createBooking({ room, ...s });
    await expect(lifecycle.book({ actor: student, roomId: room.id, ...s })).rejects.toMatchObject({
      status: 400,
      code: 'BOOKING_CONFLICT',
    });
    expect(await Booking.count()).toBe(1);
    expect(await mailKinds()).toEqual([]);
  });

  it('invalidStatus/invalidCode configurabili (canale lista d’attesa)', async () => {
    const { student, room } = await setup();
    const s = slot();
    await createBooking({ room, ...s });
    await expect(
      lifecycle.book({
        actor: student,
        roomId: room.id,
        ...s,
        invalidStatus: 409,
        invalidCode: 'BOOKING_CONFLICT',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'BOOKING_CONFLICT' });
  });

  it('mappa gli errori di vincolo DB in codici stabili', () => {
    const unique = lifecycle.toBookingError({ name: 'SequelizeUniqueConstraintError' });
    expect(unique).toMatchObject({ status: 409, code: 'BOOKING_CONFLICT' });
    const excl = lifecycle.toBookingError({ name: 'SequelizeExclusionConstraintError' });
    expect(excl).toMatchObject({ status: 409, code: 'BOOKING_CONFLICT' });
    const fk = lifecycle.toBookingError({ name: 'SequelizeForeignKeyConstraintError' });
    expect(fk).toMatchObject({ status: 400, code: 'FK_CONSTRAINT' });
    const other = new Error('boom');
    expect(lifecycle.toBookingError(other)).toBe(other);
  });

  it('normalizeValidation allinea errors[]/codes[] anche senza codes', () => {
    const n = lifecycle.normalizeValidation({
      valid: false,
      errors: ['a', 'b'],
      codes: [null, 'X'],
    });
    expect(n.issues).toEqual([
      { message: 'a', code: null },
      { message: 'b', code: 'X' },
    ]);
    expect(n.code).toBe('X');
    expect(lifecycle.normalizeValidation({ valid: false, errors: ['Date non valide'] }).code).toBe(
      null,
    );
  });
});

describe('bookingLifecycle.cancel — promozione lista d’attesa esplicita', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('annullo: aggiorna lo stato, invia la mail e promuove il primo in coda', async () => {
    const { student, room } = await setup();
    const { user: waiting } = await createAuthedUser({ role: 'studente' });
    const s = slot();
    const booking = await createBooking({ user: student, room, ...s });
    const entry = await BookingWaitlist.create({
      userId: waiting.id,
      roomId: room.id,
      startTime: s.startTime,
      endTime: s.endTime,
      position: 0,
      type: 'studio_individuale',
    });

    const { cancelled } = await lifecycle.cancel({
      id: booking.id,
      actor: student,
      checkPermission: true,
      reason: 'imprevisto',
      mail: 'cancellation',
    });
    expect(cancelled).toBe(true);

    const row = await Booking.findByPk(booking.id);
    expect(row.status).toBe('cancelled');
    expect(row.cancelReason).toBe('imprevisto');
    expect(row.cancelledAt).toBeTruthy();
    await entry.reload();
    expect(entry.notifiedAt).toBeTruthy();
    // La mail claim_waitlist dipende dal transporter SMTP (assente nei test):
    // la promozione si osserva sulla riga di coda.
    expect(await mailKinds()).toEqual(['cancellation']);
  });

  it('promote:false: nessuna notifica alla coda (periodo non prenotabile)', async () => {
    const { student, room } = await setup();
    const { user: waiting } = await createAuthedUser({ role: 'studente' });
    const s = slot();
    const booking = await createBooking({ user: student, room, ...s });
    const entry = await BookingWaitlist.create({
      userId: waiting.id,
      roomId: room.id,
      startTime: s.startTime,
      endTime: s.endTime,
      position: 0,
      type: 'studio_individuale',
    });
    await lifecycle.cancel({ booking, promote: false });
    await entry.reload();
    expect(entry.notifiedAt).toBeNull();
  });

  it('update condizionale: stato cambiato nel frattempo => cancelled:false, nessun effetto', async () => {
    const { student, room } = await setup();
    const booking = await createBooking({ user: student, room, ...slot() });
    await Booking.update({ status: 'cancelled' }, { where: { id: booking.id } });
    const r = await lifecycle.cancel({
      booking,
      expectStatuses: ['confirmed', 'pending_approval'],
      mail: 'cancellation',
    });
    expect(r.cancelled).toBe(false);
    expect(await mailKinds()).toEqual([]);
  });

  it('checkPermission: utente non proprietario => 403', async () => {
    const { student, room } = await setup();
    const { user: other } = await createAuthedUser({ role: 'studente' });
    const booking = await createBooking({ user: student, room, ...slot() });
    await expect(
      lifecycle.cancel({ id: booking.id, actor: other, checkPermission: true }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('cancelMany: annulla tutto in una tx e invia una mail per prenotazione', async () => {
    const { student, room } = await setup();
    const a = await createBooking({ user: student, room, ...slot(30) });
    const b = await createBooking({ user: student, room, ...slot(40) });
    const done = await lifecycle.cancelMany({
      bookings: [a, b],
      reason: 'bulk',
      mail: 'cancellation',
    });
    expect(done).toHaveLength(2);
    expect(await Booking.count({ where: { status: 'cancelled' } })).toBe(2);
    expect(await mailKinds()).toEqual(['cancellation', 'cancellation']);
  });
});

describe('bookingLifecycle.approve / move', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('approve: pending -> confirmed + mail booking_approved', async () => {
    const { student, room } = await setup({ requiresApproval: true });
    const { booking } = await lifecycle.book({ actor: student, roomId: room.id, ...slot() });
    await MailOutbox.destroy({ where: {} });
    const { booking: approved } = await lifecycle.approve({ bookingId: booking.id });
    expect(approved.status).toBe('confirmed');
    expect(await mailKinds()).toEqual(['booking_approved']);
  });

  it('approve su prenotazione non pending => BOOKING_INVALID_STATE', async () => {
    const { student, room } = await setup();
    const b = await createBooking({ user: student, room, ...slot() });
    await expect(lifecycle.approve({ bookingId: b.id })).rejects.toMatchObject({
      status: 400,
      code: 'BOOKING_INVALID_STATE',
    });
  });

  it('move verso aula con approvazione: torna pending e notifica gli admin', async () => {
    const { student, admin, room } = await setup();
    const target = await createRoom({ requiresApproval: true, buildingId: room.buildingId });
    const b = await createBooking({ user: student, room, ...slot() });
    const { booking } = await lifecycle.move({
      bookingId: b.id,
      actor: student,
      changes: { roomId: target.id },
    });
    expect(booking.status).toBe('pending_approval');
    const rows = await MailOutbox.findAll();
    expect(rows.map((r) => [r.kind, r.to])).toEqual([['booking_pending_admin', admin.email]]);
  });
});

describe('bookingLifecycle.bookSeries', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('serie in aula con approvazione: UNA sola notifica admin per l’intera serie', async () => {
    const { student, room } = await setup({ requiresApproval: true });
    const { BookingRecurrence } = require('../../models');
    const occurrences = [24, 48, 72].map((h) => slot(h));
    const { created, status } = await lifecycle.bookSeries({
      actor: student,
      roomId: room.id,
      occurrences,
      createSeries: (t) =>
        BookingRecurrence.create(
          {
            userId: student.id,
            roomId: room.id,
            frequency: 'daily',
            interval: 1,
            byWeekday: null,
            startDate: dayjs().format('YYYY-MM-DD'),
            endDate: dayjs().add(5, 'day').format('YYYY-MM-DD'),
            excludeDates: [],
          },
          { transaction: t },
        ),
    });
    expect(status).toBe('pending_approval');
    expect(created).toHaveLength(3);
    expect(await mailKinds()).toEqual(['booking_pending_admin']);
  });
});

describe('regressione: quick-book da modello notifica gli admin (pending_approval)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('POST /templates/:id/quick-book su aula con approvazione => riga booking_pending_admin', async () => {
    const course = await createCourse();
    const { user, authHeader } = await createAuthedUser({
      role: 'studente',
      courseId: course.id,
      matricola: 'TPL-REG',
    });
    await createBookingRule({ role: 'studente' });
    const { user: admin } = await createAdmin();
    const room = await createRoom({ requiresApproval: true });

    const create = await request(app)
      .post('/api/bookings/templates')
      .set('Authorization', authHeader)
      .send({
        name: 'Concerto',
        roomId: room.id,
        dayOfWeek: dayjs().add(1, 'day').day(),
        startMinutes: 9 * 60,
        durationMinutes: 60,
        type: 'studio_individuale',
      });
    expect(create.status).toBe(201);
    const tplId = create.body.template?.id ?? create.body.id;

    const res = await request(app)
      .post(`/api/bookings/templates/${tplId}/quick-book`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('pending_approval');

    const rows = await MailOutbox.findAll();
    expect(rows.map((r) => [r.kind, r.to])).toEqual([['booking_pending_admin', admin.email]]);
    expect(user.id).toBe(res.body.booking.userId);
  });
});
