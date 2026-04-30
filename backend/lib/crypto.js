'use strict';

/**
 * Helper per cifrare/decifrare stringhe brevi (es. credenziali SMTP).
 * Algoritmo: AES-256-GCM. Chiave derivata via scrypt da
 * SETTINGS_ENCRYPTION_KEY (env) oppure JWT_SECRET come fallback.
 *
 * Output `encrypt`: base64 di [iv(16) | authTag(16) | ciphertext]
 */

const crypto = require('crypto');

const { getJwtSecret } = require('./secrets');

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  // Preferiamo SETTINGS_ENCRYPTION_KEY dedicata; fallback su JWT_SECRET via
  // helper, che fa fail-fast in produzione se non impostato.
  const secret = process.env.SETTINGS_ENCRYPTION_KEY || getJwtSecret();
  cachedKey = crypto.scryptSync(secret, 'aulabook-settings-salt-v1', 32);
  return cachedKey;
}

function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(b64) {
  if (!b64) return null;
  try {
    const data = Buffer.from(b64, 'base64');
    const iv = data.subarray(0, 16);
    const tag = data.subarray(16, 32);
    const ct = data.subarray(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt };
