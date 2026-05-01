// =============================================================================
// SCENARIO 4 — Workload misto realistico.
//
// Esegue in PARALLELO i tre scenari (kiosk, auth-read, booking-write)
// con i pesi della fascia scelta. È il test che meglio approssima un
// orario di punta vero.
//
// Mix ricalcato su docs/analisivps.md:
//   - 70% kiosk public polling
//   - 25% utenti loggati in lettura
//   -  5% scritture (POST + DELETE prenotazione)
//
// Run:
//   ROOM_ID=... USER_EMAIL=... USER_PASSWORD=... \
//     k6 run --env BASE_URL=http://82.165.110.193:3000 --env TIER=medium \
//            --env USER_EMAIL=$USER_EMAIL --env USER_PASSWORD=$USER_PASSWORD \
//            --env ROOM_ID=$ROOM_ID loadtest/mixed.js
//
// Cosa guardare nei risultati:
//   - http_req_duration{group:public}  → kiosk SLA
//   - http_req_duration{group:auth}    → utenti loggati SLA
//   - http_req_duration{group:write}   → throughput POST sotto contention
//   - dropped_iterations               → se > 0 il VPS NON regge il rate
//                                        (k6 ha provato a iniettare ma
//                                         non aveva VU disponibili)
//   - vus_running picco                → quanti utenti virtuali "veri"
//                                        servivano per tenere il rate
// =============================================================================

import http from 'k6/http';
import { check, group } from 'k6';
import { Counter } from 'k6/metrics';
import { tier } from './lib/tiers.js';
import { thresholdsFor } from './lib/thresholds.js';
import { login, authHeaders } from './lib/auth.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ROOM_ID = Number(__ENV.ROOM_ID || 0);
const T = tier();

const collisions = new Counter('booking_collisions');

export const options = {
  scenarios: {
    s_public: {
      executor: 'constant-arrival-rate',
      exec: 'doPublic',
      rate: T.public.rate,
      timeUnit: '1s',
      duration: T.public.duration,
      preAllocatedVUs: T.public.preAllocatedVUs,
      maxVUs: T.public.maxVUs,
      tags: { scenario: 'kiosk' },
    },
    s_auth: {
      executor: 'constant-arrival-rate',
      exec: 'doAuth',
      rate: T.auth.rate,
      timeUnit: '1s',
      duration: T.auth.duration,
      preAllocatedVUs: T.auth.preAllocatedVUs,
      maxVUs: T.auth.maxVUs,
      tags: { scenario: 'auth' },
      startTime: '5s',  // staggering: kiosk parte per primo, auth dopo 5s
    },
    s_write: {
      executor: 'constant-arrival-rate',
      exec: 'doWrite',
      rate: T.write.rate,
      timeUnit: '1s',
      duration: T.write.duration,
      preAllocatedVUs: T.write.preAllocatedVUs,
      maxVUs: T.write.maxVUs,
      tags: { scenario: 'write' },
      startTime: '10s',
    },
  },
  thresholds: thresholdsFor({
    extra: { booking_collisions: ['count<100'] },
  }),
  tags: { tier: T.label, scenario: 'mixed' },
};

export function setup() {
  if (ROOM_ID) {
    return login(BASE_URL, __ENV.USER_EMAIL, __ENV.USER_PASSWORD);
  }
  // Senza ROOM_ID si gira solo public + auth (write disattivata via rate=0
  // non è facile in k6: l'utente lancia mixed-readonly.js per quel caso).
  console.warn('ROOM_ID non impostato: lo scenario s_write fallirà ad ogni iterazione');
  return login(BASE_URL, __ENV.USER_EMAIL, __ENV.USER_PASSWORD);
}

// ---------- KIOSK (no auth) ----------
function pickPublic() {
  const r = Math.random();
  const today = new Date().toISOString().slice(0, 10);
  if (r < 0.50) return `/api/public/agenda?date=${today}`;
  if (r < 0.75) return '/api/public/stats';
  if (r < 0.90) return '/api/public/announcements';
  if (r < 0.97) return '/api/public/concerts';
  return '/api/public/display-config';
}
export function doPublic() {
  group('public', () => {
    const res = http.get(`${BASE_URL}${pickPublic()}`, { tags: { expected: 'true' } });
    check(res, { 'status 200': (r) => r.status === 200 });
  });
}

// ---------- AUTH READ ----------
function pickAuth() {
  const r = Math.random();
  const today = new Date().toISOString().slice(0, 10);
  if (r < 0.20) return '/api/auth/me';
  if (r < 0.70) return `/api/bookings?from=${today}&to=${today}`;
  if (r < 0.95) return `/api/public/agenda?date=${today}`;
  return '/api/bookings/usage/me';
}
export function doAuth(data) {
  const headers = authHeaders(data.token);
  group('auth', () => {
    const res = http.get(`${BASE_URL}${pickAuth()}`, {
      headers, tags: { expected: 'true' },
    });
    check(res, { 'status 2xx': (r) => r.status >= 200 && r.status < 300 });
  });
}

// ---------- WRITE (CREATE + DELETE) ----------
function nextFreeSundayPlus(daysAhead) {
  const base = new Date(Date.now() + daysAhead * 86400_000);
  const dow = base.getUTCDay();
  const offset = (7 - dow) % 7 || 7;
  base.setUTCDate(base.getUTCDate() + offset);
  base.setUTCHours(8, 0, 0, 0);
  return base;
}
function slotFor(vuId, iter) {
  const week = Math.floor(iter / 32);
  const minuteOffset = ((vuId * 17) % 32 + (iter % 32)) * 15;
  const start = nextFreeSundayPlus(7 + week * 7);
  start.setUTCMinutes(start.getUTCMinutes() + minuteOffset);
  const end = new Date(start.getTime() + 15 * 60_000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}
export function doWrite(data) {
  if (!ROOM_ID) return;
  const headers = authHeaders(data.token);
  const slot = slotFor(__VU, __ITER);
  let bookingId = null;
  group('write', () => {
    const create = http.post(
      `${BASE_URL}/api/bookings`,
      JSON.stringify({
        roomId: ROOM_ID,
        startTime: slot.startTime,
        endTime: slot.endTime,
        type: 'studio_individuale',
        purpose: `loadtest k6 vu=${__VU} iter=${__ITER}`,
      }),
      { headers, tags: { name: 'booking_create', expected: 'true' } },
    );
    const ok = check(create, {
      'create 200/201 o 400 atteso': (r) =>
        r.status === 200 || r.status === 201 ||
        (r.status === 400 && /BOOKING_INVALID|QUOTA_EXCEEDED|ROOM_/.test(r.body || '')),
    });
    if (!ok) return;
    if (create.status >= 400) { collisions.add(1); return; }
    try { bookingId = create.json('booking.id') || create.json('id'); } catch (_) {}
  });
  if (bookingId) {
    group('write', () => {
      http.del(`${BASE_URL}/api/bookings/${bookingId}`, null, {
        headers, tags: { name: 'booking_delete', expected: 'true' },
      });
    });
  }
}
