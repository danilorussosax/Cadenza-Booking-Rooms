'use strict';

/**
 * Integration test per POST /api/bookings/recurring (P0-1).
 *
 * Verifica:
 *   - Validazione schema input (express-validator)
 *   - Creazione di N booking ricorrenti (cadenza weekly +7gg)
 *   - skipped[] popolato per occorrenze in conflitto
 *   - Singola transazione (no più 52 SERIALIZABLE in serie)
 *   - allowRecurring=false respinge la richiesta
 *   - Rate limit dedicato disabilitato in test (default), ma riattivabile
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { Booking } = require('../../models');
const {
  createAuthedUser,
  createCourse,
  createRoom,
  createBookingRule,
  createBooking,
} = require('../factories');

async function createDocenteWithProfile() {
  const course = await createCourse();
  return createAuthedUser({ role: 'docente', courseId: course.id });
}

describe('POST /api/bookings/recurring', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('crea N booking ricorrenti settimanali quando tutto è valido', async () => {
    await createBookingRule({
      role: 'docente',
      maxBookingDurationMinutes: 240,
      maxHoursPerWeek: 100,
      maxHoursPerDay: 10,
      maxActiveBookings: 100,
      maxAdvanceDays: 9999,
      allowRecurring: true,
    });
    const room = await createRoom();
    const { user, authHeader } = await createDocenteWithProfile();

    // Lunedì 2030-09-02 14:00–16:00 × 4 settimane
    const start = '2030-09-02T14:00:00.000Z';
    const end = '2030-09-02T16:00:00.000Z';
    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: start,
        endTime: end,
        type: 'lezione',
        purpose: 'Pianoforte 3°',
        recurrence: { weeks: 4 },
        skipConflicts: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.createdCount).toBe(4);
    expect(res.body.skipped).toBe(0);
    expect(res.body.bookingIds).toHaveLength(4);

    const inDb = await Booking.findAll({
      where: { userId: user.id, status: 'confirmed' },
      order: [['startTime', 'ASC']],
    });
    expect(inDb).toHaveLength(4);
    // Verifico che siano +7gg ciascuna
    for (let i = 0; i < 4; i++) {
      const expected = new Date(new Date(start).getTime() + i * 7 * 86400000);
      expect(new Date(inDb[i].startTime).toISOString()).toBe(expected.toISOString());
    }
  });

  it('mette in skipped[] le settimane in conflitto, crea le altre', async () => {
    await createBookingRule({
      role: 'docente',
      maxBookingDurationMinutes: 240,
      maxHoursPerWeek: 100,
      maxHoursPerDay: 10,
      maxActiveBookings: 100,
      maxAdvanceDays: 9999,
      allowRecurring: true,
    });
    const room = await createRoom();
    const { user, authHeader } = await createDocenteWithProfile();

    // Pre-occupiamo la 2a settimana (2030-09-09 14:30–15:30) con un altro
    // utente nella stessa aula → quella ricorrenza deve finire in skipped[].
    const { user: other } = await createAuthedUser({ role: 'studente' });
    await createBooking({
      user: other,
      room,
      startTime: new Date('2030-09-09T14:30:00.000Z'),
      endTime: new Date('2030-09-09T15:30:00.000Z'),
      status: 'confirmed',
    });

    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: '2030-09-02T14:00:00.000Z',
        endTime: '2030-09-02T16:00:00.000Z',
        type: 'lezione',
        recurrence: { weeks: 4 },
        skipConflicts: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.createdCount).toBe(3);
    expect(res.body.skipped).toBe(1);
    expect(res.body.conflicts).toHaveLength(1);
    expect(res.body.conflicts[0].startTime.startsWith('2030-09-09')).toBe(true);
    expect(res.body.conflicts[0].code).toBeDefined();

    const inDb = await Booking.count({ where: { userId: user.id, status: 'confirmed' } });
    expect(inDb).toBe(3);
  });

  it('rifiuta payload invalido (400 VALIDATION_FAILED)', async () => {
    await createBookingRule({ role: 'docente', allowRecurring: true });
    const { authHeader } = await createDocenteWithProfile();

    const cases = [
      { body: {}, name: 'body vuoto' },
      { body: { roomId: 'abc', recurrence: { weeks: 4 } }, name: 'roomId non int' },
      {
        body: {
          roomId: 1,
          startTime: 'oops',
          endTime: 'oops',
          recurrence: { weeks: 4 },
        },
        name: 'startTime non ISO',
      },
      {
        body: {
          roomId: 1,
          startTime: '2030-09-02T14:00:00Z',
          endTime: '2030-09-02T16:00:00Z',
          recurrence: { weeks: 1 },
        },
        name: 'weeks < 2',
      },
      {
        body: {
          roomId: 1,
          startTime: '2030-09-02T14:00:00Z',
          endTime: '2030-09-02T16:00:00Z',
          recurrence: { weeks: 100 },
        },
        name: 'weeks > 52',
      },
    ];
    for (const c of cases) {
      const res = await request(app)
        .post('/api/bookings/recurring')
        .set('Authorization', authHeader)
        .send(c.body);
      expect(res.status, `caso "${c.name}"`).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rifiuta startTime >= endTime', async () => {
    await createBookingRule({ role: 'docente', allowRecurring: true });
    const room = await createRoom();
    const { authHeader } = await createDocenteWithProfile();

    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: '2030-09-02T16:00:00.000Z',
        endTime: '2030-09-02T14:00:00.000Z', // PRIMA di start
        recurrence: { weeks: 4 },
      });
    expect(res.status).toBe(400);
    // Il nuovo handler usa code specifico RECURRENCE_TEMPLATE_TIME_INVALID
    expect(['VALIDATION_FAILED', 'RECURRENCE_TEMPLATE_TIME_INVALID']).toContain(res.body.code);
  });

  it('rispetta allowRecurring=false → 403', async () => {
    await createBookingRule({ role: 'studente', allowRecurring: false });
    const room = await createRoom();
    const course = await createCourse();
    const { authHeader } = await createAuthedUser({
      role: 'studente',
      courseId: course.id,
      matricola: 'STU001',
    });

    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: '2030-09-02T14:00:00.000Z',
        endTime: '2030-09-02T16:00:00.000Z',
        recurrence: { weeks: 4 },
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('RECURRING_NOT_ALLOWED');
  });

  it('52 settimane: nessuna esplosione del pool DB', async () => {
    // Test di carico mini: 52 occorrenze. Prima del refactor questo apriva
    // 52 transazioni SERIALIZABLE in serie. Ora una sola transazione +
    // validate parallelo a CONCURRENCY=5. Tempo atteso: pochi secondi anche
    // su SQLite test.
    await createBookingRule({
      role: 'docente',
      maxBookingDurationMinutes: 240,
      maxHoursPerWeek: 200,
      maxHoursPerDay: 20,
      maxActiveBookings: 200,
      maxAdvanceDays: 9999,
      allowRecurring: true,
    });
    const room = await createRoom();
    const { authHeader } = await createDocenteWithProfile();

    const t0 = Date.now();
    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: '2030-09-02T08:00:00.000Z',
        endTime: '2030-09-02T09:00:00.000Z', // 1h × 52 sett = 52h totali
        type: 'lezione',
        recurrence: { weeks: 52 },
        skipConflicts: true,
      });
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(201);
    expect(res.body.createdCount).toBeGreaterThanOrEqual(50);
    // Sotto 10 secondi con SQLite test (Postgres dovrebbe essere ≤2s).
    expect(elapsed).toBeLessThan(10_000);
  });

  it('senza auth → 401', async () => {
    const res = await request(app)
      .post('/api/bookings/recurring')
      .send({
        roomId: 1,
        startTime: '2030-09-02T14:00:00.000Z',
        endTime: '2030-09-02T16:00:00.000Z',
        recurrence: { weeks: 4 },
      });
    expect(res.status).toBe(401);
  });
});
