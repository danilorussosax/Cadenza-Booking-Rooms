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

let cachedSettingsSecret = null;

/**
 * Segreto per la cifratura delle credenziali (lib/crypto). In produzione DEVE
 * essere `SETTINGS_ENCRYPTION_KEY` dedicata: separa la chiave dei dati cifrati
 * (SMTP, bot token, OAuth secret, TOTP) da `JWT_SECRET`, così ruotare/compromettere
 * uno non tocca l'altro. In dev/test si ricade su JWT_SECRET (retrocompatibile).
 *
 * Il deploy genera e persiste `SETTINGS_ENCRYPTION_KEY` automaticamente e
 * migra i dati esistenti (scripts/ensure-encryption-key.sh + reencrypt-settings.js).
 */
function getSettingsEncryptionSecret() {
  if (cachedSettingsSecret) return cachedSettingsSecret;
  const v = process.env.SETTINGS_ENCRYPTION_KEY;
  if (v) {
    cachedSettingsSecret = v;
    return cachedSettingsSecret;
  }
  if (isProductionLike()) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY non impostato in produzione. Generane uno con ' +
        '`openssl rand -hex 64` e impostalo nelle env del backend (il deploy lo fa ' +
        'automaticamente e migra i dati con scripts/reencrypt-settings.js).',
    );
  }
  // Dev/test: fallback su JWT_SECRET come da comportamento storico.
  if (process.env.NODE_ENV !== 'test' && !global.__settingsKeyFallbackWarned) {
    console.warn(
      '  ⚠ SETTINGS_ENCRYPTION_KEY non impostato — uso JWT_SECRET come fallback (dev-only).',
    );
    global.__settingsKeyFallbackWarned = true;
  }
  cachedSettingsSecret = getJwtSecret();
  return cachedSettingsSecret;
}

/**
 * Verifica all'avvio: se siamo in produzione e qualunque secret critico
 * manca, esce con codice 1. Da chiamare in server.js prima di buildApp().
 */
function assertProductionSecrets() {
  if (!isProductionLike()) return;
  try {
    getJwtSecret();
    getSettingsEncryptionSecret();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  getJwtSecret,
  getSettingsEncryptionSecret,
  assertProductionSecrets,
  INSECURE_DEFAULT,
};
