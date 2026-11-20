'use strict';

/**
 * Configurazione centralizzata letta da `process.env` UNA volta a startup.
 *
 * Vantaggi rispetto al pattern `Number(process.env.X) || default` sparso:
 *   - Documentazione esplicita di TUTTE le env attese in un solo file.
 *   - Fail-fast a startup se manca una env critica (vs errori runtime sparsi).
 *   - Coercizione tipo + validazione (es. range, enum) eseguita una volta.
 *   - Facile sostituire in test con env di simulazione (modulo cachato).
 *
 * Politica unica per le chiavi di tuning (numeriche/durata): variabile assente
 * o vuota → default; presente ma non valida (non numerica, fuori da min/max,
 * durata malformata) → ConfigError. Mai ripiego silenzioso.
 *
 * Restano FUORI da questo modulo: segreti/credenziali (JWT_SECRET letto via
 * lib/secrets.js, SMTP_*, OAuth *), infrastruttura DB/pool/SSL
 * (config/database.js) e variabili usate solo da scripts/test.
 *
 * Convenzione: tutte le env critiche restano accessibili anche via
 * `process.env.X` per backward-compat con codice legacy.
 */

/**
 * Helpers di parsing/coercizione. Throw `ConfigError` su valori invalidi
 * così l'errore fa exit(1) a startup invece di propagarsi a runtime.
 */
class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Massimo valore accettato da setTimeout/setInterval (int32).
const MAX_TIMER_MS = 2147483647;

function asString(name, def) {
  const v = process.env[name];
  if (v == null || v === '') {
    if (def === undefined) {
      throw new ConfigError(`${name} mancante (richiesto, nessun default)`);
    }
    return def;
  }
  return String(v);
}

function asInt(name, def, { min, max } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n)) {
    throw new ConfigError(`${name}="${raw}" non è un intero`);
  }
  if (min != null && n < min) {
    throw new ConfigError(`${name}=${n} < minimo ${min}`);
  }
  if (max != null && n > max) {
    throw new ConfigError(`${name}=${n} > massimo ${max}`);
  }
  return n;
}

// Durata stile `ms` (usata da jsonwebtoken): numero + unità opzionale.
const DURATION_RE =
  /^\d+(\.\d+)?\s*(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i;

function asDuration(name, def) {
  const v = process.env[name];
  if (v == null || v === '') return def;
  if (!DURATION_RE.test(v.trim())) {
    throw new ConfigError(`${name}="${v}" non è una durata valida (es. "2h", "30m", "1d")`);
  }
  return v;
}

function asEnum(name, allowed, def) {
  const v = process.env[name];
  if (v == null || v === '') return def;
  if (!allowed.includes(v)) {
    throw new ConfigError(`${name}="${v}" non valido. Ammessi: ${allowed.join(', ')}`);
  }
  return v;
}

function asBool(name, def) {
  const v = process.env[name];
  if (v == null || v === '') return def;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  throw new ConfigError(`${name}="${v}" deve essere 'true' o 'false'`);
}

/**
 * Rilegge process.env solo se uno dei valori osservati è cambiato dall'ultima
 * lettura (in produzione l'env è fisso: una sola lettura). `reloadConfig()`
 * forza la rilettura.
 */
function loadConfig() {
  const NODE_ENV = asEnum('NODE_ENV', ['development', 'test', 'production'], 'development');
  const isProd = NODE_ENV === 'production';
  const isTest = NODE_ENV === 'test';

  // Server
  const PORT = asInt('PORT', 3000, { min: 1, max: 65535 });
  const APP_URL = asString('APP_URL', `http://localhost:${PORT}`);
  const FRONTEND_URL = asString('FRONTEND_URL', APP_URL);

  // Sicurezza — i secrets sono validati anche da `lib/secrets.js` che è
  // l'unica sorgente per `getJwtSecret()`. Qui esponiamo solo per lookup.
  // In produzione li vogliamo sempre forniti esplicitamente; in dev/test
  // accettiamo i default insicuri ma con warning.
  const JWT_SECRET = isProd
    ? asString('JWT_SECRET') // throw se mancante in prod
    : asString('JWT_SECRET', 'cadenza-dev-jwt-secret-NOT-FOR-PROD');

  // JWT timing — formato durata stile jsonwebtoken/ms ("2h", "30m", "1d", "3600").
  const JWT_EXPIRES_IN = asDuration('JWT_EXPIRES_IN', '2h');

  // Database — DB_DIALECT decide quali altre env servono.
  const DB_DIALECT = asEnum('DB_DIALECT', ['sqlite', 'postgres'], 'sqlite');
  const DB_SYNC_MODE = asEnum('DB_SYNC_MODE', ['safe', 'alter', 'force', 'none'], 'safe');
  const DB_SEED = asBool('DB_SEED', !isProd);

  // 2FA
  const TWO_FA_GRACE_DAYS = asInt('TWO_FA_GRACE_DAYS', 7, { min: 0, max: 90 });
  const TWO_FA_TTL_MIN = asInt('TWO_FA_TTL_MIN', 10, { min: 1, max: 1440 });
  const TWO_FA_MAX_ATTEMPTS = asInt('TWO_FA_MAX_ATTEMPTS', 5, { min: 1, max: 100 });
  const TWO_FA_ISSUER = asString('TWO_FA_ISSUER', 'Cadenza');

  // Retention (GDPR / housekeeping)
  const GDPR_AUDIT_LOG_RETENTION_DAYS = asInt('GDPR_AUDIT_LOG_RETENTION_DAYS', 730, {
    min: 30,
    max: 3650,
  });
  const MAIL_OUTBOX_RETENTION_DAYS = asInt('MAIL_OUTBOX_RETENTION_DAYS', 30, {
    min: 1,
    max: 3650,
  });
  const PRE_RESTORE_RETENTION_DAYS = asInt('PRE_RESTORE_RETENTION_DAYS', 7, {
    min: 1,
    max: 3650,
  });

  // Check-in / ghost cancel — consumati SOLO tramite lib/checkInPolicy.
  const CHECKIN_EARLY_MINUTES = asInt('CHECKIN_EARLY_MINUTES', 5, { min: 0, max: 60 });
  const GHOST_GRACE_MINUTES = asInt('GHOST_GRACE_MINUTES', 15, { min: 1, max: 120 });

  // Rate limit (override)
  const RATE_LIMIT_API_PER_MIN = asInt('RATE_LIMIT_API_PER_MIN', 300, { min: 10, max: 10000 });

  // Bcrypt cost — accettiamo da 4 (test) a 15 (prod paranoid).
  const BCRYPT_COST = asInt('BCRYPT_COST', isTest ? 4 : 12, { min: 4, max: 15 });

  // Lockout account dopo login falliti
  const LOCKOUT_MAX_FAILED = asInt('LOCKOUT_MAX_FAILED', 10, { min: 1, max: 1000 });
  const LOCKOUT_DURATION_MIN = asInt('LOCKOUT_DURATION_MIN', 30, { min: 1, max: 10080 });

  // Lista d'attesa: finestra di conferma dopo l'offerta dello slot
  const WAITLIST_CLAIM_MINUTES = asInt('WAITLIST_CLAIM_MINUTES', 30, { min: 5, max: 1440 });

  // Messaging (bot/OTP): rate limit, sessione, scansione candidati
  const MESSAGING_RATE_PER_MIN = asInt('MESSAGING_RATE_PER_MIN', 30, { min: 1, max: 10000 });
  const MESSAGING_RATE_PER_DAY = asInt('MESSAGING_RATE_PER_DAY', 200, { min: 1, max: 1000000 });
  const MESSAGING_COOLDOWN_MS = asInt('MESSAGING_COOLDOWN_MS', 60 * 60 * 1000, {
    min: 1,
    max: MAX_TIMER_MS,
  });
  const MESSAGING_RATE_SWEEP_MS = asInt('MESSAGING_RATE_SWEEP_MS', 30 * 60 * 1000, {
    min: 1,
    max: MAX_TIMER_MS,
  });
  const MESSAGING_RATE_ENTRY_TTL_MS = asInt('MESSAGING_RATE_ENTRY_TTL_MS', 24 * 60 * 60 * 1000, {
    min: 1,
    max: MAX_TIMER_MS,
  });
  const MESSAGING_OTP_SCAN_CAP = asInt('MESSAGING_OTP_SCAN_CAP', 100, { min: 1, max: 10000 });
  const MESSAGING_SESSION_TTL_MIN = asInt('MESSAGING_SESSION_TTL_MIN', 15, { min: 1, max: 1440 });

  return Object.freeze({
    NODE_ENV,
    isProd,
    isTest,
    PORT,
    APP_URL,
    FRONTEND_URL,
    JWT_SECRET,
    JWT_EXPIRES_IN,
    DB_DIALECT,
    DB_SYNC_MODE,
    DB_SEED,
    TWO_FA_GRACE_DAYS,
    TWO_FA_TTL_MIN,
    TWO_FA_MAX_ATTEMPTS,
    TWO_FA_ISSUER,
    GDPR_AUDIT_LOG_RETENTION_DAYS,
    MAIL_OUTBOX_RETENTION_DAYS,
    PRE_RESTORE_RETENTION_DAYS,
    CHECKIN_EARLY_MINUTES,
    GHOST_GRACE_MINUTES,
    RATE_LIMIT_API_PER_MIN,
    BCRYPT_COST,
    LOCKOUT_MAX_FAILED,
    LOCKOUT_DURATION_MIN,
    WAITLIST_CLAIM_MINUTES,
    MESSAGING_RATE_PER_MIN,
    MESSAGING_RATE_PER_DAY,
    MESSAGING_COOLDOWN_MS,
    MESSAGING_RATE_SWEEP_MS,
    MESSAGING_RATE_ENTRY_TTL_MS,
    MESSAGING_OTP_SCAN_CAP,
    MESSAGING_SESSION_TTL_MIN,
  });
}

// Nomi delle env lette da loadConfig: la cache viene invalidata quando una di
// esse cambia, così la config riflette sempre l'env corrente (semantica lazy
// usata dai test che modificano process.env a runtime) senza rileggere tutto
// a ogni chiamata.
const ENV_NAMES = [
  'NODE_ENV',
  'PORT',
  'APP_URL',
  'FRONTEND_URL',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'DB_DIALECT',
  'DB_SYNC_MODE',
  'DB_SEED',
  'TWO_FA_GRACE_DAYS',
  'TWO_FA_TTL_MIN',
  'TWO_FA_MAX_ATTEMPTS',
  'TWO_FA_ISSUER',
  'GDPR_AUDIT_LOG_RETENTION_DAYS',
  'MAIL_OUTBOX_RETENTION_DAYS',
  'PRE_RESTORE_RETENTION_DAYS',
  'CHECKIN_EARLY_MINUTES',
  'GHOST_GRACE_MINUTES',
  'RATE_LIMIT_API_PER_MIN',
  'BCRYPT_COST',
  'LOCKOUT_MAX_FAILED',
  'LOCKOUT_DURATION_MIN',
  'WAITLIST_CLAIM_MINUTES',
  'MESSAGING_RATE_PER_MIN',
  'MESSAGING_RATE_PER_DAY',
  'MESSAGING_COOLDOWN_MS',
  'MESSAGING_RATE_SWEEP_MS',
  'MESSAGING_RATE_ENTRY_TTL_MS',
  'MESSAGING_OTP_SCAN_CAP',
  'MESSAGING_SESSION_TTL_MIN',
];

let _config = null;
let _signature = null;

function envSignature() {
  return ENV_NAMES.map((n) => process.env[n] ?? '\u0000').join('\u0001');
}

function getConfig() {
  const sig = envSignature();
  if (!_config || sig !== _signature) {
    _config = loadConfig();
    _signature = sig;
  }
  return _config;
}

/** Reload (solo per test): re-legge process.env e invalida la cache. */
function reloadConfig() {
  _config = null;
  return getConfig();
}

/**
 * Validazione esplicita a startup — esegue il loadConfig una volta e in
 * caso di errore termina con exit(1) + messaggio chiaro. Da chiamare in
 * server.js subito dopo dotenv.config() così il fail è immediato.
 */
function validateConfig() {
  try {
    return getConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n❌ Configurazione non valida: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

module.exports = {
  getConfig,
  reloadConfig,
  validateConfig,
  ConfigError,
};
