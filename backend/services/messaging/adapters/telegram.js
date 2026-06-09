'use strict';

// =============================================================================
// Adapter Telegram Bot API.
//
// Setup (admin UI Messaging Settings):
//   1. /newbot via @BotFather → ottieni botToken
//   2. Scegli un secret HMAC random (es. crypto.randomBytes(32).toString('hex'))
//   3. Salva botToken + webhookSecret in MessagingSettings via UI admin
//   4. Registra il webhook:
//      curl -F "url=https://cadenza.example.it/api/messaging/telegram/webhook" \
//           -F "secret_token=<webhookSecret>" \
//           https://api.telegram.org/bot<botToken>/setWebhook
//
// Telegram firma il webhook con `X-Telegram-Bot-Api-Secret-Token` che deve
// matchare il secret configurato. Niente HMAC del body — è un confronto
// di stringa costante.
// =============================================================================

const crypto = require('crypto');

const TELEGRAM_API = 'https://api.telegram.org';

function verifyWebhook(req, config) {
  const expected = config?.credentials?.webhookSecret;
  if (!expected) return false;
  const got = req.get('X-Telegram-Bot-Api-Secret-Token');
  if (typeof got !== 'string') return false;
  // Confronto a tempo costante: hash di entrambi i lati così timingSafeEqual
  // opera su buffer di lunghezza identica e non leakiamo la lunghezza del secret.
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Telegram update payload — ci interessa solo `message.text` o `edited_message.text`. */
function parseIncoming(req) {
  const body = req.body || {};
  const msg = body.message || body.edited_message || body.channel_post;
  if (!msg) return null;
  const chatId = String(msg.chat?.id ?? '');
  const text = typeof msg.text === 'string' ? msg.text : '';
  if (!chatId) return null;
  return {
    channel: 'telegram',
    externalId: chatId,
    text,
    raw: msg,
  };
}

async function send(externalId, text, config) {
  const token = config?.credentials?.botToken;
  if (!token) {
    throw new Error('telegram: botToken mancante');
  }
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: externalId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`telegram send failed (${res.status}): ${errText.slice(0, 200)}`);
  }
}

async function testConnection(config) {
  const token = config?.credentials?.botToken;
  if (!token) return { ok: false, error: 'botToken mancante' };
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
    if (!res.ok) return { ok: false, error: `getMe ${res.status}` };
    const json = await res.json();
    if (!json.ok) return { ok: false, error: json.description || 'getMe failed' };
    return { ok: true, info: { username: json.result?.username, name: json.result?.first_name } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { verifyWebhook, parseIncoming, send, testConnection };
