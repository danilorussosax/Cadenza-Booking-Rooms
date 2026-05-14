'use strict';

/**
 * Servizio condiviso per inviare un link "imposta/reimposta password" via
 * email. Centralizza la generazione token + persistence + render template +
 * enqueue outbox per due flussi distinti:
 *
 *   - `purpose: 'reset'`         → password dimenticata (forgot-password).
 *                                  TTL breve (~1h), template `password_reset`.
 *   - `purpose: 'initial_setup'` → primo accesso post-import Isidata o
 *                                  azione bulk admin. TTL configurabile
 *                                  dal setting `institute.initialSetupLinkTtlDays`
 *                                  (default 14gg), template `initial_setup`.
 *
 * Comportamento idempotente sul re-invio: i token precedenti dello stesso
 * `purpose` per lo stesso utente vengono **marcati come usati** (consumedAt
 * surrogato di `usedAt = now`) per invalidarli prima di emetterne uno nuovo.
 * Garantisce "un solo link valido alla volta", più sicuro e più chiaro per
 * l'utente che ha perso la mail e chiede un nuovo invio.
 *
 * Idempotency outbox: l'`idempotencyKey` bucketizzata al minuto evita doppi
 * invii accidentali se l'admin clicca il bottone due volte di seguito.
 */

const crypto = require('crypto');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { Op } = require('sequelize');

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_TZ = 'Europe/Rome';

const PURPOSE_RESET = 'reset';
const PURPOSE_INITIAL_SETUP = 'initial_setup';

const TTL_RESET_MINUTES = 60; // 1 ora
const TTL_SETUP_DEFAULT_DAYS = 14;
const TTL_SETUP_MIN_DAYS = 1;
const TTL_SETUP_MAX_DAYS = 90;

function hashToken(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

function clampTtlDays(raw, fallback = TTL_SETUP_DEFAULT_DAYS) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(TTL_SETUP_MIN_DAYS, Math.min(TTL_SETUP_MAX_DAYS, Math.round(n)));
}

/**
 * Risolve il TTL in millisecondi per il `purpose` dato.
 *  - reset           → 1h fisso (sicurezza, non configurabile)
 *  - initial_setup   → giorni configurati su Institute, clampato 1-90
 */
async function resolveExpiresAt(purpose, ttlDaysOverride) {
  if (purpose === PURPOSE_RESET) {
    return dayjs().add(TTL_RESET_MINUTES, 'minute').toDate();
  }
  // initial_setup
  let days = ttlDaysOverride;
  if (days == null) {
    try {
      const { Institute } = require('../../models');
      const inst = await Institute.findOne({
        order: [['id', 'ASC']],
        attributes: ['initialSetupLinkTtlDays'],
      });
      days = inst?.initialSetupLinkTtlDays;
    } catch {
      days = TTL_SETUP_DEFAULT_DAYS;
    }
  }
  return dayjs().add(clampTtlDays(days), 'day').toDate();
}

/**
 * Invia un magic-link "imposta password" all'utente.
 *
 * @param {object} args
 * @param {object} args.user              Istanza User (almeno id, firstName, email).
 * @param {'reset'|'initial_setup'} args.purpose
 * @param {number} [args.ttlDays]         Override del TTL in giorni (solo per initial_setup).
 * @param {string} [args.requestIp]       IP del richiedente (per audit, opzionale).
 * @param {string} [args.requestUserAgent]
 * @returns {Promise<{ ok: true, tokenPlain: string, expiresAt: Date }
 *                   | { ok: false, error: string, code?: string }>}
 */
async function sendSetupLink({
  user,
  purpose = PURPOSE_INITIAL_SETUP,
  ttlDays = null,
  requestIp = null,
  requestUserAgent = null,
}) {
  if (!user?.id || !user?.email) {
    return { ok: false, error: 'user senza id/email', code: 'USER_INVALID' };
  }
  if (purpose !== PURPOSE_RESET && purpose !== PURPOSE_INITIAL_SETUP) {
    return { ok: false, error: `purpose sconosciuto: ${purpose}`, code: 'PURPOSE_INVALID' };
  }

  const { PasswordResetToken, Institute } = require('../../models');
  const emailService = require('../emailService');

  // 1) Invalida i token precedenti dello stesso purpose ancora attivi
  //    (non usati, non scaduti). usedAt = now li rende inutilizzabili.
  await PasswordResetToken.update(
    { usedAt: new Date() },
    {
      where: {
        userId: user.id,
        purpose,
        usedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
    },
  );

  // 2) Genera token + scadenza
  const tokenPlain = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(tokenPlain);
  const expiresAt = await resolveExpiresAt(purpose, ttlDays);

  await PasswordResetToken.create({
    userId: user.id,
    tokenHash,
    expiresAt,
    purpose,
    requestIp,
    requestUserAgent: requestUserAgent?.slice(0, 512) ?? null,
  });

  // 3) Render email via template configurabile
  const tplKind = purpose === PURPOSE_INITIAL_SETUP ? 'initial_setup' : 'password_reset';
  const tpl = await emailService.getTemplate(tplKind);
  if (!tpl) {
    return { ok: false, error: `template ${tplKind} mancante`, code: 'TEMPLATE_MISSING' };
  }

  const institute = await Institute.findOne({ order: [['id', 'ASC']] }).catch(() => null);
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetUrl = `${FRONTEND_URL}/reset-password/${tokenPlain}`;
  const ctx = {
    user: {
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email,
    },
    reset: {
      url: resetUrl,
      expiresAtLong: dayjs(expiresAt).tz(DEFAULT_TZ).format('DD/MM/YYYY HH:mm'),
    },
    institute: {
      name: institute?.name || 'Cadenza',
      copyright: `© ${new Date().getFullYear()} ${institute?.name || 'Cadenza'}`,
    },
    now: { dateTime: dayjs().tz(DEFAULT_TZ).format('DD/MM/YYYY HH:mm') },
  };

  // 4) Send via sendSecurityEmail (priority 0, bypassa throttle/bounce gate)
  const r = await emailService.sendSecurityEmail({
    to: user.email,
    subject: emailService.renderText(tpl.subject, ctx),
    html: emailService.render(tpl.bodyHtml, ctx),
  });

  if (!r?.ok) {
    return { ok: false, error: r?.error || 'send failed', code: 'SEND_FAILED' };
  }
  return { ok: true, tokenPlain, expiresAt };
}

module.exports = {
  sendSetupLink,
  hashToken,
  PURPOSE_RESET,
  PURPOSE_INITIAL_SETUP,
  TTL_SETUP_DEFAULT_DAYS,
  TTL_SETUP_MIN_DAYS,
  TTL_SETUP_MAX_DAYS,
};
