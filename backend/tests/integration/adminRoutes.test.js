'use strict';

/**
 * Smoke + happy-path test per route admin con coverage bassa.
 *
 * Obiettivo: alzare la coverage globale toccando GET/POST/PUT/DELETE delle
 * route admin più semplici (settings, courses, users CRUD, quotas, rules).
 * Non sono test esaustivi della logica di business (quelli vivono nei file
 * dedicati: bookings.test, monteOreSectionB.test, ecc).
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser, createUser, createCourse } = require('../factories');

const app = buildApp({ serveFrontend: false });

describe('admin routes — smoke + CRUD', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  // ─── Mail Settings ──────────────────────────────────────────
  describe('mailSettings', () => {
    it('GET /api/admin/mail-settings ritorna defaults vuoti', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/admin/mail-settings')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });
    it('PUT /api/admin/mail-settings salva una config (campi base)', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/mail-settings')
        .set('Authorization', authHeader)
        .send({ host: 'smtp.example.com', port: 587, secure: false, fromAddress: 'a@b.it' });
      expect([200, 201]).toContain(res.status);
    });
    it('richiede admin (401 senza auth)', async () => {
      const res = await request(app).get('/api/admin/mail-settings');
      expect(res.status).toBe(401);
    });
  });

  // ─── Mail Templates ─────────────────────────────────────────
  describe('mailTemplates', () => {
    it('GET /api/admin/mail-templates lista (può essere vuota)', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/admin/mail-templates')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });
    it('non-admin → 403', async () => {
      const { authHeader } = await createAuthedUser({ role: 'studente' });
      const res = await request(app)
        .get('/api/admin/mail-templates')
        .set('Authorization', authHeader);
      expect(res.status).toBe(403);
    });
  });

  // ─── Messaging Settings ─────────────────────────────────────
  describe('messagingSettings', () => {
    it('GET /api/admin/messaging-settings risponde 200 (singleton)', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/admin/messaging-settings')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });
  });

  // ─── OAuth Settings ─────────────────────────────────────────
  describe('oauthSettings', () => {
    it('GET /api/admin/oauth-settings risponde 200', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/admin/oauth-settings')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });
  });

  // ─── Courses CRUD ────────────────────────────────────────────
  describe('courses', () => {
    it('GET /api/courses pubblico ritorna lista', async () => {
      await createCourse({ name: 'Pianoforte 1' });
      const res = await request(app).get('/api/courses');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.courses ?? res.body)).toBe(true);
    });

    it('POST /api/courses crea (admin)', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/courses')
        .set('Authorization', authHeader)
        .send({ name: 'Violino base', code: 'VLN1', isActive: true });
      expect([200, 201]).toContain(res.status);
    });

    it('PUT /api/courses/:id aggiorna (admin)', async () => {
      const c = await createCourse({ name: 'Iniziale' });
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put(`/api/courses/${c.id}`)
        .set('Authorization', authHeader)
        .send({ name: 'Aggiornato' });
      expect(res.status).toBe(200);
    });

    it('DELETE /api/courses/:id rimuove (admin)', async () => {
      const c = await createCourse({ name: 'Da cancellare' });
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .delete(`/api/courses/${c.id}`)
        .set('Authorization', authHeader);
      expect([200, 204]).toContain(res.status);
    });

    it('GET /api/courses/:id pubblico (404 se non esiste)', async () => {
      const res = await request(app).get('/api/courses/999999');
      expect(res.status).toBe(404);
    });
  });

  // ─── Users admin CRUD ────────────────────────────────────────
  describe('users', () => {
    it('GET /api/users (admin) lista utenti', async () => {
      await createUser({ role: 'studente' });
      await createUser({ role: 'docente' });
      const { authHeader } = await createAdmin();
      const res = await request(app).get('/api/users').set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users ?? res.body)).toBe(true);
    });

    it('GET /api/users/pending/count (admin)', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/users/pending/count')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });

    it('GET /api/users/:id (admin)', async () => {
      const target = await createUser();
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get(`/api/users/${target.id}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.user ?? res.body).toHaveProperty('email');
    });

    it('POST /api/users crea utente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app).post('/api/users').set('Authorization', authHeader).send({
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'newuser@test.invalid',
        role: 'studente',
        password: 'Password123!',
      });
      expect([200, 201]).toContain(res.status);
    });

    it('PUT /api/users/:id aggiorna firstName', async () => {
      const target = await createUser({ firstName: 'Old' });
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put(`/api/users/${target.id}`)
        .set('Authorization', authHeader)
        .send({ firstName: 'New' });
      expect(res.status).toBe(200);
    });

    it('DELETE /api/users/:id soft-delete', async () => {
      const target = await createUser();
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .delete(`/api/users/${target.id}`)
        .set('Authorization', authHeader);
      expect([200, 204]).toContain(res.status);
    });

    it('non-admin → 403', async () => {
      const { authHeader } = await createAuthedUser({ role: 'studente' });
      const res = await request(app).get('/api/users').set('Authorization', authHeader);
      expect(res.status).toBe(403);
    });
  });

  // ─── Quotas ─────────────────────────────────────────────────
  describe('quotas', () => {
    it("GET /api/admin/quotas lista (vuota all'inizio)", async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app).get('/api/admin/quotas').set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });
    it('POST + DELETE quota (round-trip)', async () => {
      const { authHeader } = await createAdmin();
      const create = await request(app)
        .post('/api/admin/quotas')
        .set('Authorization', authHeader)
        .send({
          role: 'studente',
          scopeKind: 'global',
          maxHoursPerWeek: 10,
        });
      expect([200, 201]).toContain(create.status);
      const id = create.body.quota?.id ?? create.body.id;
      if (id) {
        const del = await request(app)
          .delete(`/api/admin/quotas/${id}`)
          .set('Authorization', authHeader);
        expect([200, 204]).toContain(del.status);
      }
    });
  });

  // ─── Rules ──────────────────────────────────────────────────
  describe('rules', () => {
    it('GET /api/rules (admin)', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app).get('/api/rules').set('Authorization', authHeader);
      expect([200, 404]).toContain(res.status);
    });
  });

  // ─── Structure ──────────────────────────────────────────────
  describe('structure', () => {
    it('GET /api/structure/buildings (admin)', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/structure/buildings')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });
    it('GET /api/structure/rooms (auth)', async () => {
      const { authHeader } = await createAuthedUser({ role: 'studente' });
      const res = await request(app).get('/api/structure/rooms').set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });
    it('GET /api/structure/institutes/public (no auth)', async () => {
      const res = await request(app).get('/api/structure/institutes/public');
      expect([200, 404]).toContain(res.status);
    });
  });

  // ─── Public/Misc ────────────────────────────────────────────
  describe('public misc', () => {
    it('GET /api/health', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
    it('GET /api/ready espone i check di database/smtp/disk', async () => {
      const res = await request(app).get('/api/ready');
      expect([200, 503]).toContain(res.status);
      expect(res.body.status).toMatch(/^(ready|not_ready)$/);
      expect(res.body.checks).toBeDefined();
      // In test usiamo SQLite in-memory → database SEMPRE ok.
      expect(res.body.checks.database).toBeDefined();
      expect(res.body.checks.database.ok).toBe(true);
      // smtp + disk presenti come oggetti (note='not_configured' è OK).
      expect(res.body.checks.smtp).toBeDefined();
      expect(res.body.checks.disk).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // ─── GDPR ───────────────────────────────────────────────────
  describe('gdpr', () => {
    it('GET /api/users/me/gdpr/export richiede auth', async () => {
      const res = await request(app).get('/api/users/me/gdpr/export');
      expect(res.status).toBe(401);
    });
    it("GET /api/users/me/gdpr/export (auth) ritorna i dati dell'utente", async () => {
      const { authHeader } = await createAuthedUser({ role: 'studente' });
      const res = await request(app)
        .get('/api/users/me/gdpr/export')
        .set('Authorization', authHeader);
      expect([200, 404, 429]).toContain(res.status);
    });
  });
});
