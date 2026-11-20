'use strict';

/**
 * Sessione di login: lockout dell'account, avvio sessione (lastLogin + JWT +
 * needsProfile) ed esito discriminato del login con password.
 *
 * Interfaccia (le route restano adapter HTTP sottili):
 *   - checkLockout(email)                  → null | { outcome:'locked', retryAfterMinutes }
 *   - recordFailedAttempt(email)           → incrementa SOLO se l'email esiste con password locale
 *   - resolveLogin({ email, user, info })  → 'invalid' | 'needs2fa' | 'session'
 *   - startSession(user, { via, transaction })
 *
 * Lockout — difesa contro brute force distribuito (botnet su molti IP vs lo
 * stesso account, che il rate-limit per IP non ferma). Configurabile via env:
 *   LOCKOUT_MAX_FAILED   = 10  (tentativi consecutivi prima del lockout)
 *   LOCKOUT_DURATION_MIN = 30  (durata lockout in minuti)
 */

const { User } = require('../models');
const { signToken } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getConfig } = require('../lib/config');

const LOCKOUT_MAX_FAILED = getConfig().LOCKOUT_MAX_FAILED;
const LOCKOUT_DURATION_MIN = getConfig().LOCKOUT_DURATION_MIN;

/** Pre-check PRIMA di bcrypt: non sprecare hash su account lockati. */
async function checkLockout(email) {
  if (!email) return null;
  const candidate = await User.findOne({
    where: { email },
    attributes: ['id', 'lockedUntil', 'failedLoginAttempts'],
  });
  if (candidate?.lockedUntil && candidate.lockedUntil > new Date()) {
    return {
      outcome: 'locked',
      retryAfterMinutes: Math.ceil((candidate.lockedUntil - new Date()) / 60000),
    };
  }
  return null;
}

/**
 * Incrementa il contatore SOLO se l'email matcha un utente esistente con
 * password locale. Altrimenti chiunque potrebbe lockare arbitrariamente
 * conoscendo l'email e ripetendo password sbagliata.
 */
async function recordFailedAttempt(email) {
  if (!email) return { recorded: false };
  const target = await User.findOne({
    where: { email },
    attributes: ['id', 'passwordHash', 'failedLoginAttempts'],
  });
  if (!target?.passwordHash) return { recorded: false };
  const attempts = (target.failedLoginAttempts ?? 0) + 1;
  const update = { failedLoginAttempts: attempts };
  if (attempts >= LOCKOUT_MAX_FAILED) {
    update.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MIN * 60_000);
    logger.warn(
      { userId: target.id, attempts, lockedUntil: update.lockedUntil },
      'account locked: max failed login attempts reached',
    );
  }
  await User.update(update, { where: { id: target.id } });
  return { recorded: true, attempts, lockedUntil: update.lockedUntil ?? null };
}

async function clearFailedAttempts(user) {
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await User.update({ failedLoginAttempts: 0, lockedUntil: null }, { where: { id: user.id } });
  }
}

/** Profilo da completare: utente social 'pending', senza corso, o studente senza matricola. */
function needsProfile(user) {
  return (
    user.status === 'pending' || !user.courseId || (user.role === 'studente' && !user.matricola)
  );
}

/**
 * Avvia la sessione: aggiorna lastLogin, firma il JWT, calcola needsProfile.
 * `transaction` opzionale (la verifica 2FA opera dentro una transazione con lock).
 * `via` ('password' | '2fa' | 'google' | 'microsoft') serve solo a diagnostica.
 */
async function startSession(user, { via, transaction } = {}) {
  user.lastLogin = new Date();
  await user.save(transaction ? { transaction } : undefined);
  logger.debug({ userId: user.id, via }, 'session started');
  return { token: signToken(user), needsProfile: needsProfile(user) };
}

/**
 * Esito del login con password, dato il risultato di passport-local.
 * Ordine invariato: failure → (increment, solo email esistente) → invalid;
 * successo → azzera contatori → 2FA o sessione.
 */
async function resolveLogin({ email, user, info }) {
  if (!user) {
    await recordFailedAttempt(email);
    // PASSWORD_NOT_SET e OAUTH_ONLY sono propagati deliberatamente (CTA UX).
    if (info?.code === 'PASSWORD_NOT_SET' || info?.code === 'OAUTH_ONLY') {
      return {
        outcome: 'invalid',
        code: info.code,
        message: info.message || 'Email o password non validi',
      };
    }
    return {
      outcome: 'invalid',
      code: 'INVALID_CREDENTIALS',
      message: 'Email o password non validi',
    };
  }
  await clearFailedAttempts(user);
  if (user.twoFaEnabled) return { outcome: 'needs2fa', user };
  const session = await startSession(user, { via: 'password' });
  return { outcome: 'session', user, ...session };
}

module.exports = {
  LOCKOUT_MAX_FAILED,
  LOCKOUT_DURATION_MIN,
  checkLockout,
  recordFailedAttempt,
  clearFailedAttempts,
  needsProfile,
  startSession,
  resolveLogin,
};
