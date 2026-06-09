'use strict';

// =============================================================================
// Adapter Signal — pluggable via signal-cli REST.
//
// Setup (admin UI Messaging Settings):
//   1. Installa signal-cli su un host raggiungibile dal backend (Docker
//      consigliato): https://github.com/AsamK/signal-cli
//   2. Registra un numero dedicato (anche prepagato) e attiva la modalità
//      daemon REST: `signal-cli daemon --http 0.0.0.0:8080`
//   3. Configura su Cadenza (admin → messaging):
//      - phoneNumber: numero registrato (E.164, es. +393331234567)
//      - daemonUrl:   URL HTTP del daemon (es. http://signal:8080)
//      - webhookSecret: stringa random per validare webhook in arrivo
//   4. Inoltra i messaggi entranti dal daemon al webhook Cadenza con il
//      header `X-Signal-Webhook-Secret: <webhookSecret>`.
//
// Limiti rispetto a Telegram/WhatsApp Cloud:
//   - signal-cli è community-maintained (non ufficiale), SLA non garantito
//   - Niente template messages: tutti i messaggi outbound sono testo libero
//   - Numeri verificati richiedono manutenzione (refresh credenziali)
//
// Adapter rimane "stub funzionale": le chiamate verso il daemon sono
// implementate ma sono disabilitate finché l'admin non configura phoneNumber
// + daemonUrl. La pipeline di processing (verifyWebhook, parseIncoming, ecc.)
// è completa e identica agli altri adapter.
// =============================================================================

const crypto = require('crypto');

function verifyWebhook(req, config) {
  const expected = config?.credentials?.webhookSecret;
  if (!expected) return false;
  const got = req.get('X-Signal-Webhook-Secret');
  if (typeof got !== 'string') return false;
  // Confronto a tempo costante: hash di entrambi i lati così timingSafeEqual
  // opera su buffer di lunghezza identica e non leakiamo la lunghezza del secret.
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Il daemon signal-cli vive tipicamente su rete interna (es. http://signal:8080),
 * quindi NON blocchiamo gli IP privati. Whitelist del solo protocollo http(s):
 * impedisce schemi pericolosi (file:, gopher:, ftp:) se un admin compromesso
 * salva un daemonUrl malevolo.
 */
function assertHttpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('signal_cli: daemonUrl non è un URL valido');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('signal_cli: daemonUrl deve usare http o https');
  }
}

/** Atteso payload signal-cli HTTP forward:
 *  { envelope: { source: '+393...', dataMessage: { message: '...' } } } */
function parseIncoming(req) {
  const env = req.body?.envelope;
  if (!env) return null;
  const text = env.dataMessage?.message;
  if (!text || !env.source) return null;
  return {
    channel: 'signal_cli',
    externalId: env.source,
    text,
    raw: env,
  };
}

async function send(externalId, text, config) {
  const phone = config?.credentials?.phoneNumber || config?.settings?.phoneNumber;
  const daemonUrl = config?.credentials?.daemonUrl || config?.settings?.daemonUrl;
  if (!phone || !daemonUrl) throw new Error('signal_cli: phoneNumber o daemonUrl mancanti');
  assertHttpUrl(daemonUrl);
  const url = `${daemonUrl.replace(/\/$/, '')}/v2/send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: phone,
      recipients: [externalId],
      message: text,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`signal_cli send failed (${res.status}): ${errText.slice(0, 200)}`);
  }
}

async function testConnection(config) {
  const daemonUrl = config?.credentials?.daemonUrl || config?.settings?.daemonUrl;
  if (!daemonUrl) return { ok: false, error: 'daemonUrl mancante' };
  try {
    assertHttpUrl(daemonUrl);
    const res = await fetch(`${daemonUrl.replace(/\/$/, '')}/v1/about`);
    if (!res.ok) return { ok: false, error: `daemon ${res.status}` };
    const json = await res.json().catch(() => ({}));
    return { ok: true, info: { version: json.version } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { verifyWebhook, parseIncoming, send, testConnection };
