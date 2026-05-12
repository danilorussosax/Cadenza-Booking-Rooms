'use strict';

/**
 * Integration: routes/courseLevels.js — espande branch coverage da 9% al
 * livello "felice + errori comuni" (CRUD admin + auth gates + unique +
 * 404 + bulk-delete con FK).
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser } = require('../factories');
const { CourseLevel } = require('../../models');

const app = buildApp({ serveFrontend: false });

describe('routes/courseLevels — CRUD admin', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  describe('GET /api/course-levels (pubblico)', () => {
    it('200 con lista vuota su DB pulito', async () => {
      const res = await request(app).get('/api/course-levels');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.levels)).toBe(true);
    });

    it('ritorna livelli ordinati per sortOrder ASC poi name ASC', async () => {
      await CourseLevel.bulkCreate([
        { code: 'b', name: 'B level', sortOrder: 2 },
        { code: 'a', name: 'A level', sortOrder: 1 },
        { code: 'c', name: 'C level', sortOrder: 1 },
      ]);
      const res = await request(app).get('/api/course-levels');
      expect(res.body.levels.map((l) => l.code)).toEqual(['a', 'c', 'b']);
    });
  });

  describe('POST /api/course-levels (admin)', () => {
    it('401 senza token', async () => {
      const res = await request(app).post('/api/course-levels').send({ code: 'x', name: 'X' });
      expect(res.status).toBe(401);
    });

    it('403 se utente è studente', async () => {
      const { authHeader } = await createAuthedUser({ role: 'studente' });
      const res = await request(app)
        .post('/api/course-levels')
        .set('Authorization', authHeader)
        .send({ code: 'x', name: 'X' });
      expect(res.status).toBe(403);
    });

    it('400 se code mancante', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/course-levels')
        .set('Authorization', authHeader)
        .send({ name: 'X' });
      expect(res.status).toBe(400);
    });

    it('400 se name mancante', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/course-levels')
        .set('Authorization', authHeader)
        .send({ code: 'x' });
      expect(res.status).toBe(400);
    });

    it('201 e normalizza code in lowercase', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/course-levels')
        .set('Authorization', authHeader)
        .send({ code: 'BACH', name: 'Bachelor' });
      expect(res.status).toBe(201);
      expect(res.body.level.code).toBe('bach');
      expect(res.body.level.name).toBe('Bachelor');
    });

    it('201 con sortOrder valido', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/course-levels')
        .set('Authorization', authHeader)
        .send({ code: 'mas', name: 'Master', sortOrder: 5 });
      expect(res.status).toBe(201);
      expect(res.body.level.sortOrder).toBe(5);
    });

    it('sortOrder non numerico → fallback 0', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/course-levels')
        .set('Authorization', authHeader)
        .send({ code: 'phd', name: 'PhD', sortOrder: 'abc' });
      expect(res.status).toBe(201);
      expect(res.body.level.sortOrder).toBe(0);
    });

    it('409 su code duplicato (UNIQUE)', async () => {
      const { authHeader } = await createAdmin();
      await request(app)
        .post('/api/course-levels')
        .set('Authorization', authHeader)
        .send({ code: 'dup', name: 'Dup1' });
      const res = await request(app)
        .post('/api/course-levels')
        .set('Authorization', authHeader)
        .send({ code: 'DUP', name: 'Dup2' });
      expect(res.status).toBe(409);
    });
  });

  describe('PUT /api/course-levels/:id', () => {
    it('404 se id inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/course-levels/999999')
        .set('Authorization', authHeader)
        .send({ name: 'X' });
      expect(res.status).toBe(404);
    });

    it('200 con update parziale (solo name)', async () => {
      const { authHeader } = await createAdmin();
      const lvl = await CourseLevel.create({ code: 'a', name: 'A', sortOrder: 1 });
      const res = await request(app)
        .put(`/api/course-levels/${lvl.id}`)
        .set('Authorization', authHeader)
        .send({ name: 'A updated' });
      expect(res.status).toBe(200);
      expect(res.body.level.name).toBe('A updated');
      expect(res.body.level.code).toBe('a'); // invariato
    });

    it('200 con update di code (normalizzato lowercase)', async () => {
      const { authHeader } = await createAdmin();
      const lvl = await CourseLevel.create({ code: 'a', name: 'A' });
      const res = await request(app)
        .put(`/api/course-levels/${lvl.id}`)
        .set('Authorization', authHeader)
        .send({ code: 'AA' });
      expect(res.body.level.code).toBe('aa');
    });
  });

  describe('DELETE /api/course-levels/:id', () => {
    it('404 se id inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .delete('/api/course-levels/999999')
        .set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('200 + soft-delete / hard-delete', async () => {
      const { authHeader } = await createAdmin();
      const lvl = await CourseLevel.create({ code: 'd', name: 'D' });
      const res = await request(app)
        .delete(`/api/course-levels/${lvl.id}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/course-levels/bulk-delete', () => {
    it('400 se body.ids vuoto', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/course-levels/bulk-delete')
        .set('Authorization', authHeader)
        .send({ ids: [] });
      expect(res.status).toBe(400);
    });

    it('400 se body.ids non array', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/course-levels/bulk-delete')
        .set('Authorization', authHeader)
        .send({ ids: 'x' });
      expect(res.status).toBe(400);
    });

    it('200 e cancella in batch', async () => {
      const { authHeader } = await createAdmin();
      const a = await CourseLevel.create({ code: 'a', name: 'A' });
      const b = await CourseLevel.create({ code: 'b', name: 'B' });
      const res = await request(app)
        .post('/api/course-levels/bulk-delete')
        .set('Authorization', authHeader)
        .send({ ids: [a.id, b.id] });
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(2);
    });

    it('200 con ids che includono valori non-numerici (Number filter)', async () => {
      const { authHeader } = await createAdmin();
      const a = await CourseLevel.create({ code: 'a', name: 'A' });
      const res = await request(app)
        .post('/api/course-levels/bulk-delete')
        .set('Authorization', authHeader)
        .send({ ids: [a.id, 'notanumber', null, 0] });
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(1);
    });
  });
});
