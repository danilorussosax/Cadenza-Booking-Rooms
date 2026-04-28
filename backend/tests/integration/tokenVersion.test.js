'use strict';

/**
 * Integrazione: invalidazione delle sessioni via User.tokenVersion.
 *
 * Pattern testato:
 *   - Un JWT firmato con tokenVersion=N resta valido finché l'utente ha
 *     ancora tokenVersion=N. Bumpando lato server (logout, change-password,
 *     forced revoke) → 401 con code='TOKEN_REVOKED'.
 *
 * Il rate limiter è disabilitato di default in test (vedi rateLimit.js).
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createUser } = require('../factories');

const app = buildApp({ serveFrontend: false });

async function loginAndGetToken(email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

describe('tokenVersion — invalidazione sessioni', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('un JWT valido lascia accedere a /api/auth/me', async () => {
    await createUser({ email: 'tv1@test.invalid', password: 'Password1!' });
    const token = await loginAndGetToken('tv1@test.invalid', 'Password1!');

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('tv1@test.invalid');
  });

  it('POST /api/auth/logout invalida tutti i JWT precedenti', async () => {
    await createUser({ email: 'tv2@test.invalid', password: 'Password1!' });
    const tokenA = await loginAndGetToken('tv2@test.invalid', 'Password1!');
    const tokenB = await loginAndGetToken('tv2@test.invalid', 'Password1!');

    // tokenA fa logout: bumpa tokenVersion → ENTRAMBI invalidi
    const out = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(out.status).toBe(200);

    for (const t of [tokenA, tokenB]) {
      const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${t}`);
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('TOKEN_REVOKED');
    }
  });

  it('change-password invalida i vecchi token e ritorna un nuovo JWT funzionante', async () => {
    await createUser({ email: 'tv3@test.invalid', password: 'OldPwd123!' });
    const oldToken = await loginAndGetToken('tv3@test.invalid', 'OldPwd123!');

    const cp = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPassword: 'OldPwd123!', newPassword: 'NewPwd123!' });
    expect(cp.status).toBe(200);
    expect(cp.body.token).toBeTruthy(); // backend riemette un token
    const newToken = cp.body.token;

    // Vecchio token: 401 TOKEN_REVOKED
    const oldUse = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(oldUse.status).toBe(401);
    expect(oldUse.body.code).toBe('TOKEN_REVOKED');

    // Nuovo token: 200
    const newUse = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${newToken}`);
    expect(newUse.status).toBe(200);
  });

  it('un bump manuale di tokenVersion (es. forced revoke admin) invalida il token', async () => {
    const user = await createUser({ email: 'tv4@test.invalid', password: 'Password1!' });
    const token = await loginAndGetToken('tv4@test.invalid', 'Password1!');

    // Verifica che funzioni
    const ok = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);

    // Forced revoke
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    const ko = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(ko.status).toBe(401);
    expect(ko.body.code).toBe('TOKEN_REVOKED');
  });
});
