'use strict';

// =============================================================================
// Rate limit in-memory per (channel, externalId).
// Limiti: 30 msg/min, 200 msg/giorno, cooldown 1h dopo flood.
//
// Note: in-memory significa che con multi-istanza i contatori non sono
// condivisi. Per single-server è sufficiente. Migrazione futura: Redis.
// =============================================================================

const PER_MIN = Number(process.env.MESSAGING_RATE_PER_MIN) || 30;
const PER_DAY = Number(process.env.MESSAGING_RATE_PER_DAY) || 200;
const COOLDOWN_MS = Number(process.env.MESSAGING_COOLDOWN_MS) || 60 * 60 * 1000;

const store = new Map(); // key → { minWindowStart, minCount, dayWindowStart, dayCount, cooldownUntil }

function key(channel, externalId) {
  return `${channel}:${externalId}`;
}

/** Verifica e incrementa il contatore per (channel, externalId). Restituisce
 *  { ok: boolean, message?: string } — se ok=false il chiamante deve replicare
 *  il messaggio standard al posto di processare l'intent. */
function check(channel, externalId) {
  const k = key(channel, externalId);
  const now = Date.now();
  let s = store.get(k);
  if (!s) {
    s = { minWindowStart: now, minCount: 0, dayWindowStart: now, dayCount: 0, cooldownUntil: 0 };
    store.set(k, s);
  }

  if (s.cooldownUntil > now) {
    const minutesLeft = Math.ceil((s.cooldownUntil - now) / 60000);
    return {
      ok: false,
      message: `⛔ Hai inviato troppi messaggi. Riprova tra ${minutesLeft} minuti.`,
    };
  }
  // Reset finestra minuto
  if (now - s.minWindowStart >= 60_000) {
    s.minWindowStart = now;
    s.minCount = 0;
  }
  // Reset finestra giorno
  if (now - s.dayWindowStart >= 86_400_000) {
    s.dayWindowStart = now;
    s.dayCount = 0;
  }
  s.minCount += 1;
  s.dayCount += 1;
  if (s.minCount > PER_MIN || s.dayCount > PER_DAY) {
    s.cooldownUntil = now + COOLDOWN_MS;
    return {
      ok: false,
      message: `⛔ Limite messaggi superato. Riprova tra 1 ora.`,
    };
  }
  return { ok: true };
}

/** Reset esplicito (utile in test). */
function reset(channel, externalId) {
  if (channel && externalId) store.delete(key(channel, externalId));
  else store.clear();
}

module.exports = { check, reset, PER_MIN, PER_DAY, COOLDOWN_MS };
