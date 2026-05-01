// =============================================================================
// SCENARIO 2 — Utenti loggati che leggono.
//
// Cosa simula:
//   Studenti/docenti che entrano in app, vedono il proprio profilo,
//   l'agenda, le proprie prenotazioni. È il workload "navigazione tipica"
//   dopo il login.
//
// Endpoint colpiti:
//   - GET /api/auth/me        ~20%
//   - GET /api/bookings?date=…  ~50% (lista prenotazioni del giorno)
//   - GET /api/public/agenda   ~25% (come kiosk, ma da utente loggato)
//   - GET /api/bookings/usage/me ~5% (quota usage check)
//
// Run:
//   USER_EMAIL=loadtest@conservatorio.it USER_PASSWORD=... \
//     k6 run --env BASE_URL=http://82.165.110.193:3000 --env TIER=medium \
//            --env USER_EMAIL=$USER_EMAIL --env USER_PASSWORD=$USER_PASSWORD \
//            loadtest/auth-read.js
//
// PREREQUISITO: un utente di test approvato e SENZA 2FA. Dedicato al
// load test — non riusare account reali, l'audit log si riempirebbe di
// rumore.
// =============================================================================

import http from 'k6/http';
import { check, group } from 'k6';
import { tier } from './lib/tiers.js';
import { thresholdsFor } from './lib/thresholds.js';
import { login, authHeaders } from './lib/auth.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const T = tier();

export const options = {
  scenarios: {
    auth_read: {
      executor: 'constant-arrival-rate',
      rate: T.auth.rate,
      timeUnit: '1s',
      duration: T.auth.duration,
      preAllocatedVUs: T.auth.preAllocatedVUs,
      maxVUs: T.auth.maxVUs,
    },
  },
  thresholds: thresholdsFor(),
  tags: { tier: T.label, scenario: 'auth-read' },
};

// setup() gira UNA volta, prima dei VU. Il return è passato come `data`
// alle iterazioni — così tutti i VU condividono lo stesso JWT senza
// triggerare il loginLimiter (5/15min/IP).
export function setup() {
  return login(BASE_URL, __ENV.USER_EMAIL, __ENV.USER_PASSWORD);
}

function pickEndpoint() {
  const r = Math.random();
  const today = new Date().toISOString().slice(0, 10);
  if (r < 0.20) return { path: '/api/auth/me', label: 'auth_me' };
  if (r < 0.70) return { path: `/api/bookings?from=${today}&to=${today}`, label: 'my_bookings' };
  if (r < 0.95) return { path: `/api/public/agenda?date=${today}`, label: 'agenda' };
  return { path: '/api/bookings/usage/me', label: 'quota_usage' };
}

export default function (data) {
  const headers = authHeaders(data.token);
  group('auth', () => {
    const ep = pickEndpoint();
    const res = http.get(`${BASE_URL}${ep.path}`, {
      headers,
      tags: { name: ep.label, expected: 'true' },
    });
    check(res, {
      'status 2xx': (r) => r.status >= 200 && r.status < 300,
    });
  });
}
