'use strict';

/**
 * Integrazione: BookingRule.minIntervalBetweenBookingsMinutes.
 *
 * Verifica il "cooldown" obbligatorio tra prenotazioni dello stesso utente:
 * impedisce di concatenare blocchi di durata massima per aggirare il cap
 * giornaliero. Default 0 = nessun cooldown (backward compatible).
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const { createAuthedUser, createCourse, createRoom, createBookingRule } = require('../factories');

const app = buildApp({ serveFrontend: false });

async function studentWithCooldown(cooldownMin) {
  const course = await createCourse();
  const auth = await createAuthedUser({
    role: 'studente',
    courseId: course.id,
    matricola: 'M-COOL',
  });
  await createBookingRule({
    role: 'studente',
    maxHoursPerDay: 4,
    maxBookingDurationMinutes: 120,
    minIntervalBetweenBookingsMinutes: cooldownMin,
  });
  return auth;
}

function bookingAt(hourOffset, durationMin = 120) {
  const start = dayjs()
    .add(1, 'day')
    .hour(8)
    .minute(0)
    .second(0)
    .millisecond(0)
    .add(hourOffset, 'hour');
  const end = start.add(durationMin, 'minute');
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

describe('BookingRule.minIntervalBetweenBookingsMinutes', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('cooldown=0 (default): consente due prenotazioni back-to-back', async () => {
    const { authHeader } = await studentWithCooldown(0);
    const room = await createRoom();

    const r1 = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, ...bookingAt(0) });
    expect(r1.status).toBe(201);

    const r2 = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, ...bookingAt(2) });
    expect(r2.status).toBe(201);
  });

  it('cooldown=60: rifiuta back-to-back con MIN_INTERVAL_VIOLATED', async () => {
    const { authHeader } = await studentWithCooldown(60);
    const room = await createRoom();

    const r1 = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, ...bookingAt(0) });
    expect(r1.status).toBe(201);

    // Subito dopo (gap = 0 min) → blocked
    const r2 = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, ...bookingAt(2) });
    expect(r2.status).toBe(400);
    expect(r2.body.code).toBe('MIN_INTERVAL_VIOLATED');
  });

  it('cooldown=60: accetta con gap pari al cooldown', async () => {
    const { authHeader } = await studentWithCooldown(60);
    const room = await createRoom();

    // Prima: 08:00–10:00. Seconda: 11:00–13:00 (gap = 60 min, ok)
    await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, ...bookingAt(0) })
      .expect(201);

    const r2 = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, ...bookingAt(3) });
    expect(r2.status).toBe(201);
  });

  it('cooldown si applica anche prima (ordine inverso)', async () => {
    const { authHeader } = await studentWithCooldown(60);
    const room = await createRoom();

    // Prima creo la più TARDA (12:00–14:00).
    await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, ...bookingAt(4) })
      .expect(201);

    // Tento la PRECEDENTE 10:00–12:00 (gap = 0 → blocked)
    const r2 = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, ...bookingAt(2) });
    expect(r2.status).toBe(400);
    expect(r2.body.code).toBe('MIN_INTERVAL_VIOLATED');
  });
});
