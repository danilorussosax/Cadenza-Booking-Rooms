'use strict';

// =============================================================================
// POST /api/messaging/{channel}/webhook
//
// Pipeline:
//   1. Carica config canale + adapter (404 se canale non abilitato)
//   2. Verifica firma webhook (401 se non valida)
//   3. Parse payload → IncomingMessage
//   4. Process via services/messaging.handleIncoming
//   5. Reply via adapter.send (best-effort, non blocca la 200 al provider)
//
// Risposta sempre 200 al provider (anche su errore interno) per evitare
// retry storm. Errori loggati ma non rilanciati.
// =============================================================================

const express = require('express');
const router = express.Router();
const messaging = require('../services/messaging');

const ALLOWED_CHANNELS = ['telegram', 'whatsapp_cloud', 'signal_cli'];

// GET /webhook (handshake Meta WhatsApp)
router.get('/whatsapp_cloud/webhook', async (req, res, next) => {
  try {
    const config = await messaging.loadChannelConfig('whatsapp_cloud');
    if (!config) return res.status(404).send('disabled');
    const wa = require('../services/messaging/adapters/whatsapp_cloud');
    const verify = wa.handleVerify(req, config);
    if (!verify.ok) return res.status(403).send('forbidden');
    res.status(200).send(verify.body);
  } catch (err) {
    next(err);
  }
});

// POST webhook per ogni canale
for (const channel of ALLOWED_CHANNELS) {
  router.post(`/${channel}/webhook`, async (req, res) => {
    try {
      const config = await messaging.loadChannelConfig(channel);
      if (!config) return res.status(404).send('disabled');
      const ok = messaging.verifyWebhook(channel, req, config);
      if (!ok) return res.status(401).send('bad signature');

      // 200 IMMEDIATAMENTE (Telegram timeout 60s, WA 10s) — processiamo async
      res.status(200).send('ok');

      const adapter = messaging.getAdapter(channel);
      if (!adapter) return;
      const incoming = adapter.parseIncoming(req);
      if (!incoming) return;
      const result = await messaging.handleIncoming(incoming, config);
      if (result?.reply) {
        try {
          await adapter.send(incoming.externalId, result.reply, config);
        } catch (err) {
          console.error(`[messaging:${channel}] send error:`, err.message);
        }
      }
    } catch (err) {
      console.error(`[messaging:${channel}] webhook error:`, err.message);
      // already sent 200, niente da fare
    }
  });
}

module.exports = router;
