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
router.put('/', authenticate, requireRole('admin'), async (req, res) => {
  const settings = await getOrCreate();
  const body = req.body || {};

  const updates = {};
  if (typeof body.googleEnabled === 'boolean') updates.googleEnabled = body.googleEnabled;
  if (typeof body.googleClientId === 'string')
    updates.googleClientId = body.googleClientId.trim() || null;
  if (typeof body.googleCallbackUrl === 'string')
    updates.googleCallbackUrl = body.googleCallbackUrl.trim() || null;
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
  if (typeof body.microsoftCallbackUrl === 'string')
    updates.microsoftCallbackUrl = body.microsoftCallbackUrl.trim() || null;
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

  await settings.update(updates);
  // restartRequired: le modifiche a client ID / secret / callback richiedono
  // il riavvio (strategie passport registrate al boot). La whitelist domini è
  // applicata dinamicamente nel verify callback (DB read per login), quindi
  // ha effetto immediato.
  const restartRequired = Object.keys(updates).some((k) => k !== 'allowedEmailDomains');
  res.json({ settings: toSafe(settings), restartRequired });
});

module.exports = router;
