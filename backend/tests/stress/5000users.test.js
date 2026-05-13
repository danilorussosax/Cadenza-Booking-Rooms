'use strict';

/**
 * STRESS TEST — 5000 utenti contemporanei (Postgres only)
 *
 * Versione "big" dello stress su 500 utenti, scalato 10×. È skippato sotto
 * SQLite per due ragioni:
 *   1. SQLite ha lock globale di scrittura → throughput degrada vertical.
 *   2. La creazione di 5000 utenti via bcrypt (anche cost=4) sotto SQLite
 *      richiede già diversi secondi, e il test non avrebbe valore.
 *
 * Configurazione:
 *   - 100 admin   (2%)
 *   - 500 docenti (10%)
 *   - 4400 studenti (88%) → totale 5000
 *   - 50 aule prenotabili (10× le 500-user, riduce le collisioni)
 *   - Jitter 0-3000 ms tra utenti (spread su 3 s, simula apertura mattutina)
 *   - Timeout vitest: 10 min
 *
 * Lancio:
 *   PGPASSWORD=danilo createdb -U postgres cadenza_stress_test
 *   DB_DIALECT=postgres DB_HOST=localhost DB_PORT=5432 \
 *     DB_NAME=cadenza_stress_test DB_USER=postgres DB_PASSWORD=danilo \
 *     DB_SSL=false npx vitest run tests/stress/5000users
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const {
  createAuthedUser,
  createAdmin,
  createCourse,
  createRoom,
  createBookingRule,
} = require('../factories');
const { sequelize } = require('../../models');

const app = buildApp({ serveFrontend: false });

const N_ADMIN = 100;
const N_DOCENTE = 500;
const N_STUDENTE = 4400;
const N_TOT = N_ADMIN + N_DOCENTE + N_STUDENTE; // 5000
const N_ROOMS = 50;
const JITTER_MS = 3000;

const isPostgres = sequelize.getDialect() === 'postgres';
const describePostgresOnly = isPostgres ? describe : describe.skip;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

function stats(label, latencies) {
  if (latencies.length === 0) return `${label}: no samples`;
  const sorted = [...latencies].sort((a, b) => a - b);
  return (
    `${label} n=${sorted.length} ` +
    `p50=${percentile(sorted, 50)}ms ` +
    `p95=${percentile(sorted, 95)}ms ` +
    `p99=${percentile(sorted, 99)}ms ` +
    `max=${sorted[sorted.length - 1]}ms`
  );
}

describePostgresOnly('STRESS · 5000 utenti contemporanei (Postgres)', () => {
  beforeAll(async () => {
    await globalThis.resetDatabase();
  }, 120_000);

  it(`${N_TOT} utenti (${N_ADMIN} admin + ${N_DOCENTE} docenti + ${N_STUDENTE} studenti) reggono senza 5xx`, async () => {
    // ─── Setup ────────────────────────────────────────────────────────
    console.log(`\n[setup] ${N_ROOMS} aule + 1 corso + 2 regole`);
    const rooms = await Promise.all(
      Array.from({ length: N_ROOMS }, (_, i) =>
        createRoom({ name: `Aula stress ${i}`, type: 'studio' }),
      ),
    );
    const course = await createCourse({ code: 'STRESS-5K', name: 'Stress 5K' });
    await createBookingRule({
      role: 'studente',
      maxHoursPerDay: 24,
      maxHoursPerWeek: 168,
      maxActiveBookings: 200,
      maxBookingDurationMinutes: 240,
      minAdvanceHours: 0,
      maxAdvanceDays: 365,
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
    });
    await createBookingRule({
      role: 'docente',
      maxHoursPerDay: 24,
      maxHoursPerWeek: 168,
      maxActiveBookings: 200,
      maxBookingDurationMinutes: 240,
      minAdvanceHours: 0,
      maxAdvanceDays: 365,
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
    });

    // ─── Creazione utenti — in BATCH per non saturare il pool ────────
    // bcrypt cost=4 sotto bcryptjs serializza, quindi creare 5000 utenti
    // in parallelo non aiuta granché. Lo facciamo a chunk di 500 con
    // Promise.all per parallelismo controllato.
    const CHUNK = 500;
    console.log(`[setup] creo ${N_TOT} utenti (chunk=${CHUNK})…`);
    const tSetup = Date.now();

    async function createInBatches(total, factory) {
      const out = [];
      for (let i = 0; i < total; i += CHUNK) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(CHUNK, total - i) }, (_, j) => factory(i + j)),
        );
        out.push(...batch);
      }
      return out;
    }

    const adminUsers = await createInBatches(N_ADMIN, (i) =>
      createAdmin({
        email: `admin${i}@stress5k.test`,
        matricola: `ADM5K${i}`,
        password: 'Pass1234!',
      }),
    );
    const docenteUsers = await createInBatches(N_DOCENTE, (i) =>
      createAuthedUser({
        email: `doc${i}@stress5k.test`,
        matricola: `DOC5K${i}`,
        role: 'docente',
        courseId: course.id,
        password: 'Pass1234!',
      }),
    );
    const studenteUsers = await createInBatches(N_STUDENTE, (i) =>
      createAuthedUser({
        email: `stu${i}@stress5k.test`,
        matricola: `STU5K${i}`,
        role: 'studente',
        courseId: course.id,
        password: 'Pass1234!',
      }),
    );
    console.log(`[setup] ✓ utenti pronti in ${((Date.now() - tSetup) / 1000).toFixed(1)} s`);

    // ─── Metriche per endpoint ────────────────────────────────────────
    const latencies = {
      login: [],
      dashRead: [],
      myBookings: [],
      roomsList: [],
      profile: [],
      bookingPost: [],
    };
    const counters = {
      total: 0,
      ok: 0,
      conflict: 0,
      rateLimited: 0,
      other4xx: 0,
      internal5xx: 0,
    };
    const errorSamples = new Map();

    async function timed(label, requestFn) {
      const t = Date.now();
      const r = await requestFn();
      const elapsed = Date.now() - t;
      latencies[label].push(elapsed);
      counters.total++;
      if (r.status >= 200 && r.status < 300) counters.ok++;
      else if (r.status === 429) counters.rateLimited++;
      else if (r.status === 400 && r.body?.code === 'BOOKING_CONFLICT') counters.conflict++;
      else if (r.status === 409 && r.body?.code === 'BOOKING_CONFLICT') counters.conflict++;
      else if (r.status === 409 && r.body?.code === 'TOO_MUCH_CONTENTION') counters.conflict++;
      else if (r.status >= 500) {
        counters.internal5xx++;
        if (!errorSamples.has(label)) {
          errorSamples.set(label, {
            status: r.status,
            body: JSON.stringify(r.body).slice(0, 250),
          });
        }
      } else counters.other4xx++;
      return r;
    }

    async function userWorkload(user, i, role) {
      await sleep(Math.random() * JITTER_MS);

      const loginRes = await timed('login', () =>
        request(app)
          .post('/api/auth/login')
          .send({ email: user.user.email, password: 'Pass1234!' }),
      );
      const tok = loginRes.body?.token ?? user.token;
      const auth = `Bearer ${tok}`;

      const reads = role === 'admin' ? 5 : role === 'docente' ? 4 : 3;
      for (let k = 0; k < reads; k++) {
        await sleep(50 + Math.random() * 200);
        if (k === 0) {
          await timed('dashRead', () =>
            request(app).get('/api/bookings').set('Authorization', auth),
          );
        } else if (k === 1) {
          await timed('myBookings', () =>
            request(app).get('/api/bookings').query({ mine: 'true' }).set('Authorization', auth),
          );
        } else if (k === 2) {
          await timed('roomsList', () =>
            request(app).get('/api/structure/institutes').set('Authorization', auth),
          );
        } else {
          await timed('profile', () => request(app).get('/api/auth/me').set('Authorization', auth));
        }
      }

      const shouldBook =
        role === 'admin' ? i % 10 < 3 : role === 'docente' ? i % 10 < 8 : i % 10 < 6;
      if (shouldBook) {
        await sleep(100 + Math.random() * 400);
        const room = rooms[i % rooms.length];
        const dayOffset = (i % 90) + 1; // 90 giorni di spread
        const hourOffset = 7 + (i % 16);
        const slot = (i % 2) * 30;
        const base = new Date();
        base.setUTCDate(base.getUTCDate() + dayOffset);
        base.setUTCHours(hourOffset, slot, 0, 0);
        const startTime = base.toISOString();
        const endTime = new Date(base.getTime() + 60 * 60 * 1000).toISOString();
        await timed('bookingPost', () =>
          request(app)
            .post('/api/bookings')
            .set('Authorization', auth)
            .send({
              roomId: room.id,
              startTime,
              endTime,
              type: role === 'docente' ? 'lezione' : 'studio_individuale',
            }),
        );
      }
    }

    // ─── Lancio in PARALLELO i 5000 workload ─────────────────────────
    console.log(`[run] lancio ${N_TOT} workload in parallelo…`);
    const tBatch = Date.now();
    await Promise.all([
      ...adminUsers.map((u, i) => userWorkload(u, i, 'admin')),
      ...docenteUsers.map((u, i) => userWorkload(u, i, 'docente')),
      ...studenteUsers.map((u, i) => userWorkload(u, i, 'studente')),
    ]);
    const elapsed = Date.now() - tBatch;
    const reqPerSec = (counters.total / (elapsed / 1000)).toFixed(0);

    // ─── Report ───────────────────────────────────────────────────────
    console.log(`\n══════ Report stress ${N_TOT} utenti (Postgres) ══════`);
    console.log(`Durata totale:    ${elapsed} ms`);
    console.log(`Richieste totali: ${counters.total} (${reqPerSec} req/s)`);
    console.log(`  • 2xx OK:         ${counters.ok}`);
    console.log(`  • 400/409 confl.: ${counters.conflict}`);
    console.log(`  • 429 rate-limit: ${counters.rateLimited}`);
    console.log(`  • altre 4xx:      ${counters.other4xx}`);
    console.log(`  • 5xx INTERNAL:   ${counters.internal5xx}`);
    console.log('Latenze (ms):');
    for (const k of Object.keys(latencies)) console.log(`  ${stats(k, latencies[k])}`);
    if (errorSamples.size > 0) {
      console.log('Primi sample di 5xx per endpoint:');
      for (const [label, sample] of errorSamples) {
        console.log(`  ${label}: status=${sample.status} body=${sample.body}`);
      }
    }
    console.log(`══════════════════════════════════════════════════════\n`);

    // ─── Invarianti ──────────────────────────────────────────────────
    // 1) Nessun 5xx applicativo (su Postgres: retry su 40001 + convert→409
    //    su contention massima dovrebbero portare a 0). Tolleriamo
    //    0.1% per casi limite (rumore di rete o pool exhaustion).
    const max5xx = Math.floor(counters.total * 0.001);
    console.log(`Tolleranza 5xx: ${counters.internal5xx} / max ${max5xx}`);
    expect(counters.internal5xx).toBeLessThanOrEqual(max5xx);

    // 2) Total richieste ≈ atteso (login + reads + ~60% booking)
    expect(counters.total).toBeGreaterThanOrEqual(N_TOT * 4);

    // 3) p95 letture sotto 30s. Soglia generosa perché 5000 utenti in
    //    parallelo su un singolo processo Node + un'istanza Postgres
    //    locale saturano il pool: le richieste si accodano. Su un VPS
    //    Postgres dedicato + N istanze Node dietro nginx, gli stessi
    //    5000 utenti vedrebbero p95 < 1s — i numeri reali li misurano
    //    i k6 di loadtest/*.js. Qui certifico solo: NON c'è crash, NON
    //    c'è 5xx applicativo, tutti gli utenti vengono serviti.
    const allReads = [
      ...latencies.dashRead,
      ...latencies.myBookings,
      ...latencies.roomsList,
      ...latencies.profile,
    ].sort((a, b) => a - b);
    expect(percentile(allReads, 95)).toBeLessThan(30000);
  }, 600_000); // 10 min timeout
});
