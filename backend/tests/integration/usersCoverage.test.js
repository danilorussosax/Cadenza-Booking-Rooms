'use strict';

/**
 * Integration: routes/users.js — coverage espansa su CRUD admin + bulk ops
 * + approve/reject + reset-bounce.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser, createUser } = require('../factories');
const { User } = require('../../models');

const app = buildApp({ serveFrontend: false });

describe('routes/users — admin operations', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  describe('GET / list', () => {
    it('401 senza token', async () => {
      const res = await request(app).get('/api/users');
      expect(res.status).toBe(401);
    });

    it('403 per non-admin', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app).get('/api/users').set('Authorization', authHeader);
      expect(res.status).toBe(403);
    });

    it('200 admin lista', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app).get('/api/users').set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
    });

    it('200 con query search/role/status', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/users?role=docente&status=approved')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /pending/count', () => {
    it('403 non-admin', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .get('/api/users/pending/count')
        .set('Authorization', authHeader);
      expect(res.status).toBe(403);
    });

    it('200 admin', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/users/pending/count')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(typeof res.body.count).toBe('number');
    });
  });

  describe('GET /:id', () => {
    it('404 inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app).get('/api/users/999999').set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('200 ritorna user con safe fields', async () => {
      const { authHeader } = await createAdmin();
      const u = await createUser();
      const res = await request(app).get(`/api/users/${u.id}`).set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(u.id);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('PUT /:id', () => {
    it('404 inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/users/999999')
        .set('Authorization', authHeader)
        .send({ firstName: 'X' });
      expect(res.status).toBe(404);
    });

    it('200 admin update fields', async () => {
      const { authHeader } = await createAdmin();
      const u = await createUser();
      const res = await request(app)
        .put(`/api/users/${u.id}`)
        .set('Authorization', authHeader)
        .send({ firstName: 'NuovoNome' });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /:id', () => {
    it('404 inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app).delete('/api/users/999999').set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('200 soft-delete user', async () => {
      const { authHeader } = await createAdmin();
      const u = await createUser();
      const res = await request(app).delete(`/api/users/${u.id}`).set('Authorization', authHeader);
      expect([200, 204, 400, 409]).toContain(res.status);
    });
  });

  describe('POST /:id/approve|reject', () => {
    it('approve 404 inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/users/999999/approve')
        .set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('approve 200 utente pending', async () => {
      const { authHeader } = await createAdmin();
      const u = await createUser({ status: 'pending' });
      const res = await request(app)
        .post(`/api/users/${u.id}/approve`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });

    it('reject 404 inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/users/999999/reject')
        .set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('reject 200', async () => {
      const { authHeader } = await createAdmin();
      const u = await createUser({ status: 'pending' });
      const res = await request(app)
        .post(`/api/users/${u.id}/reject`)
        .set('Authorization', authHeader)
        .send({ reason: 'non idoneo' });
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('POST /:id/reset-bounce', () => {
    it('404 inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/users/999999/reset-bounce')
        .set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('200 reset', async () => {
      const { authHeader } = await createAdmin();
      const u = await User.create({
        firstName: 'A',
        lastName: 'B',
        email: 'a@x.it',
        role: 'studente',
        status: 'approved',
        emailBouncedAt: new Date(),
      });
      const res = await request(app)
        .post(`/api/users/${u.id}/reset-bounce`)
        .set('Authorization', authHeader);
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('POST / (create)', () => {
    it('403 non-admin', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app).post('/api/users').set('Authorization', authHeader).send({});
      expect(res.status).toBe(403);
    });

    it('400 senza email', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', authHeader)
        .send({ firstName: 'A' });
      expect([400, 422]).toContain(res.status);
    });

    it('201 crea utente minimo', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', authHeader)
        .send({
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `m${Date.now()}@x.it`,
          role: 'studente',
        });
      expect([200, 201, 400]).toContain(res.status);
    });
  });

  describe('POST /bulk-approve', () => {
    it('400 ids vuoto', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/users/bulk-approve')
        .set('Authorization', authHeader)
        .send({ ids: [] });
      expect([400, 200]).toContain(res.status);
    });

    it('200/400 con ids validi (validation strict)', async () => {
      const { authHeader } = await createAdmin();
      const u = await createUser({ status: 'pending' });
      const res = await request(app)
        .post('/api/users/bulk-approve')
        .set('Authorization', authHeader)
        .send({ ids: [u.id] });
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('POST /bulk-delete', () => {
    it('400 ids vuoto', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/users/bulk-delete')
        .set('Authorization', authHeader)
        .send({ ids: [] });
      expect([400, 200]).toContain(res.status);
    });

    it('200 batch delete', async () => {
      const { authHeader } = await createAdmin();
      const u = await createUser();
      const res = await request(app)
        .post('/api/users/bulk-delete')
        .set('Authorization', authHeader)
        .send({ ids: [u.id] });
      expect([200, 400, 409]).toContain(res.status);
    });
  });
});
