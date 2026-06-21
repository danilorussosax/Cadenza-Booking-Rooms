'use strict';

/**
 * Integration: routes/messagingSettings.js — coverage espansa da 34% branches.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser } = require('../factories');
const { MessagingSettings } = require('../../models');
const { encrypt } = require('../../lib/crypto');

const app = buildApp({ serveFrontend: false });

// Token con formato valido Telegram (`<botId>:<segreto ≥30 char>`) per i test
// che esercitano il salvataggio: la PUT ora rifiuta i token malformati.
const VALID_TOKEN = '123456789:AAHfaketoken0123456789ABCDEFGHIJKL';

describe('routes/messagingSettings', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  describe('GET /', () => {
    it('401 senza token', async () => {
      const res = await request(app).get('/api/admin/messaging-settings');
      expect(res.status).toBe(401);
    });

    it('403 per non-admin', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .get('/api/admin/messaging-settings')
        .set('Authorization', authHeader);
      expect(res.status).toBe(403);
    });

    it('200 admin: lista canali supportati anche se DB vuoto', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/admin/messaging-settings')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.settings)).toBe(true);
      // Tutti i canali presenti con isEnabled=false di default
      for (const ch of res.body.settings) {
        expect(ch.isEnabled).toBe(false);
        expect(ch.credentialsSet).toEqual({});
      }
    });

    it('200 admin: ritorna isEnabled + credentialsSet flag per canale configurato', async () => {
      const { authHeader } = await createAdmin();
      await MessagingSettings.create({
        channel: 'telegram',
        isEnabled: true,
        credentialsEncrypted: encrypt(JSON.stringify({ botToken: 'xxx', webhookSecret: 'yyy' })),
      });
      const res = await request(app)
        .get('/api/admin/messaging-settings')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      const tg = res.body.settings.find((s) => s.channel === 'telegram');
      expect(tg.isEnabled).toBe(true);
      // Flag-only, no valori in chiaro
      expect(tg.credentialsSet.botToken).toBe(true);
      expect(tg.credentialsSet.webhookSecret).toBe(true);
    });
  });

  describe('PUT /:channel', () => {
    it('400 CHANNEL_INVALID su canale sconosciuto', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/messaging-settings/inventato')
        .set('Authorization', authHeader)
        .send({ isEnabled: true });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CHANNEL_INVALID');
    });

    it('200 crea row al primo PUT con isEnabled', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/messaging-settings/telegram')
        .set('Authorization', authHeader)
        .send({ isEnabled: true });
      expect(res.status).toBe(200);
      expect(res.body.isEnabled).toBe(true);
    });

    it('200 PUT con credentials nuovo + settings', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/messaging-settings/telegram')
        .set('Authorization', authHeader)
        .send({
          isEnabled: true,
          settings: { greeting: 'Ciao' },
          credentials: { botToken: VALID_TOKEN },
        });
      expect(res.status).toBe(200);
      expect(res.body.credentialsSet.botToken).toBe(true);
    });

    it('400 TELEGRAM_TOKEN_INVALID su formato token malformato', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/messaging-settings/telegram')
        .set('Authorization', authHeader)
        .send({ credentials: { botToken: 'non-un-token' } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TELEGRAM_TOKEN_INVALID');
    });

    it('200 PUT con __KEEP__ mantiene il vecchio valore', async () => {
      const { authHeader } = await createAdmin();
      // Setup: prima salva un token
      await request(app)
        .put('/api/admin/messaging-settings/telegram')
        .set('Authorization', authHeader)
        .send({ credentials: { botToken: VALID_TOKEN } });
      // Seconda PUT con placeholder: il token resta
      const res = await request(app)
        .put('/api/admin/messaging-settings/telegram')
        .set('Authorization', authHeader)
        .send({ credentials: { botToken: '__KEEP__' } });
      expect(res.status).toBe(200);
      expect(res.body.credentialsSet.botToken).toBe(true);
    });

    it('200 PUT con valore vuoto rimuove il secret', async () => {
      const { authHeader } = await createAdmin();
      await request(app)
        .put('/api/admin/messaging-settings/telegram')
        .set('Authorization', authHeader)
        .send({ credentials: { botToken: VALID_TOKEN, webhookSecret: 'sec' } });
      const res = await request(app)
        .put('/api/admin/messaging-settings/telegram')
        .set('Authorization', authHeader)
        .send({ credentials: { botToken: '' } });
      expect(res.status).toBe(200);
      // botToken rimosso, webhookSecret resta
      expect(res.body.credentialsSet.botToken).toBeUndefined();
      expect(res.body.credentialsSet.webhookSecret).toBe(true);
    });
  });

  describe('POST /:channel/test', () => {
    it('400 CHANNEL_INVALID', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/admin/messaging-settings/inventato/test')
        .set('Authorization', authHeader);
      expect(res.status).toBe(400);
    });

    it('400 CHANNEL_DISABLED se canale non configurato', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/admin/messaging-settings/telegram/test')
        .set('Authorization', authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CHANNEL_DISABLED');
    });
  });

  describe('POST /:channel/auto-configure', () => {
    it('400 AUTO_CONFIGURE_UNSUPPORTED su canale non-telegram', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/admin/messaging-settings/whatsapp_cloud/auto-configure')
        .set('Authorization', authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AUTO_CONFIGURE_UNSUPPORTED');
    });

    it('400 CREDENTIALS_MISSING senza row Telegram', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/admin/messaging-settings/telegram/auto-configure')
        .set('Authorization', authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CREDENTIALS_MISSING');
    });

    it('400 BOT_TOKEN_MISSING se credentials senza botToken', async () => {
      const { authHeader } = await createAdmin();
      await MessagingSettings.create({
        channel: 'telegram',
        isEnabled: false,
        credentialsEncrypted: encrypt(JSON.stringify({ webhookSecret: 'x' })),
      });
      const res = await request(app)
        .post('/api/admin/messaging-settings/telegram/auto-configure')
        .set('Authorization', authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BOT_TOKEN_MISSING');
    });

    it('400 AUTO_CONFIGURE_FAILED se Telegram API non raggiungibile', async () => {
      const { authHeader } = await createAdmin();
      await MessagingSettings.create({
        channel: 'telegram',
        isEnabled: false,
        credentialsEncrypted: encrypt(
          JSON.stringify({ botToken: 'fake-token-123' /* niente webhookSecret */ }),
        ),
      });
      const res = await request(app)
        .post('/api/admin/messaging-settings/telegram/auto-configure')
        .set('Authorization', authHeader)
        .send({ frontendUrl: 'https://example.invalid' });
      // Senza un Bot Telegram vero, l'API call fallisce → 400
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AUTO_CONFIGURE_FAILED');
    });
  });

  describe('GET /:channel/webhook-info', () => {
    it('400 WEBHOOK_INFO_UNSUPPORTED su canale non-telegram', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/admin/messaging-settings/whatsapp_cloud/webhook-info')
        .set('Authorization', authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('WEBHOOK_INFO_UNSUPPORTED');
    });

    it('400 CREDENTIALS_MISSING senza row Telegram', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/admin/messaging-settings/telegram/webhook-info')
        .set('Authorization', authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CREDENTIALS_MISSING');
    });

    it('400 BOT_TOKEN_MISSING se credentials senza botToken', async () => {
      const { authHeader } = await createAdmin();
      await MessagingSettings.create({
        channel: 'telegram',
        isEnabled: false,
        credentialsEncrypted: encrypt(JSON.stringify({ webhookSecret: 'x' })),
      });
      const res = await request(app)
        .get('/api/admin/messaging-settings/telegram/webhook-info')
        .set('Authorization', authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BOT_TOKEN_MISSING');
    });

    it('200 ok:false se Telegram rifiuta il token (getWebhookInfo fallisce)', async () => {
      const { authHeader } = await createAdmin();
      await MessagingSettings.create({
        channel: 'telegram',
        isEnabled: true,
        credentialsEncrypted: encrypt(JSON.stringify({ botToken: 'fake-token-123' })),
      });
      const res = await request(app)
        .get('/api/admin/messaging-settings/telegram/webhook-info')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(typeof res.body.error).toBe('string');
    });
  });
});
