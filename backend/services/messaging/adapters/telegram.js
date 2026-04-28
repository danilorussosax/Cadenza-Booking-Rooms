'use strict';

// =============================================================================
// Adapter Telegram Bot API.
//
// Setup (vedi docs/BOT-MESSAGING.md):
//   1. /newbot via @BotFather → ottieni botToken
//   2. Scegli un secret HMAC random (es. crypto.randomBytes(32).toString('hex'))
//   3. Salva botToken + webhookSecret in MessagingSettings via UI admin
//   4. Registra il webhook:
//      curl -F "url=https://aulabook.example.it/api/messaging/telegram/webhook" \
//           -F "secret_token=<webhookSecret>" \
//           https://api.telegram.org/bot<botToken>/setWebhook
//
// Telegram firma il webhook con `X-Telegram-Bot-Api-Secret-Token` che deve
// matchare il secret configurato. Niente HMAC del body — è un confronto
// di stringa costante.
// =============================================================================

const TELEGRAM_API = 'https://api.telegram.org';

function verifyWebhook(req, config) {
  const expected = config?.credentials?.webhookSecret;
  if (!expected) return false;
  const got = req.get('X-Telegram-Bot-Api-Secret-Token');
  // Confronto a tempo costante per evitare timing attack
  if (typeof got !== 'string' || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i += 1) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
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
