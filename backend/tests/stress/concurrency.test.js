'use strict';

/**
 * Stress test "in-process" — esercitano i punti caldi di concorrenza della
 * piattaforma senza richiedere infrastruttura esterna (no k6, no server live).
 * Girano dentro la suite Vitest in pochi secondi.
 *
 * Strategia DB:
 *   - I test che esercitano transazioni in PARALLELO (anti-overlap booking,
 *     amendment budget, module flap durante toggle) richiedono semantica
 *     concorrente vera. SQLite usa lock globale write → le concurrent
 *     transactions vanno in deadlock interno ("cannot rollback - no
 *     transaction is active"). Questi test sono quindi `Postgres only`
 *     (skippati sotto SQLite, come `excludeConstraint.test.js`).
 *   - I test di READ throughput e di latency p95 SEQUENZIALE funzionano
 *     anche sotto SQLite e girano sempre.
 *
 * Per lanciare i Postgres-only:
 *   DB_DIALECT=postgres DB_HOST=localhost DB_NAME=cadenza_test \
 *   DB_USER=cadenza DB_PASSWORD=... DB_SSL=false \
 *     npx vitest run tests/stress/concurrency.test.js
 *
 * Per misurazioni hard di throughput VPS reale, usa invece `loadtest/*.js`
 * (k6) — questi stress test sono "unit-level" sulla correttezza concorrente.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { sequelize, Booking, BookingRule } = require('../../models');
const {
  createAuthedUser,
  createAdmin,
  createRoom,
  createBookingRule,
  createCourse,
} = require('../factories');

const app = buildApp({ serveFrontend: false });
const isPostgres = sequelize.getDialect() === 'postgres';
const describeWrite = isPostgres ? describe : describe.skip;

// Tempi soglia (generosi per CI Github Actions con SQLite in-memory).
const SLA = {
  bookingP95Ms: 500,
  readP95Ms: 200,
  raceTotalMs: 10000,
};

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

// ============================================================
// READ-ONLY stress — OK sotto qualsiasi dialect
// ============================================================

describe('STRESS · Read throughput (cross-dialect)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('300 GET /api/rules concorrenti: tutti 200, avg sotto SLA', async () => {
    const { authHeader } = await createAdmin();

    // BookingRule ha UNIQUE su role → al massimo 3 righe (studente/docente/admin).
    // Per avere un payload realistico ce ne basta una per role.
    await createBookingRule({ role: 'studente' });
    await createBookingRule({ role: 'docente' });

    const t0 = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 300 }, () =>
        request(app).get('/api/rules').set('Authorization', authHeader),
      ),
    );
    const elapsed = Date.now() - t0;
    const ok = responses.filter((r) => r.status === 200).length;
    console.log(
      `[rules read] reqs=300 ok=${ok} total=${elapsed}ms avg=${Math.round(elapsed / 300)}ms`,
    );
    expect(ok).toBe(300);
    expect(elapsed / 300).toBeLessThan(SLA.readP95Ms);
  });

  it('200 GET /api/bookings concorrenti su 500 prenotazioni: nessuna 5xx', async () => {
    const course = await createCourse();
    const { user: docente, authHeader } = await createAuthedUser({
      role: 'docente',
      courseId: course.id,
    });
    const room = await createRoom();

    // Pre-popola 500 prenotazioni del docente (tutte passate, niente
    // overlap perché orari distinti). Usiamo bulkCreate per velocità.
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 500; i++) {
      const start = new Date(now - 365 * 86400000 + i * 3600000);
      const end = new Date(start.getTime() + 1800000);
      rows.push({
        userId: docente.id,
        roomId: room.id,
        startTime: start,
        endTime: end,
        type: 'lezione',
        status: 'confirmed',
      });
    }
    await Booking.bulkCreate(rows);

    const t0 = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 200 }, () =>
        request(app).get('/api/bookings').query({ limit: 50 }).set('Authorization', authHeader),
      ),
    );
    const elapsed = Date.now() - t0;
    const internal = responses.filter((r) => r.status >= 500);
    const ok = responses.filter((r) => r.status === 200).length;
    console.log(`[bookings/me read] reqs=200 ok=${ok} 5xx=${internal.length} total=${elapsed}ms`);
    expect(internal).toHaveLength(0);
    expect(ok).toBeGreaterThanOrEqual(195); // tolleranza minima
  });

  it('latenza p95 di 20 booking SEQUENZIALI resta sotto SLA', async () => {
    // Test sequenziale (no concorrenza) — valuta latenza single-request
    // del path createBooking. Funziona ovunque.
    const room = await createRoom();
    const course = await createCourse();
    const { authHeader } = await createAuthedUser({ role: 'docente', courseId: course.id });
    await BookingRule.create({
      role: 'docente',
      maxHoursPerDay: 24,
      maxHoursPerWeek: 168,
      maxActiveBookings: 200,
      maxBookingDurationMinutes: 240,
      minBookingDurationMinutes: 15,
      maxAdvanceDays: 365,
      minAdvanceHours: 0,
      cancellationDeadlineHours: 0,
      allowRecurring: true,
      allowNightHours: true,
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
    });

    const latencies = [];
    const base = new Date();
    base.setUTCDate(base.getUTCDate() + 1);
    base.setUTCHours(8, 0, 0, 0);
    for (let i = 0; i < 20; i++) {
      const start = new Date(base.getTime() + i * 60 * 60 * 1000).toISOString();
      const end = new Date(base.getTime() + (i + 1) * 60 * 60 * 1000).toISOString();
      const t = Date.now();
      const r = await request(app)
        .post('/api/bookings')
        .set('Authorization', authHeader)
        .send({ roomId: room.id, startTime: start, endTime: end, type: 'lezione' });
      latencies.push(Date.now() - t);
      if (r.status !== 201) {
        // Una sola volta, per capire la causa del rifiuto in CI
        console.log(`[booking seq] status=${r.status} body=`, JSON.stringify(r.body).slice(0, 300));
      }
      expect(r.status).toBe(201);
    }
    latencies.sort((a, b) => a - b);
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const max = latencies[latencies.length - 1];
    console.log(`[booking seq p95] median=${p50}ms p95=${p95}ms max=${max}ms`);
    expect(p95).toBeLessThan(SLA.bookingP95Ms);
  });

  it('100 login concorrenti: nessuna 5xx, nessun crash', async () => {
    await createAuthedUser({
      email: 'mass@login.test',
      password: 'Pass1234!',
      role: 'studente',
    });
    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        request(app).post('/api/auth/login').send({
          email: 'mass@login.test',
          password: 'Pass1234!',
        }),
      ),
    );
    const ok = responses.filter((r) => r.status === 200).length;
    const rateLimited = responses.filter((r) => r.status === 429).length;
    const internal = responses.filter((r) => r.status >= 500);
    console.log(`[mass login] ok=${ok} 429=${rateLimited} 5xx=${internal.length}`);
    expect(internal).toHaveLength(0);
    expect(ok + rateLimited).toBe(100);
  });
});

// ============================================================
// WRITE-HEAVY stress — solo Postgres (vedi nota in testa)
// ============================================================

describeWrite('STRESS · Anti-overlap booking (Postgres only)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    await createBookingRule({
      role: 'studente',
      maxHoursPerDay: 24,
      maxHoursPerWeek: 168,
      maxActiveBookings: 200,
      minAdvanceHours: 0,
      maxAdvanceDays: 365,
    });
  });

  it('50 prenotazioni concorrenti sulla stessa fascia: 1 sola vince', async () => {
    const room = await createRoom();
    const course = await createCourse();
    const users = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        createAuthedUser({
          role: 'studente',
          email: `s${i}@stress.test`,
          matricola: `STR${i}`,
          courseId: course.id,
        }),
      ),
    );
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(12, 0, 0, 0);
    const startTime = tomorrow.toISOString();
    const endTime = new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString();

    const t0 = Date.now();
    const responses = await Promise.all(
      users.map((u) =>
        request(app)
          .post('/api/bookings')
          .set('Authorization', u.authHeader)
          .send({ roomId: room.id, startTime, endTime, type: 'studio_individuale' }),
      ),
    );
    const elapsed = Date.now() - t0;
    const created = responses.filter((r) => r.status === 201).length;
    const conflicts = responses.filter(
      (r) => r.status === 409 || (r.status === 400 && r.body.code === 'BOOKING_CONFLICT'),
    ).length;
    const internal = responses.filter((r) => r.status >= 500);
    console.log(
      `[overlap pg] created=${created} conflicts=${conflicts} 5xx=${internal.length} elapsed=${elapsed}ms`,
    );
    expect(internal).toHaveLength(0);
    expect(created).toBe(1);
    expect(conflicts).toBeGreaterThanOrEqual(45);
    const dbCount = await Booking.count({
      where: { roomId: room.id, status: 'confirmed', startTime },
    });
    expect(dbCount).toBe(1);
    expect(elapsed).toBeLessThan(SLA.raceTotalMs);
  });
});

describeWrite('STRESS · Monte Ore amendment budget (Postgres only)', () => {
  let docente, proposalId, slotsActive;
  const MAX_AMENDMENTS = 3;

  beforeEach(async () => {
    await globalThis.resetDatabase();
    const {
      MonteOreProposal,
      MonteOreSchedule,
      MonteOreSlot,
      MonteOreSettings,
      Institute,
    } = require('../../models');
    const inst = await Institute.create({ name: 'I', city: 'X' });
    await MonteOreSettings.create({
      instituteId: inst.id,
      academicYear: '2026/2027',
      academicYearStart: '2026-09-01',
      academicYearEnd: '2027-08-31',
      lessonsStartDate: '2026-10-01',
      lessonsEndDate: '2027-06-30',
      submissionWindowStart: '2026-09-01',
      submissionWindowEnd: '2027-08-31',
      minRequiredHours: 1,
      maxAmendmentsPerYear: MAX_AMENDMENTS,
    });

    docente = await createAuthedUser({ role: 'docente' });
    const room = await createRoom();
    const prop = await MonteOreProposal.create({
      userId: docente.user.id,
      academicYear: '2026/2027',
      validFrom: '2026-10-01',
      validTo: '2027-06-30',
      totalHoursRequested: 10,
      status: 'approved', // approved (non generated) → meno effetti collaterali
      submittedAt: new Date(),
      approvedAt: new Date(),
      minRequiredHoursSnapshot: 1,
      amendmentCount: 0,
    });
    proposalId = prop.id;
    const sched = await MonteOreSchedule.create({
      proposalId: prop.id,
      roomId: room.id,
      dayOfWeek: 1,
      startTime: '14:00',
      endTime: '15:00',
      bookingType: 'lezione',
    });
    const today = new Date();
    slotsActive = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date(today.getTime() + i * 7 * 86400000);
      const s = await MonteOreSlot.create({
        proposalId: prop.id,
        scheduleId: sched.id,
        date: d.toISOString().slice(0, 10),
        dayOfWeek: 1,
        startTime: '14:00',
        endTime: '15:00',
        isActive: false,
        originalActive: false,
        isLocked: false,
      });
      slotsActive.push(s.id);
    }
  });

  it('10 toggle_on concorrenti: esattamente 3 passano (maxAmend=3)', async () => {
    const t0 = Date.now();
    const responses = await Promise.all(
      slotsActive.map((slotId) =>
        request(app)
          .post(`/api/monte-ore/me/slots/${slotId}/toggle`)
          .set('Authorization', docente.authHeader),
      ),
    );
    const elapsed = Date.now() - t0;
    const success = responses.filter(
      (r) =>
        r.status === 201 &&
        r.body.amendment &&
        ['auto_approved', 'approved'].includes(r.body.amendment.status),
    ).length;
    const limitReached = responses.filter(
      (r) => r.status === 400 && r.body.code === 'AMENDMENT_LIMIT_REACHED',
    ).length;
    const internal = responses.filter((r) => r.status >= 500);
    console.log(
      `[amend budget pg] success=${success} limit=${limitReached} 5xx=${internal.length} elapsed=${elapsed}ms`,
    );
    expect(internal).toHaveLength(0);
    expect(success).toBe(MAX_AMENDMENTS);
    expect(limitReached).toBe(slotsActive.length - MAX_AMENDMENTS);
    const { MonteOreProposal } = require('../../models');
    const fresh = await MonteOreProposal.findByPk(proposalId);
    expect(fresh.amendmentCount).toBe(MAX_AMENDMENTS);
  });
});

describeWrite('STRESS · Module flag toggle flap (Postgres only)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    const { Institute } = require('../../models');
    await Institute.create({ name: 'I', city: 'X' });
  });

  it('toggle ON/OFF ripetuto: le rotte rispecchiano lo stato corrente', async () => {
    const { authHeader } = await createAdmin();

    for (let i = 0; i < 10; i++) {
      let r = await request(app)
        .put('/api/structure/module-settings')
        .set('Authorization', authHeader)
        .send({ moduleMonteOreEnabled: false });
      expect(r.status).toBe(200);

      r = await request(app).get('/api/monte-ore/me').set('Authorization', authHeader);
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('MODULE_DISABLED');

      r = await request(app)
        .put('/api/structure/module-settings')
        .set('Authorization', authHeader)
        .send({ moduleMonteOreEnabled: true });
      expect(r.status).toBe(200);

      r = await request(app).get('/api/monte-ore/me').set('Authorization', authHeader);
      expect(r.status).not.toBe(404);
    }
  });
});
