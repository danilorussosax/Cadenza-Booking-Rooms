'use strict';

/**
 * Integrazione: §2.11 slot alternativi su conflitto.
 *
 * Verifica che POST /api/bookings, quando rifiuta per BOOKING_CONFLICT,
 * arricchisca la response con `suggestions[]` e `conflictsWith` rispettando:
 *   - ordine A* → B* → C* delle strategie
 *   - cap 5 risultati
 *   - filtri per permessi (allowedCourseIds, allowedRoles)
 *   - quote utente (BookingQuota)
 *   - fascia oraria consentita (BookingRule.allowedStartTime/EndTime)
 *   - privacy: ownerLabel visibile solo a docente/admin
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const {
  createAdmin,
  createAuthedUser,
  createBooking,
  createBookingRule,
  createBuilding,
  createCourse,
  createRoom,
} = require('../factories');
const { BookingQuota } = require('../../models');
const { findAlternatives } = require('../../services/bookingSuggestions');

const app = buildApp({ serveFrontend: false });

// Slot deterministico in un giorno futuro a un orario centrale,
// per evitare collisioni con finestre allowedStartTime/EndTime.
function futureSlot({ daysAhead = 7, hour = 10, durationMin = 60 } = {}) {
  const start = dayjs().add(daysAhead, 'day').hour(hour).minute(0).second(0).millisecond(0);
  const end = start.add(durationMin, 'minute');
  return { start, end, startTime: start.toISOString(), endTime: end.toISOString() };
}

async function studentWithProfile(courseId, suffix = '') {
  const auth = await createAuthedUser({
    role: 'studente',
    courseId,
    matricola: `M-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
  });
  return auth;
}

describe('POST /api/bookings — suggestions', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('A1: stessa aula libera +30 min ⇒ suggerisce same_room_shifted_30_after', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const { authHeader } = await studentWithProfile(course.id, 'a1');
    const room = await createRoom();
    const slot = futureSlot();
    await createBooking({
      user: blocker,
      room,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, startTime: slot.startTime, endTime: slot.endTime });

    expect(res.body.code).toBe('BOOKING_CONFLICT');
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    const reasons = res.body.suggestions.map((s) => s.reason);
    expect(reasons).toContain('same_room_shifted_30_after');
  });

  it('A2: stessa aula libera -30 min ⇒ suggerisce same_room_shifted_30_before', async () => {
    await createBookingRule({
      role: 'studente',
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
    });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const { authHeader } = await studentWithProfile(course.id, 'a2');
    const room = await createRoom();
    // Slot a metà giornata così -30 min resta dentro la finestra.
    const slot = futureSlot({ hour: 12 });
    await createBooking({
      user: blocker,
      room,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, startTime: slot.startTime, endTime: slot.endTime });

    const reasons = res.body.suggestions.map((s) => s.reason);
    expect(reasons).toContain('same_room_shifted_30_before');
  });

  it('B1: aula simile (stesso building, capacity >=) libera ⇒ suggerisce similar_room_same_time', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const { authHeader } = await studentWithProfile(course.id, 'b1');
    const building = await createBuilding();
    const r1 = await createRoom({ building, capacity: 4, type: 'studio' });
    const r2 = await createRoom({ building, capacity: 6, type: 'studio' });
    const slot = futureSlot();
    await createBooking({
      user: blocker,
      room: r1,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: r1.id, startTime: slot.startTime, endTime: slot.endTime });

    const similar = res.body.suggestions.find((s) => s.reason === 'similar_room_same_time');
    expect(similar).toBeDefined();
    expect(similar.roomId).toBe(r2.id);
  });

  it('B1: aula simile con capacity inferiore NON è suggerita', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const { authHeader } = await studentWithProfile(course.id, 'b1-low');
    const building = await createBuilding();
    const r1 = await createRoom({ building, capacity: 8, type: 'studio' });
    const r2 = await createRoom({ building, capacity: 2, type: 'studio' });
    const slot = futureSlot();
    await createBooking({
      user: blocker,
      room: r1,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: r1.id, startTime: slot.startTime, endTime: slot.endTime });

    const similar = res.body.suggestions.find((s) => s.roomId === r2.id);
    expect(similar).toBeUndefined();
  });

  it('B1: aula simile in ALTRO building NON è suggerita', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const { authHeader } = await studentWithProfile(course.id, 'b1-bld');
    const buildingA = await createBuilding();
    const buildingB = await createBuilding();
    const r1 = await createRoom({ building: buildingA, capacity: 4, type: 'studio' });
    const rOther = await createRoom({ building: buildingB, capacity: 4, type: 'studio' });
    const slot = futureSlot();
    await createBooking({
      user: blocker,
      room: r1,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: r1.id, startTime: slot.startTime, endTime: slot.endTime });

    const inOtherBuilding = res.body.suggestions.find((s) => s.roomId === rOther.id);
    expect(inOtherBuilding).toBeUndefined();
  });

  it('Permessi: studente senza accesso a una aula candidata NON la vede tra le suggestions', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const otherCourse = await createCourse();
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const { authHeader } = await studentWithProfile(course.id, 'perms');
    const building = await createBuilding();
    const r1 = await createRoom({ building, capacity: 4, type: 'studio' });
    // Aula ristretta a un altro corso → studente non ha accesso.
    const rRestricted = await createRoom({
      building,
      capacity: 4,
      type: 'studio',
      allowedCourseIds: [otherCourse.id],
    });
    const slot = futureSlot();
    await createBooking({
      user: blocker,
      room: r1,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: r1.id, startTime: slot.startTime, endTime: slot.endTime });

    const restricted = res.body.suggestions.find((s) => s.roomId === rRestricted.id);
    expect(restricted).toBeUndefined();
  });

  it('Fascia oraria: slot candidato fuori allowedStartTime/EndTime NON è suggerito', async () => {
    // Permettiamo solo 09:00-18:00 → uno shift di +120 min su slot 17:00-18:00
    // andrebbe alle 19:00-20:00 (fuori finestra) e DEVE essere escluso.
    await createBookingRule({
      role: 'studente',
      allowedStartTime: '09:00',
      allowedEndTime: '18:00',
    });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const { authHeader } = await studentWithProfile(course.id, 'window');
    const room = await createRoom();
    const slot = futureSlot({ hour: 17 });
    await createBooking({
      user: blocker,
      room,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, startTime: slot.startTime, endTime: slot.endTime });

    const reasons = res.body.suggestions.map((s) => s.reason);
    expect(reasons).not.toContain('same_room_shifted_120_after');
  });

  it('Quote: se la quota settimanale è esaurita, le alternative valide possono comunque essere [] o ridotte', async () => {
    // Quota molto bassa: 1h/settimana. Avendo già 1h consumata, nessuna
    // nuova prenotazione di 1h passa.
    await createBookingRule({ role: 'studente', maxHoursPerWeek: 1 });
    const course = await createCourse();
    const { user, authHeader } = await studentWithProfile(course.id, 'quota');
    const room = await createRoom();
    const slot = futureSlot();
    // Una booking già esistente dell'utente che satura la quota.
    await createBooking({
      user,
      room,
      startTime: dayjs().add(7, 'day').hour(8).toDate(),
      endTime: dayjs().add(7, 'day').hour(9).toDate(),
    });
    // Slot conflittuale (un altro utente blocca lo slot 10-11).
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    await createBooking({
      user: blocker,
      room,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, startTime: slot.startTime, endTime: slot.endTime });

    // Tutte le suggestion sarebbero da 1h e tutte violerebbero la quota
    // settimanale già a 1h. Quindi suggestions deve essere [].
    expect(res.body.suggestions).toEqual([]);
  });

  it('Tutto pieno: suggestions = []', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const { authHeader } = await studentWithProfile(course.id, 'full');
    const building = await createBuilding();
    const r1 = await createRoom({ building, capacity: 4 });

    const baseSlot = futureSlot({ hour: 10 });
    // Riempi un'ampia finestra ±4h, +2 giorni successivi sulla stessa aula.
    for (let mins = -240; mins <= 240; mins += 30) {
      await createBooking({
        user: blocker,
        room: r1,
        startTime: baseSlot.start.add(mins, 'minute').toDate(),
        endTime: baseSlot.start.add(mins + 30, 'minute').toDate(),
      });
    }
    for (let d = 1; d <= 2; d += 1) {
      await createBooking({
        user: blocker,
        room: r1,
        startTime: baseSlot.start.add(d, 'day').toDate(),
        endTime: baseSlot.end.add(d, 'day').toDate(),
      });
    }

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: r1.id, startTime: baseSlot.startTime, endTime: baseSlot.endTime });

    expect(res.body.code).toBe('BOOKING_CONFLICT');
    expect(res.body.suggestions).toEqual([]);
  });

  it('Cap 5: ritorna al massimo 5 suggerimenti', async () => {
    await createBookingRule({
      role: 'studente',
      allowedStartTime: '06:00',
      allowedEndTime: '22:00',
    });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const { authHeader } = await studentWithProfile(course.id, 'cap5');
    const building = await createBuilding();
    const r1 = await createRoom({ building, capacity: 4, type: 'studio' });
    // 8 aule simili libere → potenziali B1.
    for (let i = 0; i < 8; i += 1) {
      await createRoom({ building, capacity: 4, type: 'studio' });
    }
    const slot = futureSlot({ hour: 12 });
    await createBooking({
      user: blocker,
      room: r1,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: r1.id, startTime: slot.startTime, endTime: slot.endTime });

    expect(res.body.suggestions.length).toBeLessThanOrEqual(5);
    // Ordine: A* prima di B*.
    const reasons = res.body.suggestions.map((s) => s.reason);
    const firstShift = reasons.findIndex((r) => r.startsWith('same_room_shifted'));
    const firstSimilar = reasons.indexOf('similar_room_same_time');
    if (firstShift >= 0 && firstSimilar >= 0) {
      expect(firstShift).toBeLessThan(firstSimilar);
    }
  });

  it('Privacy: studente NON vede conflictsWith.ownerLabel', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({
      role: 'studente',
      courseId: course.id,
      firstName: 'Mario',
      lastName: 'Rossi',
    });
    const { authHeader } = await studentWithProfile(course.id, 'priv-s');
    const room = await createRoom();
    const slot = futureSlot();
    await createBooking({
      user: blocker,
      room,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, startTime: slot.startTime, endTime: slot.endTime });

    expect(res.body.conflictsWith).toBeDefined();
    expect(res.body.conflictsWith.ownerLabel).toBeNull();
  });

  it('Privacy: docente/admin VEDE conflictsWith.ownerLabel', async () => {
    await createBookingRule({ role: 'docente' });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({
      role: 'studente',
      courseId: course.id,
      firstName: 'Mario',
      lastName: 'Rossi',
    });
    const { authHeader: teacherHeader } = await createAuthedUser({
      role: 'docente',
      courseId: course.id,
    });
    const room = await createRoom();
    const slot = futureSlot();
    await createBooking({
      user: blocker,
      room,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', teacherHeader)
      .send({ roomId: room.id, startTime: slot.startTime, endTime: slot.endTime });

    expect(res.body.conflictsWith).toBeDefined();
    expect(res.body.conflictsWith.ownerLabel).toBe('Mario Rossi');
  });

  it('Backward-compat: response 409/400 mantiene `error` e `code=BOOKING_CONFLICT`', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const { user: blocker } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const { authHeader } = await studentWithProfile(course.id, 'compat');
    const room = await createRoom();
    const slot = futureSlot();
    await createBooking({
      user: blocker,
      room,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, startTime: slot.startTime, endTime: slot.endTime });

    expect([400, 409]).toContain(res.status);
    expect(res.body.code).toBe('BOOKING_CONFLICT');
    expect(typeof res.body.error).toBe('string');
  });
});

describe('findAlternatives — unit', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('cappa a 5 risultati anche con molte aule libere', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const { user } = await createAuthedUser({ role: 'studente', courseId: course.id });
    const building = await createBuilding();
    const room = await createRoom({ building, capacity: 4, type: 'studio' });
    for (let i = 0; i < 10; i += 1) {
      await createRoom({ building, capacity: 4, type: 'studio' });
    }
    const slot = futureSlot({ hour: 11 });
    const res = await findAlternatives({
      roomId: room.id,
      startTime: slot.start.toDate(),
      endTime: slot.end.toDate(),
      type: 'studio_individuale',
      user,
    });
    expect(res.length).toBeLessThanOrEqual(5);
  });
});
