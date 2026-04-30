'use strict';

/**
 * Lettura sicura dei secret di processo. In produzione la mancanza di
 * `JWT_SECRET` (o l'utilizzo del valore di default insicuro) causa il
 * fail-fast dell'app: meglio non partire che firmare token con un secret
 * pubblico.
 */

const INSECURE_DEFAULT = 'dev-secret-change-me';

function isProductionLike() {
  return process.env.NODE_ENV === 'production';
}

let cachedSecret = null;

function getJwtSecret() {
  if (cachedSecret) return cachedSecret;
  const v = process.env.JWT_SECRET;
  if (!v || v === INSECURE_DEFAULT) {
    if (isProductionLike()) {
      const reason = !v ? 'non impostato' : 'è il valore di default insicuro';
      throw new Error(
        `JWT_SECRET ${reason} in produzione. Imposta una stringa segreta forte (es. openssl rand -hex 64) nelle env del processo.`,
      );
    }
    // Dev/test: fallback ammesso ma logghiamo.
    if (process.env.NODE_ENV !== 'test' && !global.__jwtFallbackWarned) {
      console.warn('  ⚠ JWT_SECRET non impostato — uso fallback dev-only.');
      global.__jwtFallbackWarned = true;
    }
    cachedSecret = INSECURE_DEFAULT;
    return cachedSecret;
  }
  cachedSecret = v;
  return cachedSecret;
}

/**
 * Verifica all'avvio: se siamo in produzione e qualunque secret critico
 * manca, esce con codice 1. Da chiamare in server.js prima di buildApp().
 */
function assertProductionSecrets() {
  if (!isProductionLike()) return;
  try {
    getJwtSecret();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  getJwtSecret,
  assertProductionSecrets,
  INSECURE_DEFAULT,
};
