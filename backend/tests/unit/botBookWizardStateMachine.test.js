'use strict';

const institutionTime = require('../../lib/institutionTime');
const wizard = require('../../services/messaging/bookWizard');

afterEach(() => institutionTime.resetClock());

const B1 = { id: 1, name: 'Storica' };
const B2 = { id: 2, name: 'Nuova' };
const TYPES = [
  { code: 'studio_individuale', label: 'Studio individuale' },
  { code: 'lezione', label: 'Lezione' },
];

function makeDeps({
  buildings = [B1, B2],
  types = TYPES,
  rooms = { A1: { id: 10, name: 'Aula 1' } },
} = {}) {
  return {
    listActiveBuildings: vi.fn(async () => buildings),
    findRoomByQuery: vi.fn(async (q) => rooms[q] ?? null),
    listActiveBookingTypes: vi.fn(async () => types),
    finalize: vi.fn(async ({ slots }) => ({ reply: 'FATTO', slots })),
  };
}

describe('bookWizard · transizioni (senza DB)', () => {
  it('isWizardState riconosce solo gli stati book_room.*', () => {
    expect(wizard.isWizardState('book_room.when')).toBe(true);
    expect(wizard.isWizardState(null)).toBe(false);
    expect(wizard.isWizardState('altro')).toBe(false);
  });

  it('start senza argomenti con 2 sedi → chiede la sede', async () => {
    const r = await wizard.start({ args: '', session: {} }, makeDeps());
    expect(r.session.state).toBe('book_room.building');
    expect(r.reply).toContain('Quale sede');
  });

  it('mono-sede: salta la sede e chiede l’aula', async () => {
    const r = await wizard.start({ args: '', session: {} }, makeDeps({ buildings: [B1] }));
    expect(r.session.state).toBe('book_room.room');
    expect(r.session.slots.buildingId).toBe(1);
  });

  it('nessuna sede → reset', async () => {
    const r = await wizard.start({ args: '', session: {} }, makeDeps({ buildings: [] }));
    expect(r.session).toEqual({ state: null, slots: null });
  });

  it('sede → aula → quando → tipo → conferma → finalize', async () => {
    const deps = makeDeps();
    let r = await wizard.step(
      { text: '2', session: { state: 'book_room.building', slots: {} } },
      deps,
    );
    expect(r.session.state).toBe('book_room.room');
    expect(r.session.slots.buildingName).toBe('Nuova');

    r = await wizard.step({ text: 'A1', session: r.session }, deps);
    expect(r.session.state).toBe('book_room.when');
    expect(r.session.slots.roomId).toBe(10);
    expect(deps.findRoomByQuery).toHaveBeenCalledWith('A1', { buildingId: 2 });

    r = await wizard.step({ text: '2026-05-15 14-15', session: r.session }, deps);
    expect(r.session.state).toBe('book_room.type');
    // 14:00 Roma (CEST) = 12:00 UTC, qualunque sia il TZ del processo
    expect(r.session.slots.startTime).toBe('2026-05-15T12:00:00.000Z');
    expect(r.session.slots.endTime).toBe('2026-05-15T13:00:00.000Z');

    r = await wizard.step({ text: 'lezione', session: r.session }, deps);
    expect(r.session.state).toBe('book_room.confirm');
    expect(r.reply).toContain('ven 15 mag 14:00–15:00');

    r = await wizard.step({ text: 'si', session: r.session }, deps);
    expect(deps.finalize).toHaveBeenCalledOnce();
    expect(r.slots.type).toBe('lezione');
  });

  it('shortcut a 4 token salta direttamente alla conferma', async () => {
    const deps = makeDeps({ buildings: [B1] });
    const r = await wizard.start({ args: 'A1 2026-01-15 9-10:30 lezione', session: {} }, deps);
    expect(r.session.state).toBe('book_room.confirm');
    // inverno: 09:00 Roma = 08:00 UTC
    expect(r.session.slots.startTime).toBe('2026-01-15T08:00:00.000Z');
    expect(r.session.slots.endTime).toBe('2026-01-15T09:30:00.000Z');
  });

  it('oggi/domani seguono l’orologio istituzionale', async () => {
    institutionTime.setClock(institutionTime.fixedClock('2026-05-13T22:30:00Z')); // 00:30 del 14 a Roma
    const deps = makeDeps({ buildings: [B1], types: [TYPES[0]] });
    const r = await wizard.start({ args: 'A1 oggi 10-11', session: {} }, deps);
    expect(r.session.slots.startTime).toBe('2026-05-14T08:00:00.000Z');
  });

  it('errori: sede, aula, quando, tipo non riconosciuti restano nello stesso step', async () => {
    const deps = makeDeps();
    let r = await wizard.step(
      { text: 'zzz', session: { state: 'book_room.building', slots: {} } },
      deps,
    );
    expect(r.session.state).toBe('book_room.building');

    r = await wizard.step(
      {
        text: 'nope',
        session: { state: 'book_room.room', slots: { buildingId: 1, buildingName: 'Storica' } },
      },
      deps,
    );
    expect(r.session.state).toBe('book_room.room');

    const base = { buildingId: 1, buildingName: 'Storica', roomId: 10, roomName: 'Aula 1' };
    r = await wizard.step(
      { text: 'solo', session: { state: 'book_room.when', slots: base } },
      deps,
    );
    expect(r.session).toBeUndefined();
    r = await wizard.step(
      { text: 'boh 14-15', session: { state: 'book_room.when', slots: base } },
      deps,
    );
    expect(r.session.state).toBe('book_room.when');

    const withTime = { ...base, startTime: 'x', endTime: 'y' };
    r = await wizard.step(
      { text: 'xx', session: { state: 'book_room.type', slots: withTime } },
      deps,
    );
    expect(r.session.state).toBe('book_room.type');
  });

  it('conferma: no annulla, risposta ambigua richiede si/no', async () => {
    const deps = makeDeps();
    const session = { state: 'book_room.confirm', slots: { roomId: 1 } };
    let r = await wizard.step({ text: 'no', session }, deps);
    expect(r.session).toEqual({ state: null, slots: null });
    r = await wizard.step({ text: 'forse', session }, deps);
    expect(r.reply).toContain('Rispondi');
    expect(deps.finalize).not.toHaveBeenCalled();
  });
});
