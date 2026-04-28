'use strict';

/**
 * Integrazione: /api/admin/analytics.
 *
 * NOTA — Limite test su SQLite:
 *   Le query di analytics usano `EXTRACT(EPOCH FROM ...)`,
 *   `EXTRACT(DOW|HOUR ...)` e cast `::int` — sintassi Postgres che SQLite
 *   in-memory (DB di test) NON supporta. Per questo le aggregazioni
 *   vere (heatmap 7×24, top rooms, no-show rate) NON sono testate qui:
 *   andrebbero coperte da test E2E con Postgres in CI o da unit test
 *   sui mapper post-aggregazione.
 *
 * Cosa testiamo:
 *   - access control (401 senza auth, 403 per non-admin, 200 admin con
 *     400 sul range invalido — quindi prima del SQL Postgres)
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAuthedUser, createAdmin } = require('../factories');

const app = buildApp({ serveFrontend: false });

describe('GET /api/admin/analytics — access control', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza JWT', async () => {
    const res = await request(app).get('/api/admin/analytics');
    expect(res.status).toBe(401);
  });

  it('403 per utente non-admin', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/admin/analytics').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('400 per range date invalido (admin)', async () => {
    const { authHeader } = await createAdmin();
    // dateFrom > dateTo → range non valido
    const res = await request(app)
      .get('/api/admin/analytics?dateFrom=2030-12-31&dateTo=2030-01-01')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('export.pdf: 401 senza JWT', async () => {
    const res = await request(app).get('/api/admin/analytics/export.pdf');
    expect(res.status).toBe(401);
  });

  it('export.pdf: 403 per utente non-admin', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .get('/api/admin/analytics/export.pdf')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('export.pdf: 400 per range date invalido', async () => {
    // Valida ANCHE il PDF endpoint con range invalido (gateway prima del
    // SQL Postgres-only, così funziona pure su SQLite di test).
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/analytics/export.pdf?dateFrom=2030-12-31&dateTo=2030-01-01')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
  });
});
