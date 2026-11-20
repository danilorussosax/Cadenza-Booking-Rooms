'use strict';

const logger = require('../../lib/logger');
const mailContext = require('../mailContext');

/**
 * Mail `password_reset` (sincrona via sendSecurityEmail).
 * Variabili: user.{firstName,lastName,email}, reset.{url,expiresAtLong}
 * + contesto comune (institute, now, baseUrl). La scadenza è in ora istituto.
 */
async function sendPasswordResetEmail(user, tokenPlain, expiresAt) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const r = await mailContext.renderAndQueue(
    'password_reset',
    {
      user: {
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email,
      },
      reset: {
        url: `${frontendUrl}/reset-password/${tokenPlain}`,
        expiresAtLong: mailContext.formatAt(expiresAt, 'DD/MM/YYYY HH:mm'),
      },
    },
    { to: user.email, deliver: 'security' },
  );
  if (r.code === 'TEMPLATE_MISSING') {
    logger.warn({ scope: 'auth.password_reset' }, 'password_reset template missing');
    return { ok: false, error: 'template missing' };
  }
  return r;
}

module.exports = { sendPasswordResetEmail };
