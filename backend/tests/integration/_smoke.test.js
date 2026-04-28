'use strict';

/**
 * Smoke test infrastrutturale: verifica che la pipeline (DB in-memory +
 * factories + supertest) sia funzionante. Se questo file fallisce, niente
 * test integrazione partirà.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createUser } = require('../factories');

const app = buildApp({ serveFrontend: false });

describe('infra smoke', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('expose /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('crea utente via factory e ne legge la mail', async () => {
    const u = await createUser({ email: 'smoke@test.invalid' });
    expect(u.email).toBe('smoke@test.invalid');
    expect(u.passwordHash).toMatch(/^\$2[ayb]\$/); // bcrypt hash
  });
});
