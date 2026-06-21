'use strict';

/**
 * Unit test del middleware originGuard.
 *
 * Il guard è bypassato quando `NODE_ENV === 'test'` (vedi setup.js, perché
 * supertest non invia Origin e farebbe fallire tutte le route POST). Per
 * testarlo dobbiamo simulare un ambiente non-test sostituendo temporaneamente
 * la variabile e invocando il middleware come funzione pura.
 */

// Vitest 4: niente require('vitest'). I globals describe/it/expect/beforeEach
// /afterEach sono iniettati da vitest.config.js (option `globals: true`).

describe('originGuard', () => {
  let originalNodeEnv;
  let originalFrontendUrl;
  let originGuard;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalFrontendUrl = process.env.FRONTEND_URL;
    // Forza ambiente "non-test" per attivare il guard.
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://cadenza.example.it';
    // Re-require per pulire eventuale cache module-level (non ci sono singleton
    // qui, ma è una garanzia in più).
    delete require.cache[require.resolve('../../middleware/originGuard')];
    ({ originGuard } = require('../../middleware/originGuard'));
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  function makeReq({
    method = 'POST',
    path = '/api/bookings',
    baseUrl = '',
    origin,
    referer,
    host = 'cadenza.example.it',
  } = {}) {
    const headers = {};
    if (origin) headers.origin = origin;
    if (referer) headers.referer = referer;
    if (host) headers.host = host;
    return {
      method,
      path,
      baseUrl,
      originalUrl: baseUrl + path,
      protocol: 'https',
      id: 'test-req-id',
      ip: '127.0.0.1',
      get(name) {
        return headers[name.toLowerCase()];
      },
    };
  }

  function makeRes() {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        res.statusCode = code;
        return res;
      },
      json(payload) {
        res.body = payload;
        return res;
      },
    };
    return res;
  }

  function run(req) {
    const res = makeRes();
    let called = false;
    const next = () => {
      called = true;
    };
    originGuard(req, res, next);
    return { res, nextCalled: called };
  }

  it('passa le richieste GET senza controllo', () => {
    const { nextCalled, res } = run(
      makeReq({ method: 'GET', origin: 'https://attacker.example.com' }),
    );
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('passa OPTIONS (preflight CORS)', () => {
    const { nextCalled } = run(makeReq({ method: 'OPTIONS' }));
    expect(nextCalled).toBe(true);
  });

  it('passa HEAD', () => {
    const { nextCalled } = run(makeReq({ method: 'HEAD' }));
    expect(nextCalled).toBe(true);
  });

  it('blocca POST cross-origin senza Origin/Referer', () => {
    const { nextCalled, res } = run(makeReq({ method: 'POST' }));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'ORIGIN_FORBIDDEN' });
  });

  it('blocca POST con Origin malevola', () => {
    const { nextCalled, res } = run(
      makeReq({ method: 'POST', origin: 'https://attacker.example.com' }),
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('blocca PUT con Origin che spoofa il dominio (typosquatting)', () => {
    const { nextCalled, res } = run(
      makeReq({ method: 'PUT', origin: 'https://cadenza.example.it.attacker.com' }),
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('accetta POST con Origin = FRONTEND_URL', () => {
    const { nextCalled } = run(makeReq({ method: 'POST', origin: 'https://cadenza.example.it' }));
    expect(nextCalled).toBe(true);
  });

  it('accetta DELETE con Origin same-origin (host del backend)', () => {
    const { nextCalled } = run(makeReq({ method: 'DELETE', origin: 'https://cadenza.example.it' }));
    expect(nextCalled).toBe(true);
  });

  it('accetta POST con Referer (fallback quando Origin non c’è)', () => {
    const { nextCalled } = run(
      makeReq({ method: 'POST', referer: 'https://cadenza.example.it/admin/users' }),
    );
    expect(nextCalled).toBe(true);
  });

  it('bypassa il guard sul webhook messaging (chiamata server-to-server)', () => {
    const { nextCalled } = run(makeReq({ method: 'POST', path: '/api/messaging/whatsapp' }));
    expect(nextCalled).toBe(true);
  });

  it('bypassa il guard sul CSP report endpoint', () => {
    const { nextCalled } = run(makeReq({ method: 'POST', path: '/api/csp-report' }));
    expect(nextCalled).toBe(true);
  });

  // Regression: con `app.use('/api/', originGuard)` Express strippa il mount
  // point, quindi a runtime `req.path` è `/messaging/...` e `req.baseUrl` è
  // `/api`. Se l'esenzione guardasse solo `req.path` (prefissi con `/api/`),
  // il webhook Telegram verrebbe bloccato con 403 (origin null) e il bot
  // resterebbe muto — esattamente il bug osservato in produzione.
  it('bypassa il webhook anche con path strippato dal mount /api (req.baseUrl)', () => {
    const { nextCalled } = run(
      makeReq({ method: 'POST', baseUrl: '/api', path: '/messaging/telegram/webhook' }),
    );
    expect(nextCalled).toBe(true);
  });

  it('bypassa il CSP report anche con path strippato dal mount /api', () => {
    const { nextCalled } = run(makeReq({ method: 'POST', baseUrl: '/api', path: '/csp-report' }));
    expect(nextCalled).toBe(true);
  });

  it('in dev (NODE_ENV!=production) accetta Origin localhost qualsiasi porta', () => {
    process.env.NODE_ENV = 'development';
    delete require.cache[require.resolve('../../middleware/originGuard')];
    ({ originGuard } = require('../../middleware/originGuard'));

    const { nextCalled } = run(makeReq({ method: 'POST', origin: 'http://localhost:5173' }));
    expect(nextCalled).toBe(true);
  });

  it('in dev rifiuta comunque Origin non-localhost se non whitelistata', () => {
    process.env.NODE_ENV = 'development';
    delete require.cache[require.resolve('../../middleware/originGuard')];
    ({ originGuard } = require('../../middleware/originGuard'));

    const { nextCalled, res } = run(
      makeReq({ method: 'POST', origin: 'https://attacker.example.com', host: 'localhost:3199' }),
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('quando NODE_ENV=test bypassa qualunque controllo', () => {
    process.env.NODE_ENV = 'test';
    delete require.cache[require.resolve('../../middleware/originGuard')];
    ({ originGuard } = require('../../middleware/originGuard'));

    const { nextCalled } = run(makeReq({ method: 'POST', origin: 'https://attacker.example.com' }));
    expect(nextCalled).toBe(true);
  });
});
