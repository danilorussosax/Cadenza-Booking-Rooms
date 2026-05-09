'use strict';

/**
 * Integration test: POST /api/admin/messaging-settings/telegram/auto-configure
 *
 * Test cases:
 *   1. credenziali mancanti → 400 CREDENTIALS_MISSING
 *   2. botToken mancante (creds vuote senza botToken) → 400 BOT_TOKEN_MISSING
 *   3. happy path → 200, esegue 6 chiamate Telegram, secret generato
 *   4. webhookSecret già presente → niente secretGenerated, ma stesse chiamate
 *   5. errore di Telegram (es. token invalido) → 400 AUTO_CONFIGURE_FAILED
 *   6. FRONTEND_URL non https → 400 con messaggio chiaro
 *   7. canale ≠ telegram → 400 AUTO_CONFIGURE_UNSUPPORTED
 *   8. step opzionali (setMyDescription) che falliscono → 200 con warnings
 *
 * Mock: stub di global.fetch per intercettare le chiamate a api.telegram.org
 * senza rete reale.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAuthedUser } = require('../factories');
const { MessagingSettings } = require('../../models');
const { encrypt, decrypt } = require('../../lib/crypto');

const app = buildApp({ serveFrontend: false });

// ─── Mock fetch globale ────────────────────────────────────────────────────
const realFetch = global.fetch;
let fetchCalls = [];
let fetchPlan = null; // funzione (url, init) → response

function mockFetch(plan) {
  fetchPlan = plan;
  fetchCalls = [];
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    if (typeof plan === 'function') return plan(String(url), init);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
  };
}

afterAll(() => {
  global.fetch = realFetch;
});

// ─── Helpers ───────────────────────────────────────────────────────────────
async function configureTelegramRow(overrides = {}) {
  await MessagingSettings.destroy({ where: { channel: 'telegram' } });
  const credsObj = {
    botToken: overrides.botToken === undefined ? 'TEST:TOKEN' : overrides.botToken,
    ...(overrides.webhookSecret ? { webhookSecret: overrides.webhookSecret } : {}),
  };
  return MessagingSettings.create({
    channel: 'telegram',
    isEnabled: overrides.isEnabled ?? false,
    settings: {},
    credentialsEncrypted:
      Object.keys(credsObj).length > 0 ? encrypt(JSON.stringify(credsObj)) : null,
  });
}

function makePlan({
  getMe,
  setWebhook,
  setMyCommands,
  setMyDescription,
  setMyShortDescription,
  setMyName,
  getWebhookInfo,
} = {}) {
  return (url) => {
    const m = url.match(/\/bot[^/]+\/(\w+)$/);
    const method = m ? m[1] : '';
    const r = (override) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: override?.result ?? true }),
    });
    switch (method) {
      case 'getMe':
        return (
          getMe ?? r({ result: { id: 999, username: 'cadenza_test_bot', first_name: 'Cadenza' } })
        );
      case 'setWebhook':
        return setWebhook ?? r();
      case 'setMyCommands':
        return setMyCommands ?? r();
      case 'setMyDescription':
        return setMyDescription ?? r();
      case 'setMyShortDescription':
        return setMyShortDescription ?? r();
      case 'setMyName':
        return setMyName ?? r();
      case 'getWebhookInfo':
        return (
          getWebhookInfo ??
          r({
            result: {
              url: 'https://cadenza.test.it/api/messaging/telegram/webhook',
              pending_update_count: 0,
            },
          })
        );
      default:
        return {
          ok: false,
          status: 404,
          json: async () => ({ ok: false, description: `unmocked ${method}` }),
        };
    }
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────
describe('POST /api/admin/messaging-settings/telegram/auto-configure', () => {
  let admin;
  const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;

  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://cadenza.test.it';
  });
  afterAll(() => {
    process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
  });

  beforeEach(async () => {
    await globalThis.resetDatabase();
    fetchCalls = [];
    fetchPlan = null;
    admin = await createAuthedUser({ role: 'admin' });
  });

  it('canale ≠ telegram → 400 AUTO_CONFIGURE_UNSUPPORTED', async () => {
    const res = await request(app)
      .post('/api/admin/messaging-settings/whatsapp_cloud/auto-configure')
      .set('Authorization', admin.authHeader);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUTO_CONFIGURE_UNSUPPORTED');
  });

  it('credenziali mancanti del tutto → 400 CREDENTIALS_MISSING', async () => {
    // Nessuna riga MessagingSettings per telegram
    const res = await request(app)
      .post('/api/admin/messaging-settings/telegram/auto-configure')
      .set('Authorization', admin.authHeader);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CREDENTIALS_MISSING');
  });

  it('botToken assente nelle credenziali salvate → 400 BOT_TOKEN_MISSING', async () => {
    await configureTelegramRow({ botToken: null });
    const res = await request(app)
      .post('/api/admin/messaging-settings/telegram/auto-configure')
      .set('Authorization', admin.authHeader);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOT_TOKEN_MISSING');
  });

  it('happy path: registra webhook + comandi + descrizioni, genera secret', async () => {
    await configureTelegramRow({ botToken: 'TEST:HAPPY' });
    mockFetch(makePlan());

    const res = await request(app)
      .post('/api/admin/messaging-settings/telegram/auto-configure')
      .set('Authorization', admin.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.secretGenerated).toBe(true);
    expect(res.body.isEnabled).toBe(true); // attivato automaticamente
    expect(res.body.webhookUrl).toBe('https://cadenza.test.it/api/messaging/telegram/webhook');
    expect(res.body.bot.username).toBe('cadenza_test_bot');
    expect(res.body.steps.getMe.ok).toBe(true);
    expect(res.body.steps.setWebhook.ok).toBe(true);
    expect(res.body.steps.setMyCommands.ok).toBe(true);
    expect(res.body.steps.setMyCommands.count).toBeGreaterThan(0);
    expect(res.body.steps.setMyDescription.ok).toBe(true);
    expect(res.body.steps.setMyShortDescription.ok).toBe(true);
    expect(res.body.steps.getWebhookInfo.ok).toBe(true);

    // Verifica chiamate a Telegram
    const methods = fetchCalls.map((c) => c.url.match(/\/(\w+)$/)?.[1]).filter(Boolean);
    expect(methods).toEqual([
      'getMe',
      'setWebhook',
      'setMyCommands',
      'setMyDescription',
      'setMyShortDescription',
      'getWebhookInfo',
    ]);

    // Il setWebhook deve aver passato secret_token
    const setWebhookCall = fetchCalls.find((c) => c.url.endsWith('/setWebhook'));
    const body = JSON.parse(setWebhookCall.init.body);
    expect(body.url).toBe('https://cadenza.test.it/api/messaging/telegram/webhook');
    expect(typeof body.secret_token).toBe('string');
    expect(body.secret_token.length).toBeGreaterThanOrEqual(64);

    // Il secret deve essere persistito nel DB
    const row = await MessagingSettings.findOne({ where: { channel: 'telegram' } });
    const persistedCreds = JSON.parse(decrypt(row.credentialsEncrypted));
    expect(persistedCreds.webhookSecret).toBe(body.secret_token);
    expect(row.isEnabled).toBe(true);
  });

  it('webhookSecret pre-esistente → secretGenerated=false, il secret NON cambia', async () => {
    const fixedSecret = 'b'.repeat(64);
    await configureTelegramRow({ botToken: 'TEST:PREEXIST', webhookSecret: fixedSecret });
    mockFetch(makePlan());

    const res = await request(app)
      .post('/api/admin/messaging-settings/telegram/auto-configure')
      .set('Authorization', admin.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.secretGenerated).toBe(false);

    const setWebhookCall = fetchCalls.find((c) => c.url.endsWith('/setWebhook'));
    const body = JSON.parse(setWebhookCall.init.body);
    expect(body.secret_token).toBe(fixedSecret);
  });

  it('errore Telegram getMe (token invalido) → 400 AUTO_CONFIGURE_FAILED, secret persistito comunque', async () => {
    await configureTelegramRow({ botToken: 'INVALID' });
    mockFetch(
      makePlan({
        getMe: {
          ok: false,
          status: 401,
          json: async () => ({ ok: false, description: 'Unauthorized' }),
        },
      }),
    );

    const res = await request(app)
      .post('/api/admin/messaging-settings/telegram/auto-configure')
      .set('Authorization', admin.authHeader);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUTO_CONFIGURE_FAILED');
    expect(res.body.error).toMatch(/Unauthorized/);
    expect(res.body.secretGenerated).toBe(true);

    // Il secret è stato comunque persistito (così al ritentativo non ne genera uno nuovo)
    const row = await MessagingSettings.findOne({ where: { channel: 'telegram' } });
    const persistedCreds = JSON.parse(decrypt(row.credentialsEncrypted));
    expect(persistedCreds.webhookSecret).toBeDefined();
    expect(row.isEnabled).toBe(false); // non ha modificato isEnabled in caso di errore
  });

  it('FRONTEND_URL http (non https) → 400 con messaggio chiaro, niente chiamate Telegram', async () => {
    process.env.FRONTEND_URL = 'http://insecure.example.it';
    await configureTelegramRow({ botToken: 'TEST:HTTP' });
    mockFetch(makePlan());

    try {
      const res = await request(app)
        .post('/api/admin/messaging-settings/telegram/auto-configure')
        .set('Authorization', admin.authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AUTO_CONFIGURE_FAILED');
      expect(res.body.error).toMatch(/HTTPS/i);
      expect(fetchCalls).toHaveLength(0);
    } finally {
      process.env.FRONTEND_URL = 'https://cadenza.test.it';
    }
  });

  it('FRONTEND_URL localhost → 400 con suggerimento ngrok', async () => {
    process.env.FRONTEND_URL = 'https://localhost';
    await configureTelegramRow({ botToken: 'TEST:LOCAL' });
    mockFetch(makePlan());

    try {
      const res = await request(app)
        .post('/api/admin/messaging-settings/telegram/auto-configure')
        .set('Authorization', admin.authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AUTO_CONFIGURE_FAILED');
      expect(res.body.error).toMatch(/locale|ngrok/i);
    } finally {
      process.env.FRONTEND_URL = 'https://cadenza.test.it';
    }
  });

  it('setMyDescription fallisce ma resto OK → 200 con warning', async () => {
    await configureTelegramRow({ botToken: 'TEST:WARN' });
    mockFetch(
      makePlan({
        setMyDescription: {
          ok: false,
          status: 429,
          json: async () => ({ ok: false, description: 'Too Many Requests' }),
        },
      }),
    );

    const res = await request(app)
      .post('/api/admin/messaging-settings/telegram/auto-configure')
      .set('Authorization', admin.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.steps.setMyDescription.ok).toBe(false);
    expect(res.body.steps.setMyDescription.error).toMatch(/Too Many Requests/);
    expect(res.body.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/setMyDescription/)]),
    );
    // Gli step obbligatori sono comunque OK
    expect(res.body.steps.getMe.ok).toBe(true);
    expect(res.body.steps.setWebhook.ok).toBe(true);
    expect(res.body.steps.setMyCommands.ok).toBe(true);
  });

  it('non-admin → 403', async () => {
    const docente = await createAuthedUser({ role: 'docente' });
    await configureTelegramRow({ botToken: 'TEST:FORBIDDEN' });

    const res = await request(app)
      .post('/api/admin/messaging-settings/telegram/auto-configure')
      .set('Authorization', docente.authHeader);
    expect(res.status).toBe(403);
  });
});
