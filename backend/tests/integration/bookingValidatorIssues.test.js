'use strict';

/**
 * validateBooking: forma strutturata dei problemi ({message, code}) e
 * calcolo di giorno/settimana nel fuso dell'istituto con orologio fisso.
 */

const institutionTime = require('../../lib/institutionTime');
const { validateBooking } = require('../../services/bookingValidator');
const { createAuthedUser, createBookingRule, createRoom, createBooking } = require('../factories');

afterEach(() => institutionTime.resetClock());

describe('validateBooking — issues strutturati', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('errors e codes sono derivati da issues e restano allineati', async () => {
    institutionTime.setClock(institutionTime.fixedClock('2026-11-02T08:00:00Z'));
    await createBookingRule({ role: 'docente', maxAdvanceDays: 30, minAdvanceHours: 0 });
    const { user } = await createAuthedUser({ role: 'docente' });
    const room = await createRoom();
    const start = new Date('2026-11-03T09:00:00Z');
    const end = new Date('2026-11-03T10:00:00Z');
    await createBooking({ room, startTime: start, endTime: end });

    const res = await validateBooking({ user, roomId: room.id, startTime: start, endTime: end });
    expect(res.valid).toBe(false);
    expect(res.issues).toContainEqual({
      message: 'Aula già prenotata in questa fascia oraria',
      code: 'BOOKING_CONFLICT',
    });
    expect(res.errors).toEqual(res.issues.map((i) => i.message));
    expect(res.codes).toEqual(res.issues.map((i) => i.code));
  });

  it('early return: stanza inesistente e date non valide hanno issues', async () => {
    const { user } = await createAuthedUser({ role: 'docente' });
    const bad = await validateBooking({ user, roomId: 1, startTime: 'x', endTime: 'y' });
    expect(bad.issues).toEqual([{ message: 'Date non valide', code: null }]);
    const noRoom = await validateBooking({
      user,
      roomId: 999999,
      startTime: new Date('2030-01-01T10:00:00Z'),
      endTime: new Date('2030-01-01T11:00:00Z'),
    });
    expect(noRoom.issues).toEqual([{ message: 'Aula non trovata', code: null }]);
  });

  it('il limite giornaliero usa il giorno di Roma anche a cavallo di mezzanotte UTC', async () => {
    institutionTime.setClock(institutionTime.fixedClock('2026-11-02T08:00:00Z'));
    await createBookingRule({
      role: 'docente',
      maxHoursPerDay: 1,
      maxAdvanceDays: 30,
      minAdvanceHours: 0,
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
    });
    const { user } = await createAuthedUser({ role: 'docente' });
    const room = await createRoom();
    const other = await createRoom();
    // 20/11 23:00-24:00 Roma (22:00Z-23:00Z): 1h già prenotata
    await createBooking({
      room: other,
      user,
      startTime: new Date('2026-11-20T22:00:00Z'),
      endTime: new Date('2026-11-20T23:00:00Z'),
    });
    // 21/11 00:30 Roma (23:30Z): altro giorno di Roma → nessun limite giornaliero superato
    const nextDay = await validateBooking({
      user,
      roomId: room.id,
      startTime: new Date('2026-11-20T23:30:00Z'),
      endTime: new Date('2026-11-21T00:30:00Z'),
    });
    expect(nextDay.errors.filter((m) => /giornaliero/.test(m))).toEqual([]);
    // stesso giorno di Roma (20/11 22:00-22:30 Roma = 21:00Z-21:30Z): supera
    const sameDay = await validateBooking({
      user,
      roomId: room.id,
      startTime: new Date('2026-11-20T21:00:00Z'),
      endTime: new Date('2026-11-20T21:30:00Z'),
    });
    expect(sameDay.errors.filter((m) => /giornaliero/.test(m))).toHaveLength(1);
  });
});
