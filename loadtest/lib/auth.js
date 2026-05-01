// =============================================================================
// Helper login per k6.
//
// PERCHE' fa il login UNA VOLTA NEL setup() e non per ogni iterazione:
//   POST /api/auth/login ha un loginLimiter di 5 tentativi / 15 min / IP
//   (backend/middleware/rateLimit.js:59). Se fai login per ogni VU vai in
//   429 al sesto tentativo nel giro di pochi secondi e il test si rompe.
//
// COME usare il token: setup() ritorna { token, userId } che viene
// passato come argomento a default(data). Tutti i VU condividono lo
// stesso JWT, esattamente come se fossero stessa sessione browser.
// =============================================================================

import http from 'k6/http';
import { check, fail } from 'k6';

export function login(baseUrl, email, password) {
  if (!email || !password) {
    fail('Login mancante: imposta USER_EMAIL e USER_PASSWORD via --env');
  }
  const res = http.post(
    `${baseUrl}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'setup_login' } },
  );
  const ok = check(res, {
    'login status 200': (r) => r.status === 200,
    'login restituisce token': (r) => {
      try { return !!r.json('token'); } catch (_) { return false; }
    },
  });
  if (!ok) {
    fail(`Login fallito (${res.status}): ${res.body?.slice?.(0, 200)}`);
  }
  if (res.json('needsTwoFa')) {
    fail('L\'utente ha 2FA attivo: usa un account dedicato al load test senza 2FA');
  }
  return {
    token: res.json('token'),
    userId: res.json('user.id'),
    role: res.json('user.role'),
  };
}

export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}
