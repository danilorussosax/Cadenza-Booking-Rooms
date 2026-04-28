'use strict';

/**
 * Integrazione: services/waitlistService + /api/bookings/waitlist.
 *
 * Scenari critici:
 *   - cleanupExpired marca cancellate e poi promuove il successivo
 *   - notifyNextOnSlot non avvisa se lo slot è ancora occupato
 *   - claim → 201 con booking creata
 *   - delete propria entry decrementa posizioni
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const { BookingWaitlist, Booking } = require('../../models');
const {
  createAuthedUser,
  createCourse,
  createRoom,
  createBookingRule,
  createBooking,
} = require('../factories');
const { notifyNextOnSlot, cleanupExpired } = require('../../services/waitlistService');

const app = buildApp({ serveFrontend: false });

async function studentWithProfile() {
  const course = await createCourse();
  const auth = await createAuthedUser({
    role: 'studente',
    courseId: course.id,
    matricola: 'WL-MAT',
  });
  await createBookingRule({ role: 'studente' });
  return auth;
}

describe('waitlistService.notifyNextOnSlot', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('notifica il primo in coda quando lo slot è libero', async () => {
    const { user: owner } = await createAuthedUser({ role: 'studente' });
    const room = await createRoom();
    const start = dayjs().add(2, 'hour').toDate();
    const end = dayjs(start).add(1, 'hour').toDate();

    // entry in coda (non ancora notificata)
    const entry = await BookingWaitlist.create({
      userId: owner.id,
      roomId: room.id,
      startTime: start,
      endTime: end,
      position: 0,
      type: 'studio_individuale',
    });

    const result = await notifyNextOnSlot({ roomId: room.id, startTime: start, endTime: end });
    expect(result).toBeTruthy();
    expect(result.id).toBe(entry.id);

    await entry.reload();
    expect(entry.notifiedAt).toBeTruthy();
    expect(entry.expiresAt).toBeTruthy();
    expect(entry.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('NON notifica se lo slot è ancora occupato da una booking confermata', async () => {
    const { user: owner } = await createAuthedUser({ role: 'studente' });
    const { user: someone } = await createAuthedUser({ role: 'studente' });
    const room = await createRoom();
    const start = dayjs().add(2, 'hour').toDate();
    const end = dayjs(start).add(1, 'hour').toDate();

    await createBooking({ user: someone, room, startTime: start, endTime: end });
    await BookingWaitlist.create({
      userId: owner.id,
      roomId: room.id,
      startTime: start,
      endTime: end,
      position: 0,
      type: 'studio_individuale',
    });

    const result = await notifyNextOnSlot({ roomId: room.id, startTime: start, endTime: end });
    expect(result).toBeNull();
  });
});

describe('waitlistService.cleanupExpired', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('cancella entry scadute e promuove il successivo', async () => {
    const { user: u1 } = await createAuthedUser({ role: 'studente' });
    const { user: u2 } = await createAuthedUser({ role: 'studente' });
    const room = await createRoom();
    const start = dayjs().add(3, 'hour').toDate();
    const end = dayjs(start).add(1, 'hour').toDate();

    const expired = await BookingWaitlist.create({
      userId: u1.id,
      roomId: room.id,
      startTime: start,
      endTime: end,
      position: 0,
      type: 'studio_individuale',
      notifiedAt: dayjs().subtract(1, 'hour').toDate(),
      expiresAt: dayjs().subtract(30, 'minute').toDate(), // scaduto
    });
    const next = await BookingWaitlist.create({
      userId: u2.id,
      roomId: room.id,
      startTime: start,
      endTime: end,
      position: 1,
      type: 'studio_individuale',
    });

    const processed = await cleanupExpired();
    expect(processed).toBe(1);

    await expired.reload();
    expect(expired.cancelledAt).toBeTruthy();

    await next.reload();
    expect(next.notifiedAt).toBeTruthy();
    // Posizione decrementata da 1 a 0 dopo expiry del primo
    expect(next.position).toBe(0);
  });
});

describe('POST /api/bookings/waitlist/:id/claim', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('riscatta una notifica creando la booking', async () => {
    const { user, authHeader } = await studentWithProfile();
    const room = await createRoom();
    const start = dayjs().add(2, 'hour').toDate();
    const end = dayjs(start).add(1, 'hour').toDate();

    // Entry in coda già notificata e ancora valida
    const entry = await BookingWaitlist.create({
      userId: user.id,
      roomId: room.id,
      startTime: start,
      endTime: end,
      position: 0,
      type: 'studio_individuale',
      notifiedAt: new Date(),
      expiresAt: dayjs().add(30, 'minute').toDate(),
    });

    const res = await request(app)
      .post(`/api/bookings/waitlist/${entry.id}/claim`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(201);
    expect(res.body.booking.userId).toBe(user.id);
    expect(res.body.booking.roomId).toBe(room.id);

    // Booking effettivamente nel DB
    const stored = await Booking.findOne({ where: { userId: user.id } });
    expect(stored).toBeTruthy();

    // Entry chiusa
    await entry.reload();
    expect(entry.claimedAt).toBeTruthy();
  });

  it('409 WAITLIST_NOT_YOUR_TURN se non ancora notificata', async () => {
    const { user, authHeader } = await studentWithProfile();
    const room = await createRoom();
    const start = dayjs().add(2, 'hour').toDate();
    const end = dayjs(start).add(1, 'hour').toDate();

    const entry = await BookingWaitlist.create({
      userId: user.id,
      roomId: room.id,
      startTime: start,
      endTime: end,
      position: 0,
      type: 'studio_individuale',
      // notifiedAt assente
    });

    const res = await request(app)
      .post(`/api/bookings/waitlist/${entry.id}/claim`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WAITLIST_NOT_YOUR_TURN');
  });

  it('403 se non sei il proprietario della entry', async () => {
    const { authHeader } = await studentWithProfile();
    const { user: other } = await createAuthedUser({ role: 'studente' });
    const room = await createRoom();
    const start = dayjs().add(2, 'hour').toDate();
    const end = dayjs(start).add(1, 'hour').toDate();
    const entry = await BookingWaitlist.create({
      userId: other.id,
      roomId: room.id,
      startTime: start,
      endTime: end,
      position: 0,
      type: 'studio_individuale',
      notifiedAt: new Date(),
      expiresAt: dayjs().add(30, 'minute').toDate(),
    });

    const res = await request(app)
      .post(`/api/bookings/waitlist/${entry.id}/claim`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
