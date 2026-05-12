'use strict';

/**
 * Integration: routes/instrumentLoanRules.js — coverage espansa.
 * Copre GET (default permissivo), PUT (upsert con validazione famiglia
 * e validIds filtering), DELETE, auth gates, e helper isUserAllowedForFamily.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser } = require('../factories');
const { Course, InstrumentLoanRule } = require('../../models');
const { isUserAllowedForFamily, FAMILIES } = require('../../routes/instrumentLoanRules');

const app = buildApp({ serveFrontend: false });

describe('routes/instrumentLoanRules — admin CRUD', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  describe('GET /api/admin/instrument-loan-rules', () => {
    it('401 senza token', async () => {
      const res = await request(app).get('/api/admin/instrument-loan-rules');
      expect(res.status).toBe(401);
    });

    it('403 per non-admin', async () => {
      const { authHeader } = await createAuthedUser({ role: 'docente' });
      const res = await request(app)
        .get('/api/admin/instrument-loan-rules')
        .set('Authorization', authHeader);
      expect(res.status).toBe(403);
    });

    it('200 ritorna sempre 9 famiglie con configured=false di default', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/admin/instrument-loan-rules')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.rules).toHaveLength(FAMILIES.length);
      for (const r of res.body.rules) {
        expect(r.configured).toBe(false);
        expect(r.allowedCourseIds).toEqual([]);
      }
    });

    it('200 + configured=true per famiglie con regola salvata', async () => {
      const { authHeader } = await createAdmin();
      await InstrumentLoanRule.create({
        family: 'archi',
        allowedCourseIds: [1, 2],
        notes: 'Solo archi-class',
      });
      const res = await request(app)
        .get('/api/admin/instrument-loan-rules')
        .set('Authorization', authHeader);
      const archi = res.body.rules.find((r) => r.family === 'archi');
      expect(archi.configured).toBe(true);
      expect(archi.allowedCourseIds).toEqual([1, 2]);
      expect(archi.notes).toBe('Solo archi-class');
    });
  });

  describe('PUT /api/admin/instrument-loan-rules/:family', () => {
    it('400 su famiglia non valida', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/instrument-loan-rules/foo')
        .set('Authorization', authHeader)
        .send({ allowedCourseIds: [] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('400 se allowedCourseIds non è array', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/instrument-loan-rules/archi')
        .set('Authorization', authHeader)
        .send({ allowedCourseIds: 'not-an-array' });
      expect(res.status).toBe(400);
    });

    it('200 upsert con allowedCourseIds vuoto (= blocca tutti)', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/instrument-loan-rules/archi')
        .set('Authorization', authHeader)
        .send({ allowedCourseIds: [] });
      expect(res.status).toBe(200);
      expect(res.body.rule.family).toBe('archi');
    });

    it('200 + filtra silently gli id corso inesistenti', async () => {
      const { authHeader } = await createAdmin();
      const c = await Course.create({ name: 'Violino', code: 'VLN' });
      const res = await request(app)
        .put('/api/admin/instrument-loan-rules/archi')
        .set('Authorization', authHeader)
        .send({ allowedCourseIds: [c.id, 999999, -1, 0, 'abc'] });
      expect(res.status).toBe(200);
      expect(res.body.rule.allowedCourseIds).toEqual([c.id]);
    });

    it('200 + notes trimmato → null se solo whitespace', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/instrument-loan-rules/fiati_legni')
        .set('Authorization', authHeader)
        .send({ allowedCourseIds: [], notes: '   ' });
      expect(res.body.rule.notes).toBeNull();
    });

    it('200 + notes salva il valore trimmato', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/instrument-loan-rules/percussioni')
        .set('Authorization', authHeader)
        .send({ allowedCourseIds: [], notes: '  attento ai feltri  ' });
      expect(res.body.rule.notes).toBe('attento ai feltri');
    });
  });

  describe('DELETE /api/admin/instrument-loan-rules/:family', () => {
    it('400 su famiglia non valida', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .delete('/api/admin/instrument-loan-rules/foo')
        .set('Authorization', authHeader);
      expect(res.status).toBe(400);
    });

    it('200 e rimuove la riga', async () => {
      const { authHeader } = await createAdmin();
      await InstrumentLoanRule.create({ family: 'archi', allowedCourseIds: [] });
      const res = await request(app)
        .delete('/api/admin/instrument-loan-rules/archi')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      const fresh = await InstrumentLoanRule.findByPk('archi');
      expect(fresh).toBeNull();
    });

    it('200 anche se non esiste (idempotente)', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .delete('/api/admin/instrument-loan-rules/voce')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });
  });

  describe('isUserAllowedForFamily helper', () => {
    beforeEach(async () => {
      await globalThis.resetDatabase();
    });

    it('user null → false', async () => {
      expect(await isUserAllowedForFamily({ user: null, family: 'archi' })).toBe(false);
    });

    it('user admin → true sempre', async () => {
      expect(await isUserAllowedForFamily({ user: { role: 'admin' }, family: 'archi' })).toBe(true);
    });

    it('nessuna rule per la famiglia → permissivo (true)', async () => {
      expect(
        await isUserAllowedForFamily({
          user: { role: 'studente', courseId: 1 },
          family: 'archi',
        }),
      ).toBe(true);
    });

    it('rule configurata vuota → blocca (false)', async () => {
      await InstrumentLoanRule.create({ family: 'archi', allowedCourseIds: [] });
      expect(
        await isUserAllowedForFamily({
          user: { role: 'studente', courseId: 1 },
          family: 'archi',
        }),
      ).toBe(false);
    });

    it('rule configurata con courseId NON in lista → false', async () => {
      await InstrumentLoanRule.create({ family: 'archi', allowedCourseIds: [99] });
      expect(
        await isUserAllowedForFamily({
          user: { role: 'studente', courseId: 1 },
          family: 'archi',
        }),
      ).toBe(false);
    });

    it('rule configurata con courseId nella lista → true', async () => {
      await InstrumentLoanRule.create({ family: 'archi', allowedCourseIds: [1, 2] });
      expect(
        await isUserAllowedForFamily({
          user: { role: 'studente', courseId: 1 },
          family: 'archi',
        }),
      ).toBe(true);
    });

    it('user senza courseId con rule restrittiva → false', async () => {
      await InstrumentLoanRule.create({ family: 'archi', allowedCourseIds: [1] });
      expect(await isUserAllowedForFamily({ user: { role: 'studente' }, family: 'archi' })).toBe(
        false,
      );
    });
  });
});
