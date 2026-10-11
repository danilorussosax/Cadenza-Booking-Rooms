'use strict';

/**
 * Le prenotazioni generate dal monte ore (origin='monte_ore') non consumano le
 * quote delle prenotazioni libere, ma continuano a contare nei conflitti.
 */

const request = require('supertest');
const dayjs = require('dayjs');
const { buildApp } = require('../../app');
const { Booking, BookingRule } = require('../../models');
const { validateBooking } = require('../../services/bookingValidator');
const { createAuthedUser, createBookingRule, createRoom } = require('../factories');

describe('Booking.origin — quote delle prenotazioni libere', () => {
  let app;
  let teacher;
  let roomA;
  let roomB;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
    teacher = await createAuthedUser({ role: 'docente' });
    roomA = await createRoom({ name: 'Aula A' });
    roomB = await createRoom({ name: 'Aula B' });
    await createBookingRule({
      role: 'docente',
      maxActiveBookings: 2,
      maxHoursPerWeek: 2,
      maxHoursPerDay: 2,
      maxAdvanceDays: 60,
    });
  });

  const day = dayjs().add(3, 'day').startOf('day');
  const at = (h) => day.hour(h).toDate();
  const book = (origin, hour, room = roomA) =>
    Booking.create({
      userId: teacher.user.id,
      roomId: room.id,
      startTime: at(hour),
      endTime: at(hour + 1),
      type: 'lezione',
      status: 'confirmed',
      origin,
    });
  const validate = (hour, room = roomB) =>
    validateBooking({
      user: teacher.user,
      roomId: room.id,
      startTime: at(hour),
      endTime: at(hour + 1),
      type: 'altro',
    });

  it("l'origine di default è 'manual' e solo i valori noti sono ammessi", async () => {
    const b = await book(undefined, 9);
    expect(b.origin).toBe('manual');
    await expect(book('altro', 11)).rejects.toThrow();
  });

  it('il monte ore non consuma attive, ore settimanali né giornaliere', async () => {
    await book('monte_ore', 9);
    await book('monte_ore', 10);
    await book('monte_ore', 11);
    const res = await validate(15);
    expect(res.errors).toEqual([]);
    expect(res.valid).toBe(true);
  });

  it('controllo: le stesse prenotazioni manuali superano i limiti', async () => {
    await book('manual', 9);
    await book('manual', 10);
    await book('manual', 11);
    const res = await validate(15);
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/limite di 2 prenotazioni attive/);
    expect(res.errors.join(' ')).toMatch(/Limite settimanale/);
    expect(res.errors.join(' ')).toMatch(/Limite giornaliero/);
  });

  it('le prenotazioni libere hanno comunque le loro quote', async () => {
    await book('monte_ore', 9);
    await book('manual', 12);
    await book('manual', 13);
    const res = await validate(15);
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/prenotazioni attive/);
  });

  it("il monte ore non attiva l'intervallo minimo tra prenotazioni", async () => {
    await BookingRule.update(
      { minIntervalBetweenBookingsMinutes: 60, maxHoursPerDay: 10, maxHoursPerWeek: 20 },
      { where: { role: 'docente' } },
    );
    await book('monte_ore', 9);
    expect((await validate(10)).valid).toBe(true); // adiacente al monte ore: ok
    await book('manual', 12);
    const adjacent = await validate(13);
    expect(adjacent.valid).toBe(false); // adiacente a una libera: cooldown
  });

  it('i conflitti restano: stessa aula occupata e docente già impegnato altrove', async () => {
    await book('monte_ore', 9, roomA);
    const sameRoom = await validate(9, roomA);
    expect(sameRoom.valid).toBe(false);
    expect(sameRoom.errors.join(' ')).toMatch(/già prenotata/);
    const otherRoom = await validate(9, roomB);
    expect(otherRoom.valid).toBe(false);
    expect(otherRoom.errors.join(' ')).toMatch(/altra aula/);
  });

  it('/usage/me non conta le ore del monte ore', async () => {
    const now = new Date();
    const mk = (origin) =>
      Booking.create({
        userId: teacher.user.id,
        roomId: roomA.id,
        startTime: now,
        endTime: new Date(now.getTime() + 60 * 60 * 1000),
        type: 'lezione',
        status: 'confirmed',
        origin,
      });
    await mk('monte_ore');
    const before = await request(app)
      .get('/api/bookings/usage/me')
      .set('Authorization', teacher.authHeader);
    expect(before.status).toBe(200);
    expect(before.body.weekly.usedHours).toBe(0);
    expect(before.body.daily.usedHours).toBe(0);
    await mk('manual');
    const after = await request(app)
      .get('/api/bookings/usage/me')
      .set('Authorization', teacher.authHeader);
    expect(after.body.weekly.usedHours).toBe(1);
    expect(after.body.daily.usedHours).toBe(1);
  });
});
