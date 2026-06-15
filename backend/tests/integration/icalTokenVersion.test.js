'use strict';

/**
 * Integrazione: il path Bearer-JWT dell'export iCal (GET /api/bookings/ical)
 * deve rispettare la revoca via tokenVersion, esattamente come il middleware
 * `authenticate`.
 *
 * Regressione coperta: prima del fix il ramo Bearer faceva solo
 * jwt.verify + findByPk SENZA confrontare payload.tokenVersion con
 * User.tokenVersion → un JWT revocato (logout / cambio password) restava
 * valido per esportare il calendario fino alla scadenza naturale.
 *
 * Il rate limiter è disabilitato di default in test (vedi rateLimit.js).
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createUser } = require('../factories');

const app = buildApp({ serveFrontend: false });

async function login(email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

describe('iCal export — Bearer JWT rispetta tokenVersion', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('un JWT valido esporta il calendario (text/calendar 200)', async () => {
    await createUser({ email: 'ical1@test.invalid', password: 'Password1!' });
    const token = await login('ical1@test.invalid', 'Password1!');

    const res = await request(app)
      .get('/api/bookings/ical')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.text).toContain('BEGIN:VCALENDAR');
  });

  it('un JWT revocato via logout NON può più esportare (401)', async () => {
    await createUser({ email: 'ical2@test.invalid', password: 'Password1!' });
    const token = await login('ical2@test.invalid', 'Password1!');

    // Pre-condizione: il token funziona prima della revoca.
    const before = await request(app)
      .get('/api/bookings/ical')
      .set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    // Logout → bump di tokenVersion lato server.
    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(200);

    // Stesso token, ora revocato: l'export iCal deve rifiutare.
    const after = await request(app)
      .get('/api/bookings/ical')
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('INVALID_TOKEN');
  });
});
