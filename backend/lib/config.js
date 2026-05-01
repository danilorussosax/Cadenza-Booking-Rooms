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
 * NB: questo modulo NON sostituisce TUTTE le letture `process.env` esistenti
 * (sono ~30 sparse) — un big bang refactor è fuori scope. Centralizziamo solo
 * le configurazioni più critiche / a rischio config drift. Le env "tunable"
 * (es. RATE_LIMIT_*, TWO_FA_*, GHOST_GRACE_MINUTES) restano locali ai
 * loro modulo perché sono override di tuning, non config primarie.
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
 * Letta UNA volta al primo `require`. Se l'env cambia a runtime (es. test
 * che setta process.env) → re-require non rilegge (cache CommonJS).
 * Per i test usa `reloadConfig()` esposto sotto.
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
  const SESSION_SECRET = isProd
    ? asString('SESSION_SECRET')
    : asString('SESSION_SECRET', 'cadenza-dev-session-secret-NOT-FOR-PROD');

  // JWT timing
  const JWT_EXPIRES_IN = asString('JWT_EXPIRES_IN', '2h');

  // Database — DB_DIALECT decide quali altre env servono.
  const DB_DIALECT = asEnum('DB_DIALECT', ['sqlite', 'postgres', 'mysql', 'mariadb'], 'sqlite');
  const DB_SYNC_MODE = asEnum('DB_SYNC_MODE', ['safe', 'alter', 'force', 'none'], 'safe');
  const DB_SEED = asBool('DB_SEED', !isProd);

  // 2FA grace + retention — vincoli minimi per evitare misconfigurations.
  const TWO_FA_GRACE_DAYS = asInt('TWO_FA_GRACE_DAYS', 7, { min: 0, max: 90 });
  const GDPR_AUDIT_LOG_RETENTION_DAYS = asInt('GDPR_AUDIT_LOG_RETENTION_DAYS', 730, {
    min: 30,
    max: 3650,
  });

  // Check-in / ghost cancel
  const CHECKIN_EARLY_MINUTES = asInt('CHECKIN_EARLY_MINUTES', 5, { min: 0, max: 60 });
  const GHOST_GRACE_MINUTES = asInt('GHOST_GRACE_MINUTES', 15, { min: 1, max: 120 });

  // Rate limit (override)
  const RATE_LIMIT_API_PER_MIN = asInt('RATE_LIMIT_API_PER_MIN', 300, { min: 10, max: 10000 });

  // Bcrypt cost — accettiamo da 4 (test) a 15 (prod paranoid).
  const BCRYPT_COST = asInt('BCRYPT_COST', isTest ? 4 : 12, { min: 4, max: 15 });

  return Object.freeze({
    NODE_ENV,
    isProd,
    isTest,
    PORT,
    APP_URL,
    FRONTEND_URL,
    JWT_SECRET,
    SESSION_SECRET,
    JWT_EXPIRES_IN,
    DB_DIALECT,
    DB_SYNC_MODE,
    DB_SEED,
    TWO_FA_GRACE_DAYS,
    GDPR_AUDIT_LOG_RETENTION_DAYS,
    CHECKIN_EARLY_MINUTES,
    GHOST_GRACE_MINUTES,
    RATE_LIMIT_API_PER_MIN,
    BCRYPT_COST,
  });
}

let _config = null;

function getConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}

/** Reload (solo per test): re-legge process.env e invalida la cache. */
function reloadConfig() {
  _config = loadConfig();
  return _config;
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
      // eslint-disable-next-line no-console
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
