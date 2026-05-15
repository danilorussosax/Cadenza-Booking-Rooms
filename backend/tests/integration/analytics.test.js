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
const { createAuthedUser, createAdmin, createBooking, createRoom } = require('../factories');

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

describe('GET /api/admin/analytics/export.csv', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza JWT', async () => {
    const res = await request(app).get('/api/admin/analytics/export.csv');
    expect(res.status).toBe(401);
  });

  it('403 per utente non-admin', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .get('/api/admin/analytics/export.csv')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('400 per range date invalido', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/analytics/export.csv?dateFrom=2030-12-31&dateTo=2030-01-01')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
  });

  it('200 con CSV vuoto se non ci sono booking nel range', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/analytics/export.csv')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="analytics-/);
    // Solo BOM + header riga (no record).
    expect(res.text).toMatch(/^\uFEFFid,start,end,/);
  });

  it('200 con CSV popolato include i campi di una booking', async () => {
    const { authHeader, user: admin } = await createAdmin();
    const room = await createRoom();
    // Booking nel range default (ultimi 30gg → oggi). Usiamo "ieri".
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await createBooking({
      user: admin,
      room,
      startTime: start,
      endTime: end,
      status: 'confirmed',
      type: 'studio_individuale',
    });

    const res = await request(app)
      .get('/api/admin/analytics/export.csv')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    // Almeno una riga oltre l'header (split CR/LF tollerante).
    const lines = res.text.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // L'header CSV contiene tutte le colonne attese
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('durationHours');
    expect(lines[0]).toContain('ghosted');
    expect(lines[0]).toContain('email');
    // La riga record contiene email/role dell'admin
    expect(res.text).toContain(admin.email);
    expect(res.text).toContain('confirmed');
  });

  it('valorizza ghosted=yes per booking con autoCancelledAt', async () => {
    const { authHeader, user: admin } = await createAdmin();
    const room = await createRoom();
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await createBooking({
      user: admin,
      room,
      startTime: start,
      endTime: end,
      status: 'cancelled',
      autoCancelledAt: new Date(),
    });

    const res = await request(app)
      .get('/api/admin/analytics/export.csv')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    // Cerca esattamente "yes" nel campo ghosted (8a colonna circa).
    const dataLine = res.text.split(/\r?\n/).filter(Boolean)[1];
    expect(dataLine).toContain(',cancelled,yes,');
  });
});
