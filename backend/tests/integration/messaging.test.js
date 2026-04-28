'use strict';

/**
 * Integration test bot messaging.
 *
 * Coperture:
 *   1. POST /webhook senza canale configurato → 404 (silent disable)
 *   2. POST /webhook con firma errata → 401
 *   3. POST /webhook con firma valida ma sender NON bindato → reply standard
 *   4. POST /webhook con firma valida + comando "bind XXXXXX" valido → binding
 *   5. POST /me/bot-bindings/init → OTP a 6 char + scadenza
 *   6. DELETE /me/bot-bindings/:id → revoca
 *   7. Rate limit: oltre 30 msg/min → cooldown
 *
 * Mock: l'adapter telegram.send() è patchato in-process per evitare chiamate
 * reali a api.telegram.org. Il parsing del payload e la verifica della firma
 * usano comunque il codice di produzione.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createUser, createAuthedUser } = require('../factories');
const { MessagingSettings, BotBinding, ChatSession } = require('../../models');
const { encrypt } = require('../../lib/crypto');
const rateLimit = require('../../services/messaging/rateLimit');

const app = buildApp({ serveFrontend: false });

const TG_SECRET = 'a'.repeat(64);
const TG_TOKEN = 'TEST_TOKEN_NOT_USED';

async function configureTelegram(opts = {}) {
  await MessagingSettings.destroy({ where: { channel: 'telegram' } });
  return MessagingSettings.create({
    channel: 'telegram',
    isEnabled: opts.enabled ?? true,
    settings: {},
    credentialsEncrypted: encrypt(
      JSON.stringify({
        botToken: TG_TOKEN,
        webhookSecret: TG_SECRET,
      }),
    ),
  });
}

function tgPayload(chatId, text) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      text,
    },
  };
}

// Patch dell'adapter Telegram per intercettare send() in test (no rete).
let lastSent = null;
let allSent = [];
beforeAll(() => {
  const adapter = require('../../services/messaging/adapters/telegram');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  adapter.send = async (externalId, text, _config) => {
    lastSent = { externalId, text };
    allSent.push({ externalId, text });
  };
});

async function waitForReply(ms = 150) {
  await new Promise((r) => setTimeout(r, ms));
  return lastSent;
}

describe('Bot messaging — webhook signature & binding', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    rateLimit.reset();
    lastSent = null;
    allSent = [];
  });

  it('senza canale configurato → 404', async () => {
    const res = await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(123, '/help'));
    expect(res.status).toBe(404);
  });

  it('canale disabilitato → 404', async () => {
    await configureTelegram({ enabled: false });
    const res = await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(123, '/help'));
    expect(res.status).toBe(404);
  });

  it('firma errata → 401', async () => {
    await configureTelegram();
    const res = await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'WRONG'.padEnd(TG_SECRET.length, '0'))
      .send(tgPayload(123, '/help'));
    expect(res.status).toBe(401);
  });

  it('firma valida + chat non bindata → reply standard "Numero non riconosciuto"', async () => {
    await configureTelegram();
    const res = await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(999, '/help'));
    expect(res.status).toBe(200);
    const sent = await waitForReply();
    expect(sent).not.toBeNull();
    expect(sent.externalId).toBe('999');
    // Chat sconosciuta su Telegram (no phone) → messaggio "non riconosciuto" generico
    expect(sent.text).toMatch(/Numero non riconosciuto|prima di poter prenotare/i);
  });

  it('binding completo: init OTP + bind sul webhook → BotBinding creato', async () => {
    const { user, authHeader } = await createAuthedUser({ status: 'approved' });
    await configureTelegram();
    // 1) init OTP via /me/bot-bindings/init
    const initRes = await request(app)
      .post('/api/users/me/bot-bindings/init')
      .set('Authorization', authHeader);
    expect(initRes.status).toBe(200);
    expect(initRes.body.otp).toMatch(/^[A-Z0-9]{6}$/);
    expect(initRes.body.expiresInMinutes).toBe(10);
    const otp = initRes.body.otp;

    // 2) Manda "bind <OTP>" come messaggio Telegram
    const wRes = await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(42, `bind ${otp}`));
    expect(wRes.status).toBe(200);
    const sent = await waitForReply();
    expect(sent.text).toMatch(/Collegamento completato/i);

    // 3) Verifica binding creato
    const binding = await BotBinding.findOne({ where: { channel: 'telegram', externalId: '42' } });
    expect(binding).not.toBeNull();
    expect(binding.userId).toBe(user.id);
  });

  it('binding con OTP errato → reply "Codice non valido"', async () => {
    const { authHeader } = await createAuthedUser({ status: 'approved' });
    await configureTelegram();
    await request(app).post('/api/users/me/bot-bindings/init').set('Authorization', authHeader);
    const wRes = await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(7, 'bind WRONG1'));
    expect(wRes.status).toBe(200);
    const sent = await waitForReply();
    expect(sent.text).toMatch(/Codice non valido/i);
    const count = await BotBinding.count({ where: { channel: 'telegram', externalId: '7' } });
    expect(count).toBe(0);
  });

  it('utente bindato + /help → reply con la guida', async () => {
    const user = await createUser({ status: 'approved' });
    await configureTelegram();
    await BotBinding.create({
      channel: 'telegram',
      externalId: '500',
      userId: user.id,
      boundAt: new Date(),
    });
    const res = await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(500, '/help'));
    expect(res.status).toBe(200);
    const sent = await waitForReply();
    expect(sent.text).toMatch(/Comandi disponibili/);
  });

  it('rate limit 30/min → cooldown 1h', async () => {
    const user = await createUser({ status: 'approved' });
    await configureTelegram();
    await BotBinding.create({
      channel: 'telegram',
      externalId: '600',
      userId: user.id,
      boundAt: new Date(),
    });
    // Simula 35 messaggi rapidi
    for (let i = 0; i < 35; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/messaging/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
        .send(tgPayload(600, '/help'));
    }
    await waitForReply(400);
    // Almeno una delle reply deve essere il messaggio di rate-limit
    const blocked = allSent.find((m) => /Limite messaggi superato|Riprova tra/i.test(m.text));
    expect(blocked).toBeTruthy();
  });

  it('init OTP genera challenge salvata in users.botBindingChallenge', async () => {
    const { user, authHeader } = await createAuthedUser({ status: 'approved' });
    const res = await request(app)
      .post('/api/users/me/bot-bindings/init')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    await user.reload();
    expect(user.botBindingChallenge).toMatchObject({
      tokenHash: expect.stringMatching(/^\$2[ayb]\$/),
      expiresAt: expect.any(String),
    });
  });

  it('DELETE /me/bot-bindings/:id rimuove binding e ChatSession', async () => {
    const { user, authHeader } = await createAuthedUser({ status: 'approved' });
    const binding = await BotBinding.create({
      channel: 'telegram',
      externalId: '777',
      userId: user.id,
      boundAt: new Date(),
    });
    await ChatSession.create({ channel: 'telegram', externalId: '777', userId: user.id });
    const res = await request(app)
      .delete(`/api/users/me/bot-bindings/${binding.id}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(await BotBinding.findByPk(binding.id)).toBeNull();
    expect(
      await ChatSession.findOne({ where: { channel: 'telegram', externalId: '777' } }),
    ).toBeNull();
  });
});
