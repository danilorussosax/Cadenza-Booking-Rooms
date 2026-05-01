'use strict';

/**
 * Integrazione: due nuove funzionalità ispirate a EasyRoom.
 *
 * 1) POST /api/bookings/swap (admin): scambio atomico di room+orari tra
 *    due prenotazioni confermate, future, non checked-in.
 * 2) Conflitto logico cross-aula (USER_LOGICAL_CONFLICT): blocca il
 *    creare una prenotazione se l'utente ha già una prenotazione attiva
 *    in un'AULA DIVERSA nella stessa fascia oraria.
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const {
  createAuthedUser,
  createAdmin,
  createCourse,
  createRoom,
  createBookingRule,
  createBooking,
} = require('../factories');
const { Booking } = require('../../models');

const app = buildApp({ serveFrontend: false });

async function studentWithProfile() {
  const course = await createCourse();
  const auth = await createAuthedUser({
    role: 'studente',
    courseId: course.id,
    matricola: 'M-' + Math.random().toString(36).slice(2, 8),
  });
  await createBookingRule({ role: 'studente' });
  return auth;
}

describe('POST /api/bookings/swap', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('scambia room+orari tra due prenotazioni future', async () => {
    const { authHeader: adminHeader } = await createAdmin();
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const stuA = await createAuthedUser({ role: 'studente', courseId: course.id, matricola: 'A1' });
    const stuB = await createAuthedUser({ role: 'studente', courseId: course.id, matricola: 'B1' });
    const roomA = await createRoom();
    const roomB = await createRoom();

    const slotA = dayjs().add(2, 'day').hour(10);
    const slotB = dayjs().add(2, 'day').hour(14);
    const a = await createBooking({
      user: stuA.user,
      room: roomA,
      startTime: slotA.toDate(),
      endTime: slotA.add(1, 'hour').toDate(),
    });
    const b = await createBooking({
      user: stuB.user,
      room: roomB,
      startTime: slotB.toDate(),
      endTime: slotB.add(1, 'hour').toDate(),
    });

    const res = await request(app)
      .post('/api/bookings/swap')
      .set('Authorization', adminHeader)
      .send({ aId: a.id, bId: b.id });
    expect(res.status).toBe(200);

    const aAfter = await Booking.findByPk(a.id);
    const bAfter = await Booking.findByPk(b.id);
    expect(aAfter.roomId).toBe(roomB.id);
    expect(bAfter.roomId).toBe(roomA.id);
    expect(new Date(aAfter.startTime).getTime()).toBe(slotB.toDate().getTime());
    expect(new Date(bAfter.startTime).getTime()).toBe(slotA.toDate().getTime());
    // Status integro
    expect(aAfter.status).toBe('confirmed');
    expect(bAfter.status).toBe('confirmed');
  });

  it('rifiuta swap con prenotazione passata', async () => {
    const { authHeader: adminHeader } = await createAdmin();
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const stu = await createAuthedUser({ role: 'studente', courseId: course.id, matricola: 'X' });
    const r1 = await createRoom();
    const r2 = await createRoom();
    const past = dayjs().subtract(1, 'day').hour(10);
    const future = dayjs().add(1, 'day').hour(10);
    const a = await createBooking({
      user: stu.user,
      room: r1,
      startTime: past.toDate(),
      endTime: past.add(1, 'hour').toDate(),
    });
    const b = await createBooking({
      user: stu.user,
      room: r2,
      startTime: future.toDate(),
      endTime: future.add(1, 'hour').toDate(),
    });
    const res = await request(app)
      .post('/api/bookings/swap')
      .set('Authorization', adminHeader)
      .send({ aId: a.id, bId: b.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAST_BOOKING');
  });

  it('rifiuta swap se una è checked-in', async () => {
    const { authHeader: adminHeader } = await createAdmin();
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const stu = await createAuthedUser({ role: 'studente', courseId: course.id, matricola: 'X' });
    const r1 = await createRoom();
    const r2 = await createRoom();
    const slot1 = dayjs().add(1, 'day').hour(10);
    const slot2 = dayjs().add(1, 'day').hour(14);
    const a = await createBooking({
      user: stu.user,
      room: r1,
      startTime: slot1.toDate(),
      endTime: slot1.add(1, 'hour').toDate(),
    });
    const b = await createBooking({
      user: stu.user,
      room: r2,
      startTime: slot2.toDate(),
      endTime: slot2.add(1, 'hour').toDate(),
    });
    await a.update({ checkedInAt: new Date() });
    const res = await request(app)
      .post('/api/bookings/swap')
      .set('Authorization', adminHeader)
      .send({ aId: a.id, bId: b.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CHECKED_IN');
  });

  it('non-admin riceve 403', async () => {
    const { authHeader } = await studentWithProfile();
    const res = await request(app)
      .post('/api/bookings/swap')
      .set('Authorization', authHeader)
      .send({ aId: 1, bId: 2 });
    expect(res.status).toBe(403);
  });

  it('400 se aId === bId', async () => {
    const { authHeader: adminHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/bookings/swap')
      .set('Authorization', adminHeader)
      .send({ aId: 1, bId: 1 });
    expect(res.status).toBe(400);
  });
});

describe('Conflitto logico cross-aula (USER_LOGICAL_CONFLICT)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('blocca prenotazione che si sovrappone in aula diversa allo stesso utente', async () => {
    const { user, authHeader } = await studentWithProfile();
    const r1 = await createRoom();
    const r2 = await createRoom();

    const slot = dayjs().add(1, 'day').hour(10);
    await createBooking({
      user,
      room: r1,
      startTime: slot.toDate(),
      endTime: slot.add(1, 'hour').toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: r2.id,
        startTime: slot.add(15, 'minute').toISOString(),
        endTime: slot.add(45, 'minute').toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('USER_LOGICAL_CONFLICT');
  });

  it('consente back-to-back senza overlap (gap = 0)', async () => {
    const { user, authHeader } = await studentWithProfile();
    const r1 = await createRoom();
    const r2 = await createRoom();
    const slot = dayjs().add(1, 'day').hour(10);
    await createBooking({
      user,
      room: r1,
      startTime: slot.toDate(),
      endTime: slot.add(1, 'hour').toDate(),
    });
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: r2.id,
        startTime: slot.add(1, 'hour').toISOString(),
        endTime: slot.add(2, 'hour').toISOString(),
      });
    expect(res.status).toBe(201);
  });

  it('consente prenotazione nella stessa aula (sotto altra constraint)', async () => {
    const { user, authHeader } = await studentWithProfile();
    const r1 = await createRoom();
    const slot = dayjs().add(1, 'day').hour(10);
    await createBooking({
      user,
      room: r1,
      startTime: slot.toDate(),
      endTime: slot.add(1, 'hour').toDate(),
    });
    // Stessa aula, overlap → BOOKING_CONFLICT (non USER_LOGICAL_CONFLICT).
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: r1.id,
        startTime: slot.add(15, 'minute').toISOString(),
        endTime: slot.add(45, 'minute').toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOOKING_CONFLICT');
  });
});
