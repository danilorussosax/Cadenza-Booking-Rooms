'use strict';

/**
 * Smoke test della dashboard ops (/admin/ops).
 *
 * Coperture:
 *   1. GET /api/admin/ops/snapshot senza auth → 401
 *   2. GET /api/admin/ops/snapshot come non-admin → 403
 *   3. GET /api/admin/ops/snapshot come admin → 200 con shape attesa
 *   4. ?force=1 bypassa la cache (capturedAt cambia)
 *   5. Schedulers ritornano tutti i 5 nomi attesi
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser } = require('../factories');
const { _resetCacheForTest } = require('../../services/opsSnapshot');

const app = buildApp({ serveFrontend: false });

describe('GET /api/admin/ops/snapshot', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    _resetCacheForTest();
  });

  it('senza auth → 401', async () => {
    const res = await request(app).get('/api/admin/ops/snapshot');
    expect(res.status).toBe(401);
  });

  it('come non-admin → 403', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/admin/ops/snapshot').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('come admin → 200 con shape completa', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).get('/api/admin/ops/snapshot').set('Authorization', authHeader);
    expect(res.status).toBe(200);

    expect(res.body).toMatchObject({
      capturedAt: expect.any(String),
      vps: expect.objectContaining({
        hostname: expect.any(String),
        platform: expect.any(String),
        cpuCount: expect.any(Number),
        loadAvg: expect.any(Array),
        memory: expect.objectContaining({
          totalBytes: expect.any(Number),
          freeBytes: expect.any(Number),
          usedBytes: expect.any(Number),
        }),
        uptimeSec: expect.any(Number),
        processUptimeSec: expect.any(Number),
        nodeVersion: expect.any(String),
      }),
      postgres: expect.objectContaining({
        dialect: expect.any(String),
        available: expect.any(Boolean),
      }),
      mailOutbox: expect.any(Object),
      backups: expect.any(Object),
      schedulers: expect.any(Array),
    });
  });

  it('ritorna i 6 scheduler attesi', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).get('/api/admin/ops/snapshot').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const names = res.body.schedulers.map((s) => s.name).sort();
    expect(names).toEqual([
      'backup',
      'backupVerify',
      'excelExport',
      'mailOutbox',
      'reminder',
      'retention',
    ]);
    // Tutti devono avere almeno enabled (false su test, schedulers non avviati)
    for (const s of res.body.schedulers) {
      expect(typeof s.enabled).toBe('boolean');
    }
  });

  it('?force=1 bypassa la cache', async () => {
    const { authHeader } = await createAdmin();
    const r1 = await request(app).get('/api/admin/ops/snapshot').set('Authorization', authHeader);
    expect(r1.status).toBe(200);
    const captured1 = r1.body.capturedAt;

    // Senza force, entro 5s la cache restituisce lo stesso oggetto.
    const r2 = await request(app).get('/api/admin/ops/snapshot').set('Authorization', authHeader);
    expect(r2.body.capturedAt).toBe(captured1);

    // Con force=1, ricalcola: capturedAt cambia (a meno di rare collisioni
    // ms — accettato come falso negativo non bloccante).
    const r3 = await request(app)
      .get('/api/admin/ops/snapshot?force=1')
      .set('Authorization', authHeader);
    expect(r3.status).toBe(200);
    expect(r3.body.capturedAt).not.toBe(captured1);
  });
});
