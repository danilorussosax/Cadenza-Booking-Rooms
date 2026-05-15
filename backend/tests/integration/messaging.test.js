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
    expect(sent.text).toMatch(/Cadenza.*Bot/);
    expect(sent.text).toContain('/book');
    expect(sent.text).toContain('/aule');
    expect(sent.text).toContain('/agenda');
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

  // Regressione #1 (Markdown injection): nome aula con `_` non rompe l'invio.
  // Prima del fix il render `*Test_Site*` faceva 400 da Telegram → silent fail.
  it('Markdown injection: nome aula con caratteri speciali viene sanitizzato', async () => {
    const user = await createUser({ status: 'approved' });
    await configureTelegram();
    const { Building, Room } = require('../../models');
    const inst = await require('../factories').createInstitute({ name: 'Test_Inst' });
    const sede = await Building.create({ instituteId: inst.id, name: 'Sede_Storica' });
    await Room.create({ buildingId: sede.id, name: 'Aula_*42*', code: 'A_42', floor: 'PT' });
    await BotBinding.create({
      channel: 'telegram',
      externalId: '9001',
      userId: user.id,
      boundAt: new Date(),
    });
    lastSent = null;
    await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(9001, '/aule'));
    const r = await waitForReply();
    expect(r.text).toBeTruthy();
    // I caratteri Markdown speciali devono essere stati strippati (non
    // appaiono `_`, `*` non bilanciati nel testo finale)
    expect(r.text).not.toMatch(/[_*]42[_*]/);
    // Lo strip preserva l'idea del nome con spazi al loro posto
    expect(r.text).toContain('Sede Storica');
  });

  // Regressione #2/#7 (race binding): doppio bind con OTP valido non corrompe.
  // Con findOrCreate idempotente il secondo bind trova la riga esistente.
  it('Doppio bind con OTP non genera eccezione (idempotente con findOrCreate)', async () => {
    const { user, authHeader } = await createAuthedUser({ status: 'approved' });
    await configureTelegram();
    const initRes = await request(app)
      .post('/api/users/me/bot-bindings/init')
      .set('Authorization', authHeader);
    const otp = initRes.body.otp;

    // Primo bind
    await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(202, `bind ${otp}`));
    await waitForReply();
    const firstCount = await BotBinding.count({
      where: { channel: 'telegram', externalId: '202' },
    });
    expect(firstCount).toBe(1);

    // Re-init OTP (la prima è stata consumata) e ri-bind sullo stesso chatId
    const init2 = await request(app)
      .post('/api/users/me/bot-bindings/init')
      .set('Authorization', authHeader);
    lastSent = null;
    await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(202, `bind ${init2.body.otp}`));
    await waitForReply();
    // Nessun duplicato (UNIQUE rispettato), riga riassegnata se necessario
    const finalCount = await BotBinding.count({
      where: { channel: 'telegram', externalId: '202' },
    });
    expect(finalCount).toBe(1);
    const binding = await BotBinding.findOne({
      where: { channel: 'telegram', externalId: '202' },
    });
    expect(binding.userId).toBe(user.id);
  });

  // Regressione #11 (externalId length): payload con chat_id anomalo non
  // fa esplodere l'INSERT — viene droppato silenziosamente con log.
  it('externalId >190 char viene droppato senza eccezione', async () => {
    await configureTelegram();
    const longId = '9'.repeat(250); // > 190
    const res = await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(longId, '/help'));
    expect(res.status).toBe(200);
    // Nessuna reply attesa (drop silenzioso lato bot)
    const sent = await waitForReply(150);
    expect(sent).toBeNull();
    // Niente sessione/binding creati
    const sessionCount = await ChatSession.count({
      where: { channel: 'telegram', externalId: longId },
    });
    expect(sessionCount).toBe(0);
  });

  // Regressione #12 (cancel race): doppio /cancel atomicamente serializzato
  it('Doppio /cancel concorrente non duplica side effects', async () => {
    const user = await createUser({ status: 'approved' });
    await configureTelegram();
    await BotBinding.create({
      channel: 'telegram',
      externalId: '303',
      userId: user.id,
      boundAt: new Date(),
    });
    const { Booking, Building, Room } = require('../../models');
    const inst = await require('../factories').createInstitute({ name: 'CancelTest' });
    const sede = await Building.create({ instituteId: inst.id, name: 'Sede' });
    const room = await Room.create({ buildingId: sede.id, name: 'A', floor: 'PT' });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const futureEnd = new Date(future.getTime() + 60 * 60 * 1000);
    const booking = await Booking.create({
      userId: user.id,
      roomId: room.id,
      startTime: future,
      endTime: futureEnd,
      type: 'studio_individuale',
      status: 'confirmed',
      purpose: 'test',
    });

    // Due cancel back-to-back: il lock chat serializza, ma anche se non lo
    // facesse, il fix transazionale evita doppio update.
    await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(303, `/cancel ${booking.id}`));
    await waitForReply();
    lastSent = null;
    await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(303, `/cancel ${booking.id}`));
    const r = await waitForReply();
    // Il secondo cancel ottiene il messaggio "già annullata" (no duplica)
    expect(r.text).toMatch(/già annullata|non.*cancellabile/i);
  });

  // Regressione: dopo revoca + re-bind dallo stesso chatId, i comandi devono
  // continuare a funzionare. Il bug originale: ChatSession è paranoid (soft
  // delete), revocando il binding la riga restava con deletedAt valorizzato,
  // ma l'index UNIQUE su (channel, externalId) bloccava la creazione di una
  // nuova riga. Risultato: eccezione silente nella pipeline → "doppia spunta"
  // su Telegram ma nessuna risposta del bot.
  it('revoke + re-bind + /help → bot risponde (no eccezione UNIQUE su ChatSession)', async () => {
    const { user, authHeader } = await createAuthedUser({ status: 'approved' });
    await configureTelegram();
    const CHAT_ID = '888';

    // 1) Primo bind: init OTP + bind dal canale
    const init1 = await request(app)
      .post('/api/users/me/bot-bindings/init')
      .set('Authorization', authHeader);
    await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(Number(CHAT_ID), `bind ${init1.body.otp}`));
    await waitForReply();
    const binding1 = await BotBinding.findOne({
      where: { channel: 'telegram', externalId: CHAT_ID },
    });
    expect(binding1).not.toBeNull();

    // /help dopo il primo bind → deve funzionare
    lastSent = null;
    await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(Number(CHAT_ID), '/help'));
    let reply = await waitForReply();
    expect(reply?.text).toMatch(/Cadenza.*Bot/);

    // 2) Revoca binding (soft-delete della ChatSession lato backend)
    await request(app)
      .delete(`/api/users/me/bot-bindings/${binding1.id}`)
      .set('Authorization', authHeader);

    // 3) Nuovo init OTP + re-bind dallo stesso chatId
    const init2 = await request(app)
      .post('/api/users/me/bot-bindings/init')
      .set('Authorization', authHeader);
    lastSent = null;
    await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(Number(CHAT_ID), `bind ${init2.body.otp}`));
    reply = await waitForReply();
    expect(reply?.text).toMatch(/Collegamento completato/i);

    // 4) Comando /help dopo il re-bind: il bot DEVE rispondere.
    //    Prima del fix: l'eccezione UNIQUE su INSERT ChatSession bloccava
    //    silentemente questa risposta.
    lastSent = null;
    await request(app)
      .post('/api/messaging/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
      .send(tgPayload(Number(CHAT_ID), '/help'));
    reply = await waitForReply();
    expect(reply?.text).toMatch(/Cadenza.*Bot/);
    expect(reply?.text).toContain('/book');

    // La ChatSession è stata "ressuscitata", non duplicata
    const sessions = await ChatSession.findAll({
      where: { channel: 'telegram', externalId: CHAT_ID },
      paranoid: false,
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].deletedAt).toBeNull();
    expect(sessions[0].userId).toBe(user.id);
  });
});
