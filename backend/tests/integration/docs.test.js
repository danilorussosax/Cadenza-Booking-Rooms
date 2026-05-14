'use strict';

/**
 * Integrazione: /api/docs/:slug — manuali in-app.
 *
 * Verifica:
 *   - GET /api/docs (lista) restituisce voci filtrate per ruolo
 *   - GET /api/docs/docente riservato a docente + admin
 *   - GET /api/docs/studente riservato a studente + admin
 *   - GET /api/docs/admin riservato agli admin
 *   - Manuali "altrui" tornano 403 (es. studente non legge docente)
 *   - Filename screenshot validato (no path traversal)
 *   - Manuale inesistente → 404
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAuthedUser, createAdmin } = require('../factories');

const app = buildApp({ serveFrontend: false });

describe('GET /api/docs', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('lista per docente: solo "docente"', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app).get('/api/docs').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const slugs = res.body.manuals.map((m) => m.slug);
    expect(slugs).toEqual(['docente']);
  });

  it('lista per studente: solo "studente"', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/docs').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const slugs = res.body.manuals.map((m) => m.slug);
    expect(slugs).toEqual(['studente']);
  });

  it('lista per admin: tutti e tre i manuali', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).get('/api/docs').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const slugs = res.body.manuals.map((m) => m.slug);
    expect(slugs).toEqual(expect.arrayContaining(['admin', 'docente', 'studente']));
    expect(slugs).toHaveLength(3);
  });

  it('GET /api/docs/docente OK per docente', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app).get('/api/docs/docente').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.text).toContain('Cadenza · Manuale Docente');
  });

  it('GET /api/docs/studente OK per studente', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/docs/studente').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.text).toContain('Cadenza · Manuale Studente');
  });

  it('GET /api/docs/studente negato al docente (403)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app).get('/api/docs/studente').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('GET /api/docs/docente negato allo studente (403)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/docs/docente').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('GET /api/docs/admin negato al docente (403)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app).get('/api/docs/admin').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('GET /api/docs/admin negato allo studente (403)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/docs/admin').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('GET /api/docs/admin OK per admin', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).get('/api/docs/admin').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Manuale Amministratore');
  });

  it('admin può leggere il manuale studente', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).get('/api/docs/studente').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Cadenza · Manuale Studente');
  });

  it('admin può leggere il manuale docente', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).get('/api/docs/docente').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Cadenza · Manuale Docente');
  });

  it('GET /api/docs/inesistente → 404', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).get('/api/docs/futuro').set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });

  it('senza auth → 401', async () => {
    const res = await request(app).get('/api/docs/docente');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/docs/:slug/screenshots/:file', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('screenshot esistente: 200 image/png (rotta nidificata)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app)
      .get('/api/docs/docente/screenshots/login.png')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  it('screenshot esistente accessibile pubblicamente (rotta flat, senza auth)', async () => {
    // Necessario perché <img> HTML non può passare Authorization header.
    const res = await request(app).get('/api/docs/screenshots/login.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  it('filename non valido (path traversal) → 400', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/docs/admin/screenshots/..%2F..%2Fpackage.json')
      .set('Authorization', authHeader);
    // express decodifica %2F; il filename risultante non passa la regex
    expect([400, 404]).toContain(res.status);
  });

  it('screenshot inesistente → 404', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app)
      .get('/api/docs/docente/screenshots/inesistente-zzz.png')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});
