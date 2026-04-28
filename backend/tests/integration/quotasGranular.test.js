'use strict';

/**
 * Integrazione: estensioni granulari BookingQuota (step 3) + scope ampliati
 * (step 4) + preview validatore (step 2).
 *
 * Cosa testiamo:
 *   - daysOfWeek: la quota si applica solo nei giorni indicati
 *   - timeFrom/timeTo: la quota si applica solo se il booking interseca la fascia
 *   - maxBookings: cap numerico (count) settimanale
 *   - scopeKind='room': cap su una singola aula
 *   - scopeKind='building': cap su tutto un edificio
 *   - POST /api/admin/rules/preview: dry-run del validator
 */

const dayjs = require('dayjs');
const isoWeek = require('dayjs/plugin/isoWeek');
const request = require('supertest');
const { buildApp } = require('../../app');
const { BookingQuota, Booking } = require('../../models');
const {
  createAdmin,
  createAuthedUser,
  createCourse,
  createRoom,
  createBuilding,
  createBookingRule,
} = require('../factories');

dayjs.extend(isoWeek);

const app = buildApp({ serveFrontend: false });

async function studentWithProfile() {
  const course = await createCourse();
  const auth = await createAuthedUser({
    role: 'studente',
    courseId: course.id,
    matricola: 'GQ-MAT',
  });
  await createBookingRule({ role: 'studente' });
  return auth;
}

// Trova un orario futuro che cade in un giorno-of-week specifico (0-6).
function nextSlotOnDow(targetDow, hour = 10) {
  const tomorrow = dayjs().add(1, 'day').hour(hour).minute(0).second(0).millisecond(0);
  const diff = (targetDow - tomorrow.day() + 7) % 7;
  return tomorrow.add(diff, 'day');
}

describe('BookingQuota — daysOfWeek', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('si applica solo nei giorni indicati', async () => {
    const { authHeader } = await studentWithProfile();
    const room = await createRoom();
    // Quota globale solo lunedì (1): max 0.5h/giorno
    await BookingQuota.create({
      role: 'studente',
      scopeKind: 'global',
      scopeValue: '*',
      maxHoursPerDay: 1,
      daysOfWeek: [1], // solo lunedì
      isActive: true,
    });

    // Booking di lunedì che la sfora (2h > 1h cap) → blocco
    const monday = nextSlotOnDow(1);
    const resMonday = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: monday.toISOString(),
        endTime: monday.add(2, 'hour').toISOString(),
      });
    expect(resMonday.status).toBe(400);

    // Booking di martedì che sforerebbe il cap → MA daysOfWeek non include 2 → ammesso
    const tuesday = nextSlotOnDow(2);
    const resTuesday = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: tuesday.toISOString(),
        endTime: tuesday.add(2, 'hour').toISOString(),
      });
    expect(resTuesday.status).toBe(201);
  });
});

describe('BookingQuota — timeFrom/timeTo', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('si applica solo se la booking interseca la fascia oraria', async () => {
    const { authHeader } = await studentWithProfile();
    const room = await createRoom();

    // Quota: max 30 minuti dopo le 18 (fascia 18:00-23:00).
    await BookingQuota.create({
      role: 'studente',
      scopeKind: 'global',
      scopeValue: '*',
      maxHoursPerDay: 1, // cap 1h/giorno ma solo nella fascia
      timeFrom: '18:00',
      timeTo: '23:00',
      isActive: true,
    });

    // Booking 19:00-21:00 (interseca fascia, 2h > 1h) → blocco
    const eveningStart = dayjs().add(1, 'day').hour(19).minute(0).second(0).millisecond(0);
    const evening = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: eveningStart.toISOString(),
        endTime: eveningStart.add(2, 'hour').toISOString(),
      });
    expect(evening.status).toBe(400);

    // Booking 10:00-12:00 (NON interseca fascia) → quota non si applica → ammesso
    const morningStart = dayjs().add(1, 'day').hour(10).minute(0).second(0).millisecond(0);
    const morning = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: morningStart.toISOString(),
        endTime: morningStart.add(2, 'hour').toISOString(),
      });
    expect(morning.status).toBe(201);
  });
});

describe('BookingQuota — maxBookings (count)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('blocca quando il count settimanale supera maxBookings', async () => {
    const { user, authHeader } = await studentWithProfile();
    const room = await createRoom();
    await BookingQuota.create({
      role: 'studente',
      scopeKind: 'global',
      scopeValue: '*',
      maxBookings: 2, // max 2 prenotazioni nella settimana ISO
      isActive: true,
    });

    // 2 booking esistenti questa settimana → la 3ª deve essere bloccata
    const base = dayjs().add(1, 'day').hour(10).minute(0).second(0).millisecond(0);
    await Booking.create({
      userId: user.id,
      roomId: room.id,
      status: 'confirmed',
      startTime: base.toDate(),
      endTime: base.add(1, 'hour').toDate(),
      type: 'studio_individuale',
    });
    await Booking.create({
      userId: user.id,
      roomId: room.id,
      status: 'confirmed',
      startTime: base.add(3, 'hour').toDate(),
      endTime: base.add(4, 'hour').toDate(),
      type: 'studio_individuale',
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: base.add(6, 'hour').toISOString(),
        endTime: base.add(7, 'hour').toISOString(),
      });
    expect(res.status).toBe(400);
    const allErrors = [res.body.error, ...(res.body.issues || [])].join(' ');
    expect(allErrors).toMatch(/numerica/i);
  });
});

describe('BookingQuota — scope room/building', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it("scopeKind='room' applica il cap solo sulla aula specifica", async () => {
    const { authHeader } = await studentWithProfile();
    const targetRoom = await createRoom();
    const otherRoom = await createRoom();

    await BookingQuota.create({
      role: 'studente',
      scopeKind: 'room',
      scopeValue: String(targetRoom.id),
      maxHoursPerDay: 1,
      isActive: true,
    });

    const t = dayjs().add(1, 'day').hour(10).minute(0).second(0).millisecond(0);

    // Booking 2h sulla aula target → eccede cap 1h → blocco
    const blocked = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: targetRoom.id,
        startTime: t.toISOString(),
        endTime: t.add(2, 'hour').toISOString(),
      });
    expect(blocked.status).toBe(400);

    // Booking 2h sull'altra aula → quota non match → ammesso
    const ok = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: otherRoom.id,
        startTime: t.toISOString(),
        endTime: t.add(2, 'hour').toISOString(),
      });
    expect(ok.status).toBe(201);
  });

  it("scopeKind='building' applica il cap sull'intero edificio", async () => {
    const { user, authHeader } = await studentWithProfile();
    const building = await createBuilding();
    const r1 = await createRoom({ building });
    const r2 = await createRoom({ building });

    await BookingQuota.create({
      role: 'studente',
      scopeKind: 'building',
      scopeValue: String(building.id),
      maxHoursPerWeek: 2,
      isActive: true,
    });

    // 2h già usate in r1 questa settimana
    const base = dayjs().add(1, 'day').hour(8).minute(0).second(0).millisecond(0);
    await Booking.create({
      userId: user.id,
      roomId: r1.id,
      status: 'confirmed',
      startTime: base.toDate(),
      endTime: base.add(2, 'hour').toDate(),
      type: 'studio_individuale',
    });

    // Tentativo di prenotare in r2 (stesso building) → eccede 2h → blocco
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({
        roomId: r2.id,
        startTime: base.add(4, 'hour').toISOString(),
        endTime: base.add(5, 'hour').toISOString(),
      });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/rules/preview', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('admin: simula booking studente e ritorna valid=true se rules ok', async () => {
    const { authHeader: adminAuth } = await createAdmin();
    const room = await createRoom();
    await createBookingRule({ role: 'studente' });

    const start = dayjs().add(1, 'day').hour(10).minute(0).second(0).millisecond(0);
    const res = await request(app)
      .post('/api/admin/rules/preview')
      .set('Authorization', adminAuth)
      .send({
        role: 'studente',
        roomId: room.id,
        startTime: start.toISOString(),
        endTime: start.add(1, 'hour').toISOString(),
      });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it('admin: ritorna valid=false con errori se la regola non passa', async () => {
    const { authHeader: adminAuth } = await createAdmin();
    const room = await createRoom();
    // Regola con anticipo minimo 24h → una booking in 30 min nel futuro DEVE fallire
    await createBookingRule({ role: 'studente', minAdvanceHours: 24 });

    const start = dayjs().add(30, 'minute').second(0).millisecond(0);
    const res = await request(app)
      .post('/api/admin/rules/preview')
      .set('Authorization', adminAuth)
      .send({
        role: 'studente',
        roomId: room.id,
        startTime: start.toISOString(),
        endTime: start.add(1, 'hour').toISOString(),
      });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('403 senza ruolo admin', async () => {
    const { authHeader } = await studentWithProfile();
    const room = await createRoom();
    const res = await request(app)
      .post('/api/admin/rules/preview')
      .set('Authorization', authHeader)
      .send({
        role: 'studente',
        roomId: room.id,
        startTime: '2030-01-01T10:00:00Z',
        endTime: '2030-01-01T11:00:00Z',
      });
    expect(res.status).toBe(403);
  });
});
