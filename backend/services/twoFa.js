'use strict';

// =============================================================================
// 2FA via codice EMAIL (one-time-password monouso).
//
// Modello:
//   - L'utente attiva il 2FA dal profilo. Il backend genera un codice di 6
//     cifre, ne salva il bcrypt hash in `User.twoFaChallenge` con scadenza,
//     e invia il codice via email all'indirizzo dell'utente.
//   - L'utente inserisce il codice nella UI → backend verifica → in caso di
//     enrollment: marca `twoFaEnabled=true` e genera 10 recovery codes
//     (single-use). In caso di login step 2: emette il JWT di sessione.
//   - Per il login con 2FA attivo: alla POST /login il backend genera la
//     challenge e manda l'email automaticamente, ritornando { needsTwoFa,
//     tempToken, sentTo } al client.
//
// Sicurezza:
//   - Codice 6 cifre, generato con `crypto.randomInt`. Spazio 1M → con max 5
//     tentativi e scadenza 10 min, probabilità di guess casuale 5/1e6.
//   - Hash bcrypt cost 8 (compromesso latenza/sicurezza per codice corto).
//   - Single-shot: una sola challenge per utente in DB (sovrascritta a ogni
//     re-emissione). Verifica ok → challenge cancellata.
//   - Cap tentativi: TWO_FA_MAX_ATTEMPTS (default 5). Superato → challenge
//     scartata, l'utente deve richiedere un nuovo codice.
//   - Scadenza: TWO_FA_TTL_MIN (default 10 min).
//
// Recovery codes:
//   - 10 codici random (80 bit), formato `XXXX-XXXX-XXXX-XXXX`.
//   - Salvati come array di hash bcrypt cost 4. Single-use.
// =============================================================================

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../lib/secrets');

const PRE2FA_TTL = '5m';
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 10; // ~80 bit
const TWO_FA_TTL_MIN = Number(process.env.TWO_FA_TTL_MIN) || 10;
const TWO_FA_MAX_ATTEMPTS = Number(process.env.TWO_FA_MAX_ATTEMPTS) || 5;
const CODE_BCRYPT_COST = 8;

/** Genera un codice OTP di 6 cifre (zero-padded). */
function generateCode() {
  // randomInt esclusivo sul max → range [0, 1_000_000) → 6 cifre.
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, '0');
}

/** Crea una nuova challenge (codice in chiaro + record da salvare in DB). */
async function createChallenge(purpose = 'enroll') {
  const code = generateCode();
  const hash = await bcrypt.hash(code, CODE_BCRYPT_COST);
  const expiresAt = new Date(Date.now() + TWO_FA_TTL_MIN * 60_000).toISOString();
  return {
    code,
    record: { hash, expiresAt, attempts: 0, purpose },
  };
}

/** Verifica un codice contro la challenge salvata. Side-effects:
 *   - incrementa `attempts` se sbagliato e siamo entro il cap
 *   - restituisce { ok, reason, updated } dove updated è il nuovo record
 *     (o null se la challenge va invalidata). Il chiamante salva user.twoFaChallenge
 *     con il valore di `updated` (può essere null per scartare).
 */
async function consumeChallenge(stored, code) {
  if (!stored || typeof stored !== 'object') {
    return { ok: false, reason: 'NO_CHALLENGE', updated: null };
  }
  const expiresAt = stored.expiresAt ? new Date(stored.expiresAt).getTime() : 0;
  if (Date.now() > expiresAt) {
    return { ok: false, reason: 'EXPIRED', updated: null };
  }
  if ((stored.attempts ?? 0) >= TWO_FA_MAX_ATTEMPTS) {
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS', updated: null };
  }
  const clean = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) {
    return {
      ok: false,
      reason: 'INVALID_FORMAT',
      updated: { ...stored, attempts: (stored.attempts ?? 0) + 1 },
    };
  }
  const ok = await bcrypt.compare(clean, stored.hash);
  if (!ok) {
    const attempts = (stored.attempts ?? 0) + 1;
    if (attempts >= TWO_FA_MAX_ATTEMPTS) {
      return { ok: false, reason: 'TOO_MANY_ATTEMPTS', updated: null };
    }
    return { ok: false, reason: 'BAD_CODE', updated: { ...stored, attempts } };
  }
  // Successo → challenge consumata.
  return { ok: true, reason: 'OK', updated: null };
}

/** Genera N recovery codes "user-friendly" (4 gruppi da 4 hex maiuscoli). */
function generateRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    const raw = crypto.randomBytes(RECOVERY_CODE_BYTES).toString('hex').toUpperCase();
    const grouped = raw.match(/.{1,4}/g).join('-');
    codes.push(grouped);
  }
  return codes;
}

async function hashRecoveryCodes(codes) {
  return Promise.all(codes.map((c) => bcrypt.hash(c, 4)));
}

async function findRecoveryMatch(plain, hashList) {
  const clean = String(plain ?? '')
    .trim()
    .toUpperCase();
  if (!clean) return -1;
  for (let i = 0; i < hashList.length; i += 1) {
    const ok = await bcrypt.compare(clean, hashList[i]);
    if (ok) return i;
  }
  return -1;
}

/** Maschera un'email per la UI: `mar*****@example.it`. Conserva i primi 3
 *  caratteri della parte locale e tutto il dominio. */
function maskEmail(email) {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  const visible = local.slice(0, Math.min(3, Math.max(1, local.length - 1)));
  const masked = '*'.repeat(Math.max(1, local.length - visible.length));
  return `${visible}${masked}@${domain}`;
}

/** JWT temporaneo "pre2fa" (TTL 5min, claim `tfa: 'pre'`). */
function signPre2faToken(userId) {
  return jwt.sign({ id: userId, tfa: 'pre' }, getJwtSecret(), { expiresIn: PRE2FA_TTL });
}

function verifyPre2faToken(token) {
  const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  if (payload.tfa !== 'pre') {
    const err = new Error('Token pre2FA non valido');
    err.code = 'TWO_FA_BAD_TEMP_TOKEN';
    throw err;
  }
  return payload;
}

module.exports = {
  generateCode,
  createChallenge,
  consumeChallenge,
  generateRecoveryCodes,
  hashRecoveryCodes,
  findRecoveryMatch,
  maskEmail,
  signPre2faToken,
  verifyPre2faToken,
  RECOVERY_CODE_COUNT,
  TWO_FA_TTL_MIN,
  TWO_FA_MAX_ATTEMPTS,
};
