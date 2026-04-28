'use strict';

/**
 * Integrazione: /api/bookings (POST, GET, PUT, DELETE).
 *
 * Pre-condizioni che ogni test deve garantire:
 *   - una BookingRule per il ruolo dell'utente (necessaria a validateBooking)
 *   - una Room bookable
 *   - l'utente con profilo completo (matricola + courseId per studenti)
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const {
  createAuthedUser,
  createCourse,
  createRoom,
  createBookingRule,
  createBooking,
} = require('../factories');

const app = buildApp({ serveFrontend: false });

async function makeStudentWithProfile() {
  const course = await createCourse();
  const auth = await createAuthedUser({
    role: 'studente',
    courseId: course.id,
    matricola: 'TEST-MAT',
  });
  await createBookingRule({ role: 'studente' });
  return auth;
}

function slotInOneHour({ durationMin = 60 } = {}) {
  const start = dayjs().add(1, 'hour').second(0).millisecond(0);
  const end = start.add(durationMin, 'minute');
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

describe('POST /api/bookings', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('crea una prenotazione valida (201)', async () => {
    const { authHeader } = await makeStudentWithProfile();
    const room = await createRoom();
    const slot = slotInOneHour();

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, ...slot });

    expect(res.status).toBe(201);
    expect(res.body.booking.id).toBeTruthy();
    expect(res.body.booking.status).toBe('confirmed');
    expect(res.body.booking.room.id).toBe(room.id);
  });

  it('400 + code BOOKING_INVALID se la durata è negativa', async () => {
    const { authHeader } = await makeStudentWithProfile();
    const room = await createRoom();
    const start = dayjs().add(2, 'hour');
    const end = start.subtract(30, 'minute'); // end < start

    const res = await request(app).post('/api/bookings').set('Authorization', authHeader).send({
      roomId: room.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOOKING_INVALID');
  });

  it('400 in caso di slot già prenotato (conflict)', async () => {
    const { user, authHeader } = await makeStudentWithProfile();
    const room = await createRoom();
    const slot = slotInOneHour();
    await createBooking({
      user,
      room,
      startTime: new Date(slot.startTime),
      endTime: new Date(slot.endTime),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, ...slot });

    // Conflitto su slot già occupato: il route ritorna 400 con
    // BOOKING_INVALID (validator) oppure 409 con BOOKING_CONFLICT (unique
    // constraint, se presente). Accettiamo entrambi.
    expect([400, 409]).toContain(res.status);
    expect(['BOOKING_INVALID', 'BOOKING_CONFLICT']).toContain(res.body.code);
  });

  it('401 senza JWT', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ roomId: 1, startTime: '2030-01-01T10:00:00Z', endTime: '2030-01-01T11:00:00Z' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/bookings', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it("mine=true ritorna solo le prenotazioni dell'utente", async () => {
    const { user, authHeader } = await makeStudentWithProfile();
    const room = await createRoom();
    await createBooking({ user, room });
    // Una prenotazione di un altro utente non deve apparire
    const { user: other } = await createAuthedUser({ role: 'docente' });
    await createBooking({ user: other, room });

    const res = await request(app).get('/api/bookings?mine=true').set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0].userId).toBe(user.id);
  });
});

describe('PUT /api/bookings/:id', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it("404 quando l'id non esiste", async () => {
    const { authHeader } = await makeStudentWithProfile();
    const res = await request(app)
      .put('/api/bookings/99999')
      .set('Authorization', authHeader)
      .send({});
    expect(res.status).toBe(404);
  });
});
