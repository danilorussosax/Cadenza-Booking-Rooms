'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { MailSettings } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { encrypt } = require('../lib/crypto');
const { sendTestEmail, invalidateCache } = require('../services/emailService');

const router = express.Router();

// Helper: nasconde la password e indica solo se presente
function toSafeJson(row) {
  if (!row) {
    return {
      isEnabled: false,
      host: null,
      port: 587,
      secure: false,
      username: null,
      passwordSet: false,
      fromAddress: null,
      fromName: null,
      replyTo: null,
      source: 'env-fallback',
    };
  }
  return {
    isEnabled: row.isEnabled,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    passwordSet: !!row.passwordEncrypted,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    replyTo: row.replyTo,
    source: row.isEnabled ? 'database' : 'database-disabled',
    updatedAt: row.updatedAt,
  };
}

// GET — admin only
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const row = await MailSettings.findByPk(1);
  res.json({
    settings: toSafeJson(row),
    envFallback: {
      hasEnvHost: !!process.env.SMTP_HOST,
    },
  });
});

// PUT — admin only. Password opzionale: se omessa, mantiene quella esistente.
router.put(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('host').optional({ nullable: true }).isString(),
    body('port').optional().isInt({ min: 1, max: 65535 }),
    body('secure').optional().isBoolean(),
    body('username').optional({ nullable: true }).isString(),
    body('password').optional({ nullable: true }).isString(),
    body('fromAddress').optional({ nullable: true }).isEmail(),
    body('fromName').optional({ nullable: true }).isString(),
    body('replyTo').optional({ nullable: true }).isEmail(),
    body('isEnabled').optional().isBoolean(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });

    let row = await MailSettings.findByPk(1);
    if (!row) row = await MailSettings.create({ id: 1 });

    const { host, port, secure, username, password, fromAddress, fromName, replyTo, isEnabled } =
      req.body;

    if (host !== undefined) row.host = host || null;
    if (port !== undefined) row.port = port;
    if (secure !== undefined) row.secure = !!secure;
    if (username !== undefined) row.username = username || null;
    if (password !== undefined && password !== '') {
      row.passwordEncrypted = encrypt(password);
    } else if (password === '') {
      row.passwordEncrypted = null;
    }
    if (fromAddress !== undefined) row.fromAddress = fromAddress || null;
    if (fromName !== undefined) row.fromName = fromName || null;
    if (replyTo !== undefined) row.replyTo = replyTo || null;
    if (isEnabled !== undefined) row.isEnabled = !!isEnabled;

    await row.save();
    invalidateCache(); // forza ricarica al prossimo invio

    res.json({ settings: toSafeJson(row) });
  },
);

// POST /test — invia email di test all'indirizzo specificato (default: req.user.email)
router.post(
  '/test',
  authenticate,
  requireRole('admin'),
  [body('to').optional().isEmail()],
  async (req, res) => {
    const to = req.body?.to || req.user.email;
    const result = await sendTestEmail({
      to,
      subject: 'Test invio · Cadenza',
      message: req.body?.message,
    });
    // Risposta sempre 200: il test viene eseguito; ok=true/false indica l'esito
    if (result.ok) return res.json({ ok: true, sentTo: to });
    res.json({ ok: false, error: result.error, raw: result.raw });
  },
);

module.exports = router;
