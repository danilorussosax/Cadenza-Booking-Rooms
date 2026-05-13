'use strict';

/**
 * Rate limiting per `/api/*`.
 *
 * Gerarchia (più stretto → più largo):
 *   - login   : 5 tentativi / 15 min  / IP
 *   - register: 3 tentativi / 30 min  / IP  (resistere a script di spam)
 *   - default : 60 req     / 1 min   / IP  (protezione baseline)
 *
 * Ogni handler ritorna 429 con body strutturato:
 *   { error, code: 'RATE_LIMITED', retryAfter: <seconds> }
 * + header `Retry-After: <seconds>` (RFC 6585).
 *
 * `trust proxy` viene impostato in server.js quando NODE_ENV=production
 * così req.ip risolve correttamente l'IP client dietro reverse proxy.
 */

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const logger = require('../lib/logger');

function buildHandler({ logHint }) {
  return (req, res, _next, options) => {
    const retryAfter = Math.ceil((options.windowMs ?? 60_000) / 1000);
    res.set('Retry-After', String(retryAfter));
    if (logger?.warn) {
      logger.warn({ ip: req.ip, path: req.originalUrl, hint: logHint }, 'rate limit exceeded');
    }
    res.status(429).json({
      error: 'Troppe richieste, riprova più tardi',
      code: 'RATE_LIMITED',
      retryAfter,
    });
  };
}

const baseOptions = {
  standardHeaders: 'draft-7', // RateLimit-* headers
  legacyHeaders: false, // niente X-RateLimit-*
};

// In ambiente test i rate limiter sono di default disattivati: cumulerebbero
// stato tra suite e farebbero fallire test "validi" con 429. I test che
// vogliono verificare il limiter possono settare DISABLE_RATE_LIMIT=false
// (oppure forzare process.env.NODE_ENV !== 'test').
function isDisabledInTest() {
  return process.env.NODE_ENV === 'test' && process.env.DISABLE_RATE_LIMIT !== 'false';
}

// Wrapper: ritorna il middleware dato, oppure un no-op se disabilitato.
function wrap(limiter) {
  return (req, res, next) => {
    if (isDisabledInTest()) return next();
    return limiter(req, res, next);
  };
}

const loginLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  handler: buildHandler({ logHint: 'auth_login' }),
});

const registerLimiter = rateLimit({
  ...baseOptions,
  windowMs: 30 * 60 * 1000,
  limit: 3,
  handler: buildHandler({ logHint: 'auth_register' }),
});

// Default per /api/*: 300 req/min/IP. Volutamente generoso perché l'app è
// usata in modo interattivo (griglia Monte Ore = molti click consecutivi che
// generano 3-4 fetch/click, cataloghi che invalidano molte query, ecc.).
// Il limite serve come barriera contro gli script abusivi, non per limitare
// l'uso normale da browser. Gli endpoint sensibili (login/register/gdpr)
// hanno limiter dedicati molto più stringenti.
const apiDefaultLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_API_PER_MIN) || 300,
  handler: buildHandler({ logHint: 'api_default' }),
});

// Endpoint GDPR (export, delete-request): 3 richieste / 24h / utente.
// Più restrittivo del default perché operazioni costose e potenzialmente
// sensibili. Chiave per userId quando autenticato, altrimenti per IP
// (usando ipKeyGenerator per gestire correttamente IPv6 — vedi
// ERR_ERL_KEY_GEN_IPV6 di express-rate-limit v8).
const gdprLimiter = rateLimit({
  ...baseOptions,
  windowMs: 24 * 60 * 60 * 1000,
  limit: 3,
  keyGenerator: (req, res) => (req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req, res)),
  handler: buildHandler({ logHint: 'gdpr' }),
});

// 2FA: protezione brute-force. `verify` più stretto (10 / 15min) di `resend`
// (5 / 15min) per evitare flood di email.
// Chiave: prova prima ad estrarre `userId` dal pre2faToken (verifica firma
// JWT, leggera) — un attaccante che ruota IP non aggira un limit per-utente.
// Fallback su IP se il token manca/è invalido (es. richieste preliminari).
function tfaKey(req, res) {
  const t = req.body?.tempToken;
  if (typeof t === 'string' && t.length > 0) {
    try {
      const { verifyPre2faToken } = require('../services/twoFa');
      const payload = verifyPre2faToken(t);
      return `tfa-u:${payload.id}`;
    } catch {
      /* token invalido / scaduto → fallback su IP */
    }
  }
  return ipKeyGenerator(req, res);
}

const tfaVerifyLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: tfaKey,
  handler: buildHandler({ logHint: 'auth_2fa_verify' }),
});

const tfaResendLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: tfaKey,
  handler: buildHandler({ logHint: 'auth_2fa_resend' }),
});

// iCal export per utente: 30 req/h sul token. Senza limite, una volta che il
// token leak-a, può essere brute-forzato per cercare altri token. 30/h è
// largo per un client calendar tipico (refresh ogni 1-6 ore).
const icalLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  handler: buildHandler({ logHint: 'ical' }),
});

// Prenotazioni ricorrenti: una singola chiamata genera fino a 52 booking
// con altrettante validate+insert. Senza limit dedicato un utente (o un
// attaccante con credenziali) può saturare il pool DB con poche chiamate.
// 5 chiamate/ora/utente: equivale a poter ri-pianificare 5 sessioni
// ricorrenti distinte all'ora — più che sufficiente per uso umano.
const recurringBookingLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req, res) => (req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req, res)),
  handler: buildHandler({ logHint: 'recurring_booking' }),
});

// Password reset (richiesta link via email): senza limit un attaccante
// può flooddare di email reset un utente bersaglio (denial-of-service
// emotivo o saturazione della reputation IP del nostro SMTP).
// 3 / 30min / IP. Per email-bersaglio specifico c'è un secondo gate
// nel handler della route (max 3 token attivi per utente / ora).
const passwordResetRequestLimiter = rateLimit({
  ...baseOptions,
  windowMs: 30 * 60 * 1000,
  limit: 3,
  handler: buildHandler({ logHint: 'auth_password_reset_request' }),
});

// Password reset (conferma con token): limit più alto perché la UX dell'utente
// può comportare retry rapidi (cambio idea password) e il token è già
// validato server-side, quindi non c'è rischio brute-force significativo.
const passwordResetConfirmLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  handler: buildHandler({ logHint: 'auth_password_reset_confirm' }),
});

module.exports = {
  loginLimiter: wrap(loginLimiter),
  registerLimiter: wrap(registerLimiter),
  apiDefaultLimiter: wrap(apiDefaultLimiter),
  gdprLimiter: wrap(gdprLimiter),
  tfaVerifyLimiter: wrap(tfaVerifyLimiter),
  tfaResendLimiter: wrap(tfaResendLimiter),
  icalLimiter: wrap(icalLimiter),
  recurringBookingLimiter: wrap(recurringBookingLimiter),
  passwordResetRequestLimiter: wrap(passwordResetRequestLimiter),
  passwordResetConfirmLimiter: wrap(passwordResetConfirmLimiter),
};
