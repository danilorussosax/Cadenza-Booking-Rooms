'use strict';

// =============================================================================
// Adapter Email-in (IMAP poll). Adapter "fallback always-on" che usa la
// mailbox dedicata (es. book@conservatorio.it) come canale conversazionale.
//
// Setup (vedi docs/BOT-MESSAGING.md):
//   1. Crea casella IMAP dedicata sul server di posta del Conservatorio.
//   2. Configura su Aula Book (admin → messaging):
//      - host, port, secure (true per IMAPS porta 993)
//      - user, password
//      - pollIntervalSec (default 30s)
//   3. Il backend avvia un ticker (services/messaging/imapPoller.js, da
//      implementare in Sprint 5+) che fa poll della INBOX, marca messaggi
//      visti e li passa a handleIncoming come fossero webhook.
//
// QUESTO ADAPTER è uno stub: la pipeline interna (verifyWebhook,
// parseIncoming, send) è in posizione e funzionale per coerenza, ma il
// trigger inbound vero e proprio sarà aggiunto col poller dedicato.
//
// Nota: per `send` usa il transporter SMTP esistente (services/emailService).
// =============================================================================

const { sendSecurityEmail } = require('../../emailService');

function verifyWebhook(_req, _config) {
  // L'IMAP poller non passa per webhook → il "trust" è interno.
  // Quando il poller dispatcha al messaging core può marcare req con un
  // flag (req.internal = true) e qui ritornare true.
  return true;
}

function parseIncoming(req) {
  // Atteso payload artificialmente costruito dal poller IMAP:
  // { from: 'studente@x.it', text: '...', subject: '...' }
  const body = req.body || {};
  if (!body.from || !body.text) return null;
  return {
    channel: 'email_imap',
    externalId: String(body.from).toLowerCase(),
    text: body.text,
    raw: body,
  };
}

async function send(externalId, text, _config) {
  // Riusa il transporter SMTP. L'email risulta come "risposta automatica"
  // dal mittente configurato in MailSettings.
  await sendSecurityEmail({
    to: externalId,
    subject: 'Aula Book · risposta',
    html: `<pre style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;font-size:14px;line-height:1.5;color:#1a2234;background:#f7f9fc;padding:16px;border-radius:8px;border:1px solid #e2e8f0;">${escapeHtml(text)}</pre>`,
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function testConnection(_config) {
  // Non implementato: richiede client IMAP. Vedi docs/BOT-MESSAGING.md
  // per il roadmap del poller.
  return { ok: false, error: 'IMAP poll non ancora implementato (stub)' };
}

module.exports = { verifyWebhook, parseIncoming, send, testConnection };
