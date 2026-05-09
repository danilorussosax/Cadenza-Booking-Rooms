'use strict';

// =============================================================================
// Adapter WhatsApp Cloud API (Meta diretta).
//
// Setup (vedi docs/BOT-MESSAGING.md):
//   1. Crea una Meta Business app + WhatsApp Business → ottieni:
//      - phoneNumberId (quale numero usare)
//      - accessToken (Bearer token long-lived)
//      - appSecret (per HMAC SHA256 della firma webhook)
//      - verifyToken (stringa random scelta da te per il GET di verifica)
//   2. Configura webhook su Meta:
//      callback URL = https://cadenza.example.it/api/messaging/whatsapp_cloud/webhook
//      verify_token = <verifyToken>
//      subscribe a "messages" + "message_status"
//   3. Salva tutti i campi in MessagingSettings via UI admin.
//
// IMPORTANTE: per inviare messaggi outbound > 24h dall'ultima inbound del
// destinatario serve un "template message" pre-approvato (categoria utility
// per conferme di prenotazione). Per ora l'adapter manda solo testo libero
// in finestra di servizio (24h dall'ultimo inbound del cliente).
// =============================================================================

const crypto = require('crypto');

const META_GRAPH = 'https://graph.facebook.com/v21.0';

function verifyWebhook(req, config) {
  // Meta firma il body con HMAC-SHA256 usando appSecret. Header:
  // `X-Hub-Signature-256: sha256=<hex>`
  const appSecret = config?.credentials?.appSecret;
  if (!appSecret) return false;
  const sig = req.get('X-Hub-Signature-256') || '';
  if (!sig.startsWith('sha256=')) return false;
  const provided = sig.slice('sha256='.length);
  // `req.rawBody` deve essere stato preservato dall'app (vedi app.js,
  // express.json({ verify: ... })). Senza il raw body byte-per-byte
  // l'HMAC è ricostruibile solo per coincidenza: un fallback a
  // `JSON.stringify(req.body)` produrrebbe rejection deterministica del
  // webhook con messaggio "firma non valida" pur essendo un bug nostro.
  // Meglio fallire esplicitamente con log.
  if (!req.rawBody) {
    console.error(
      '[whatsapp_cloud] verifyWebhook: req.rawBody mancante — controlla che ' +
        'app.js usi express.json({ verify: ... }) per le rotte /api/messaging/.',
    );
    return false;
  }
  const expected = crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
}

/** Estrae il primo messaggio testuale dal payload Meta. */
function parseIncoming(req) {
  const body = req.body || {};
  // Struttura: entry[].changes[].value.messages[]
  const value = body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return null;
  if (msg.type !== 'text') return null; // ignora media per ora
  const externalId = msg.from; // msisdn senza '+'
  const text = msg.text?.body ?? '';
  return {
    channel: 'whatsapp_cloud',
    externalId,
    text,
    raw: msg,
  };
}

async function send(externalId, text, config) {
  const token = config?.credentials?.accessToken;
  const phoneId = config?.credentials?.phoneNumberId || config?.settings?.phoneNumberId;
  if (!token || !phoneId) throw new Error('whatsapp_cloud: accessToken o phoneNumberId mancanti');
  const url = `${META_GRAPH}/${phoneId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: externalId,
      type: 'text',
      text: { body: text, preview_url: false },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`whatsapp_cloud send failed (${res.status}): ${errText.slice(0, 200)}`);
  }
}

async function testConnection(config) {
  const token = config?.credentials?.accessToken;
  const phoneId = config?.credentials?.phoneNumberId || config?.settings?.phoneNumberId;
  if (!token || !phoneId) return { ok: false, error: 'credenziali incomplete' };
  try {
    const res = await fetch(`${META_GRAPH}/${phoneId}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: `meta ${res.status}` };
    const json = await res.json();
    return { ok: true, info: { number: json.display_phone_number, name: json.verified_name } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Verification challenge GET (Meta lo chiama per validare l'URL). */
function handleVerify(req, config) {
  const expected = config?.credentials?.verifyToken;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && expected && token === expected) {
    return { ok: true, body: challenge };
  }
  return { ok: false };
}

module.exports = { verifyWebhook, parseIncoming, send, testConnection, handleVerify };
