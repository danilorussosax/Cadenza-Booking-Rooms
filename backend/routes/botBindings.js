'use strict';

// =============================================================================
// /api/users/me/bot-bindings
//
//   GET    /              → lista binding attivi dell'utente
//   POST   /init          → genera OTP 6 cifre, TTL 10min, ritorna codice
//   POST   /confirm       → (riservato per binding via web — non usato qui;
//                           il binding via bot avviene scrivendo "bind <OTP>"
//                           nel canale stesso, vedi services/messaging)
//   DELETE /:id           → revoca un binding (rimuove BotBinding)
// =============================================================================

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { BotBinding, ChatSession } = require('../models');
const rateLimit = require('../services/messaging/rateLimit');

const OTP_TTL_MIN = 10;
const OTP_LEN = 6;

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const rows = await BotBinding.findAll({
      where: { userId: req.user.id },
      order: [['boundAt', 'DESC']],
      attributes: ['id', 'channel', 'externalId', 'boundAt', 'lastSeenAt'],
    });
    // Mascheriamo l'externalId per privacy (non si sa mai chi vede lo schermo).
    res.json({
      bindings: rows.map((b) => ({
        id: b.id,
        channel: b.channel,
        externalIdMasked: maskExternalId(b.externalId),
        boundAt: b.boundAt,
        lastSeenAt: b.lastSeenAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/init', async (req, res, next) => {
  try {
    // Genera OTP alfanumerico 6 chars (no chars ambigui 0/O/1/I).
    const otp = generateOtp(OTP_LEN);
    const tokenHash = await bcrypt.hash(otp, 10);
    req.user.botBindingChallenge = {
      tokenHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
    };
    await req.user.save();
    res.json({ otp, expiresInMinutes: OTP_TTL_MIN });
  } catch (err) {
    next(err);
  }
});

// Endpoint /confirm riservato a future estensioni (bind via web confermando
// codice di un canale). Per ora restituisce 501.
router.post('/confirm', (_req, res) => {
  res.status(501).json({
    error:
      'Conferma binding via web non supportata: invia il codice OTP nel canale del bot scrivendo "bind <OTP>".',
    code: 'NOT_IMPLEMENTED',
  });
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const binding = await BotBinding.findOne({ where: { id, userId: req.user.id } });
    if (!binding) return res.status(404).json({ error: 'Binding non trovato', code: 'NOT_FOUND' });
    // Soft-cleanup ChatSession associata (così ripartirà fresca alla rebind).
    await ChatSession.destroy({
      where: { channel: binding.channel, externalId: binding.externalId },
    });
    await binding.destroy();
    // Reset rate limiter per (channel, externalId): se l'utente ha
    // accidentalmente floodato durante un debug del binding, evitiamo che
    // resti un cooldown attivo dopo la revoca.
    rateLimit.reset(binding.channel, binding.externalId);
    res.json({ message: 'Binding revocato' });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Helpers
// =============================================================================

function generateOtp(len) {
  // Alfabeto senza caratteri ambigui (0, O, 1, I, L)
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function maskExternalId(eid) {
  if (!eid) return '';
  // Telegram chat_id (numerico): mostra primi 3 + ultimi 2
  if (/^-?\d+$/.test(eid)) {
    const s = String(eid);
    if (s.length <= 5) return s;
    return `${s.slice(0, 3)}…${s.slice(-2)}`;
  }
  // Phone-like: mostra prefix internazionale + 2 finali
  if (/^\+?\d{6,}$/.test(eid)) {
    return `${eid.slice(0, 4)}…${eid.slice(-2)}`;
  }
  // Email: mostra prima parte locale + dominio
  if (eid.includes('@')) {
    const [local, domain] = eid.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return eid;
}

module.exports = router;
