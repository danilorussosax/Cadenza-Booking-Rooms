'use strict';

const express = require('express');
const { OAuthSettings } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { encrypt } = require('../lib/crypto');
const { normalizeAllowedDomainsInput, parseAllowedDomains } = require('../lib/emailDomainPolicy');

const router = express.Router();

// Sentinel per indicare "secret invariato" lato frontend (non lo restituiamo mai in chiaro)
const SECRET_PLACEHOLDER = '__unchanged__';

async function getOrCreate() {
  let settings = await OAuthSettings.findOne({ where: { id: 1 } });
  if (!settings) {
    settings = await OAuthSettings.create({
      id: 1,
      googleEnabled: false,
      microsoftEnabled: false,
      microsoftTenant: 'common',
    });
  }
  return settings;
}

function toSafe(settings) {
  // Espone tutti i campi ma maschera i secret
  return {
    googleEnabled: !!settings.googleEnabled,
    googleClientId: settings.googleClientId || '',
    googleClientSecretSet: !!settings.googleClientSecretEncrypted,
    googleCallbackUrl: settings.googleCallbackUrl || '',
    microsoftEnabled: !!settings.microsoftEnabled,
    microsoftClientId: settings.microsoftClientId || '',
    microsoftClientSecretSet: !!settings.microsoftClientSecretEncrypted,
    microsoftCallbackUrl: settings.microsoftCallbackUrl || '',
    microsoftTenant: settings.microsoftTenant || 'common',
    // Whitelist domini per il login OAuth. Esposta sia come stringa "canonica"
    // (per editing diretto) sia come array già normalizzato (comodo per UI).
    allowedEmailDomains: settings.allowedEmailDomains || '',
    allowedEmailDomainsList: parseAllowedDomains(settings.allowedEmailDomains),
    // Gate gruppi M365 (Consigli non rilevanti per Cadenza → 4 gruppi).
    groupGateEnabled: !!settings.groupGateEnabled,
    groupStudenti: settings.groupStudenti || 'Studenti',
    groupDocenti: settings.groupDocenti || 'Docenti',
    groupAmministrazione: settings.groupAmministrazione || 'Amministrazione',
    groupDirezione: settings.groupDirezione || 'Direzione',
  };
}

// GET /api/oauth-settings  (admin)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const settings = await getOrCreate();
  res.json({ settings: toSafe(settings) });
});

// PUT /api/oauth-settings  (admin)
// Body: tutti i campi sopra; per i secret, usare SECRET_PLACEHOLDER per mantenere l'attuale,
// stringa vuota per cancellarlo, qualunque altra stringa per impostarlo nuovo.
// Callback URL: accettiamo path relativo (`/api/auth/google/callback`) o URL
// assoluto http/https. Tutto il resto (schemi esotici, stringhe malformate)
// viene rifiutato: un callback arbitrario dirotterebbe l'authorization code
// OAuth verso un host controllato dall'attaccante.
function validateCallbackUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return trimmed;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw Object.assign(new Error('Callback URL non valido'), { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Callback URL deve usare http o https'), { status: 400 });
  }
  return trimmed;
}

router.put('/', authenticate, requireRole('admin'), async (req, res) => {
  const settings = await getOrCreate();
  const body = req.body || {};

  const updates = {};
  try {
    if (typeof body.googleCallbackUrl === 'string')
      updates.googleCallbackUrl = validateCallbackUrl(body.googleCallbackUrl);
    if (typeof body.microsoftCallbackUrl === 'string')
      updates.microsoftCallbackUrl = validateCallbackUrl(body.microsoftCallbackUrl);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message, code: 'VALIDATION_FAILED' });
  }
  if (typeof body.googleEnabled === 'boolean') updates.googleEnabled = body.googleEnabled;
  if (typeof body.googleClientId === 'string')
    updates.googleClientId = body.googleClientId.trim() || null;
  if (
    typeof body.googleClientSecret === 'string' &&
    body.googleClientSecret !== SECRET_PLACEHOLDER
  ) {
    updates.googleClientSecretEncrypted = body.googleClientSecret
      ? encrypt(body.googleClientSecret)
      : null;
  }

  if (typeof body.microsoftEnabled === 'boolean') updates.microsoftEnabled = body.microsoftEnabled;
  if (typeof body.microsoftClientId === 'string')
    updates.microsoftClientId = body.microsoftClientId.trim() || null;
  if (typeof body.microsoftTenant === 'string')
    updates.microsoftTenant = body.microsoftTenant.trim() || 'common';
  if (
    typeof body.microsoftClientSecret === 'string' &&
    body.microsoftClientSecret !== SECRET_PLACEHOLDER
  ) {
    updates.microsoftClientSecretEncrypted = body.microsoftClientSecret
      ? encrypt(body.microsoftClientSecret)
      : null;
  }

  // Whitelist domini email: il frontend può inviare sia stringa CSV che array.
  // Normalizziamo sempre (lowercase, trim, dedup, no '@' iniziale).
  if (body.allowedEmailDomains !== undefined) {
    const raw = Array.isArray(body.allowedEmailDomains)
      ? body.allowedEmailDomains.join(',')
      : body.allowedEmailDomains;
    updates.allowedEmailDomains = normalizeAllowedDomainsInput(raw);
  }

  // Gate gruppi M365. `groupGateEnabled` cambia lo scope OAuth registrato al
  // boot → richiede riavvio. I nomi gruppo sono letti al login (dinamici).
  if (typeof body.groupGateEnabled === 'boolean') updates.groupGateEnabled = body.groupGateEnabled;
  for (const k of ['groupStudenti', 'groupDocenti', 'groupAmministrazione', 'groupDirezione']) {
    if (typeof body[k] === 'string') updates[k] = body[k].trim() || null;
  }

  await settings.update(updates);
  // restartRequired: le modifiche a client ID / secret / callback / gate-enabled
  // richiedono il riavvio (strategie/scope passport registrati al boot). Whitelist
  // domini e nomi gruppo sono applicati dinamicamente nel verify (DB read per login).
  const DYNAMIC = new Set([
    'allowedEmailDomains',
    'groupStudenti',
    'groupDocenti',
    'groupAmministrazione',
    'groupDirezione',
  ]);
  const restartRequired = Object.keys(updates).some((k) => !DYNAMIC.has(k));
  res.json({ settings: toSafe(settings), restartRequired });
});

module.exports = router;
