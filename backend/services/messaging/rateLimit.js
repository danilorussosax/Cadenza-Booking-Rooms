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
// Sweep ogni 30 min delle entry obsolete: entry inattiva da >24h e senza
// cooldown attivo viene scartata. Per bot pubblici Telegram il numero di
// chat-id univoci che scrivono una volta tende a +∞ — senza purga la Map
// cresce all'infinito (memory leak).
const SWEEP_INTERVAL_MS = Number(process.env.MESSAGING_RATE_SWEEP_MS) || 30 * 60 * 1000;
const ENTRY_TTL_MS = Number(process.env.MESSAGING_RATE_ENTRY_TTL_MS) || 24 * 60 * 60 * 1000;

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

/** Purga le entry inattive: nessun messaggio nelle ultime ENTRY_TTL_MS e
 *  cooldown scaduto. Lasciamo intatte le entry con cooldown ancora attivo
 *  per non perdere la protezione anti-flood. */
function sweep() {
  const now = Date.now();
  let dropped = 0;
  for (const [k, s] of store.entries()) {
    const stale = now - s.dayWindowStart >= ENTRY_TTL_MS;
    const noCooldown = s.cooldownUntil <= now;
    if (stale && noCooldown) {
      store.delete(k);
      dropped += 1;
    }
  }
  return dropped;
}

// Avvia lo sweeper solo nel runtime (non in test, per evitare side effect su
// import + permettere ai test di pilotare manualmente con `sweep()`/`reset()`).
let sweepTimer = null;
if (process.env.NODE_ENV !== 'test') {
  sweepTimer = setInterval(() => {
    try {
      sweep();
    } catch (err) {
      console.error('[messaging:rateLimit] sweep error:', err.message);
    }
  }, SWEEP_INTERVAL_MS);
  // unref così il timer non tiene vivo il processo (utile per shutdown puliti)
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

/** Stop dello sweeper (utile per shutdown grazioso o teardown test). */
function stopSweeper() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

module.exports = {
  check,
  reset,
  sweep,
  stopSweeper,
  PER_MIN,
  PER_DAY,
  COOLDOWN_MS,
  ENTRY_TTL_MS,
  // Esposto per i test
  _store: store,
};
