'use strict';

/**
 * Integration: routes/botBindings.js — espande branch da 8% al "felice +
 * errori comuni". Copre GET, POST /init (OTP), POST /confirm (501),
 * DELETE /:id (404 e success) e gli helper maskExternalId in diverse forme.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAuthedUser } = require('../factories');
const { BotBinding } = require('../../models');

const app = buildApp({ serveFrontend: false });

describe('routes/botBindings — /api/users/me/bot-bindings', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  describe('autenticazione', () => {
    it('401 senza token', async () => {
      const res = await request(app).get('/api/users/me/bot-bindings');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /', () => {
    it('200 con lista vuota', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .get('/api/users/me/bot-bindings')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.bindings).toEqual([]);
    });

    it('200 maschera externalId numerico (Telegram chat_id)', async () => {
      const { user, authHeader } = await createAuthedUser();
      await BotBinding.create({
        userId: user.id,
        channel: 'telegram',
        externalId: '1234567890',
        boundAt: new Date(),
      });
      const res = await request(app)
        .get('/api/users/me/bot-bindings')
        .set('Authorization', authHeader);
      expect(res.body.bindings).toHaveLength(1);
      expect(res.body.bindings[0].externalIdMasked).toMatch(/^123…\d\d$/);
      expect(res.body.bindings[0].externalIdMasked).not.toContain('456');
    });

    it('200 maschera externalId email', async () => {
      const { user, authHeader } = await createAuthedUser();
      await BotBinding.create({
        userId: user.id,
        channel: 'email',
        externalId: 'mario.rossi@example.it',
        boundAt: new Date(),
      });
      const res = await request(app)
        .get('/api/users/me/bot-bindings')
        .set('Authorization', authHeader);
      expect(res.body.bindings[0].externalIdMasked).toMatch(/^ma\*\*\*@example\.it$/);
    });

    it('200 maschera externalId phone (whatsapp)', async () => {
      const { user, authHeader } = await createAuthedUser();
      await BotBinding.create({
        userId: user.id,
        channel: 'whatsapp',
        externalId: '+393281234567',
        boundAt: new Date(),
      });
      const res = await request(app)
        .get('/api/users/me/bot-bindings')
        .set('Authorization', authHeader);
      expect(res.body.bindings[0].externalIdMasked).toMatch(/^\+393…\d\d$/);
    });

    it('200 ordina per boundAt DESC', async () => {
      const { user, authHeader } = await createAuthedUser();
      await BotBinding.create({
        userId: user.id,
        channel: 'telegram',
        externalId: '111',
        boundAt: new Date('2026-01-01T10:00:00Z'),
      });
      await BotBinding.create({
        userId: user.id,
        channel: 'telegram',
        externalId: '222',
        boundAt: new Date('2026-02-01T10:00:00Z'),
      });
      const res = await request(app)
        .get('/api/users/me/bot-bindings')
        .set('Authorization', authHeader);
      expect(res.body.bindings[0].externalIdMasked).toBe('222');
      expect(res.body.bindings[1].externalIdMasked).toBe('111');
    });
  });

  describe('POST /init', () => {
    it('200 ritorna OTP a 6 caratteri alfanumerici (no chars ambigui)', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .post('/api/users/me/bot-bindings/init')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.otp).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      expect(res.body.expiresInMinutes).toBe(10);
    });

    it('OTP differenti su chiamate ravvicinate (entropia)', async () => {
      const { authHeader } = await createAuthedUser();
      const r1 = await request(app)
        .post('/api/users/me/bot-bindings/init')
        .set('Authorization', authHeader);
      const r2 = await request(app)
        .post('/api/users/me/bot-bindings/init')
        .set('Authorization', authHeader);
      // Probabilità collisione su 30^6 ≈ 1/729M
      expect(r1.body.otp).not.toBe(r2.body.otp);
    });
  });

  describe('POST /confirm', () => {
    it('501 NOT_IMPLEMENTED (riservato future)', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .post('/api/users/me/bot-bindings/confirm')
        .set('Authorization', authHeader);
      expect(res.status).toBe(501);
      expect(res.body.code).toBe('NOT_IMPLEMENTED');
    });
  });

  describe('DELETE /:id', () => {
    it('404 se binding non esiste', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .delete('/api/users/me/bot-bindings/999999')
        .set('Authorization', authHeader);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('404 se binding appartiene ad altro utente', async () => {
      const { user: u1 } = await createAuthedUser({ email: 'a@x.it' });
      const { authHeader: h2 } = await createAuthedUser({ email: 'b@x.it' });
      const b = await BotBinding.create({
        userId: u1.id,
        channel: 'telegram',
        externalId: '999',
        boundAt: new Date(),
      });
      const res = await request(app)
        .delete(`/api/users/me/bot-bindings/${b.id}`)
        .set('Authorization', h2);
      expect(res.status).toBe(404);
    });

    it('200 revoca un binding esistente del proprio utente', async () => {
      const { user, authHeader } = await createAuthedUser();
      const b = await BotBinding.create({
        userId: user.id,
        channel: 'telegram',
        externalId: '888',
        boundAt: new Date(),
      });
      const res = await request(app)
        .delete(`/api/users/me/bot-bindings/${b.id}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      const fresh = await BotBinding.findByPk(b.id);
      expect(fresh).toBeNull();
    });
  });
});
