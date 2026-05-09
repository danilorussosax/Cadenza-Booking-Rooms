'use strict';

// =============================================================================
// /api/admin/messaging-settings
//
// Solo admin. Configura i 4 canali (telegram, whatsapp_cloud, signal_cli,
// email_imap): toggle on/off + credenziali cifrate.
//
//   GET    /                  → lista settings di tutti i canali (no secret)
//   PUT    /:channel          → upsert settings + credenziali del canale
//   POST   /:channel/test     → test connessione (adapter.testConnection)
//   GET    /:channel/secret   → ⚠️ NON disponibile — i secret non si ri-leggono
//
// Le credenziali in chiaro vengono SOLO scritte via PUT, mai rilette dal
// client. La UI mostra solo `isEnabled` + indicatori "secret configurato".
// =============================================================================

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { MessagingSettings } = require('../models');
const { encrypt, decrypt } = require('../lib/crypto');
const messaging = require('../services/messaging');
const telegramSetup = require('../services/messaging/telegramSetup');

router.use(authenticate, requireRole('admin'));

const SECRET_PLACEHOLDER = '__KEEP__';

router.get('/', async (req, res, next) => {
  try {
    const rows = await MessagingSettings.findAll();
    const byChannel = new Map(rows.map((r) => [r.channel, r]));
    const out = messaging.SUPPORTED_CHANNELS.map((channel) => {
      const row = byChannel.get(channel);
      const credentials = row?.credentialsEncrypted
        ? safeDecryptKeys(row.credentialsEncrypted)
        : {};
      return {
        channel,
        isEnabled: row?.isEnabled ?? false,
        settings: row?.settings ?? {},
        // NON ritorniamo i secret in chiaro — solo flag "configurato".
        credentialsSet: credentials,
      };
    });
    res.json({ settings: out });
  } catch (err) {
    next(err);
  }
});

router.put('/:channel', async (req, res, next) => {
  try {
    const { channel } = req.params;
    if (!messaging.SUPPORTED_CHANNELS.includes(channel)) {
      return res.status(400).json({ error: 'Canale non supportato', code: 'CHANNEL_INVALID' });
    }
    const { isEnabled, settings, credentials } = req.body ?? {};
    let row = await MessagingSettings.findOne({ where: { channel } });
    if (!row) row = await MessagingSettings.create({ channel, isEnabled: false });
    if (typeof isEnabled === 'boolean') row.isEnabled = isEnabled;
    if (settings && typeof settings === 'object') row.settings = settings;
    if (credentials && typeof credentials === 'object') {
      // Merge: se il client passa SECRET_PLACEHOLDER, mantieni il vecchio
      // valore. Permette di aggiornare un solo secret per volta.
      const previous = row.credentialsEncrypted
        ? JSON.parse(decrypt(row.credentialsEncrypted))
        : {};
      const merged = { ...previous };
      for (const [k, v] of Object.entries(credentials)) {
        if (v === SECRET_PLACEHOLDER) continue;
        if (v === '' || v == null) delete merged[k];
        else merged[k] = String(v);
      }
      row.credentialsEncrypted =
        Object.keys(merged).length > 0 ? encrypt(JSON.stringify(merged)) : null;
    }
    await row.save();
    res.json({
      channel: row.channel,
      isEnabled: row.isEnabled,
      settings: row.settings ?? {},
      credentialsSet: row.credentialsEncrypted ? safeDecryptKeys(row.credentialsEncrypted) : {},
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:channel/test', async (req, res, next) => {
  try {
    const { channel } = req.params;
    if (!messaging.SUPPORTED_CHANNELS.includes(channel)) {
      return res.status(400).json({ error: 'Canale non supportato', code: 'CHANNEL_INVALID' });
    }
    const config = await messaging.loadChannelConfig(channel);
    if (!config)
      return res
        .status(400)
        .json({ error: 'Canale disabilitato o non configurato', code: 'CHANNEL_DISABLED' });
    const adapter = messaging.getAdapter(channel);
    if (!adapter?.testConnection)
      return res.json({ ok: false, error: 'testConnection non implementato per questo canale' });
    const result = await adapter.testConnection(config);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// POST /:channel/auto-configure
//
// Telegram: orchestrazione completa della configurazione lato Telegram Bot API
// (setWebhook + setMyCommands + setMyDescription + … ) a partire dal solo
// `botToken` salvato nelle credenziali. Se `webhookSecret` non esiste ancora,
// lo genera (32 byte hex) e lo persiste cifrato.
//
// Ritorna l'esito di ciascuno step + eventuali warning non bloccanti.
//
// Ad oggi solo Telegram è supportato. Gli altri canali rispondono 400.
// =============================================================================
router.post('/:channel/auto-configure', async (req, res, next) => {
  try {
    const { channel } = req.params;
    if (channel !== 'telegram') {
      return res.status(400).json({
        error: `Auto-configure non supportato per il canale "${channel}"`,
        code: 'AUTO_CONFIGURE_UNSUPPORTED',
      });
    }

    const row = await MessagingSettings.findOne({ where: { channel } });
    if (!row || !row.credentialsEncrypted) {
      return res.status(400).json({
        error: 'Salva prima il botToken nelle credenziali Telegram',
        code: 'CREDENTIALS_MISSING',
      });
    }

    const credentials = JSON.parse(decrypt(row.credentialsEncrypted));
    if (!credentials.botToken) {
      return res.status(400).json({
        error: 'botToken non presente nelle credenziali salvate',
        code: 'BOT_TOKEN_MISSING',
      });
    }

    // Se il webhookSecret non esiste, generane uno e persistilo. Questo permette
    // il caso d'uso "incolla il token, clicca auto-configure" — tutto il resto
    // segue automaticamente.
    let secretGenerated = false;
    if (!credentials.webhookSecret) {
      credentials.webhookSecret = crypto.randomBytes(32).toString('hex');
      row.credentialsEncrypted = encrypt(JSON.stringify(credentials));
      secretGenerated = true;
    }

    const frontendUrl =
      typeof req.body?.frontendUrl === 'string' && req.body.frontendUrl.trim()
        ? req.body.frontendUrl.trim()
        : process.env.FRONTEND_URL || process.env.APP_URL || '';

    const botName =
      typeof req.body?.botName === 'string' && req.body.botName.trim()
        ? req.body.botName.trim()
        : null;

    let result;
    try {
      result = await telegramSetup.autoConfigure({
        botToken: credentials.botToken,
        webhookSecret: credentials.webhookSecret,
        frontendUrl,
        botName,
      });
    } catch (err) {
      // Lascia comunque persistito il secret generato: ri-cliccando dopo aver
      // sistemato FRONTEND_URL non bisognerà ri-generarlo.
      if (secretGenerated) await row.save();
      return res.status(400).json({
        error: err.message,
        code: 'AUTO_CONFIGURE_FAILED',
        secretGenerated,
      });
    }

    // Tutto bene → assicurati che isEnabled sia ON (è il senso del bottone).
    if (!row.isEnabled) row.isEnabled = true;
    await row.save();

    res.json({
      ok: true,
      channel,
      secretGenerated,
      isEnabled: row.isEnabled,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

// Helpers
function safeDecryptKeys(enc) {
  try {
    const obj = JSON.parse(decrypt(enc));
    // Restituisci SOLO un oggetto chiave→true (no valori) per UI.
    return Object.fromEntries(Object.keys(obj).map((k) => [k, true]));
  } catch {
    return {};
  }
}

module.exports = router;
