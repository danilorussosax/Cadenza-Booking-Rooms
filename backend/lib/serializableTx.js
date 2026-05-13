'use strict';

/**
 * Helper per le transazioni Postgres con isolation level SERIALIZABLE.
 *
 * Postgres rifiuta i commit di transazioni SERIALIZABLE che hanno race
 * con altre transazioni concorrenti, emettendo gli SQLSTATE:
 *   - 40001 — `serialization_failure` (read/write dependencies)
 *   - 40P01 — `deadlock_detected` (deadlock fra lock acquisiti)
 *
 * Su entrambi, lo standard SQL/Postgres docs raccomandano il **retry
 * applicativo**: la transazione non ha modificato nulla (rollback automatico)
 * e basta riprovare. Senza retry, l'utente vede un 500 randomico durante
 * spike di concorrenza (apertura iscrizioni masterclass, generazione
 * Monte Ore in massa, ecc.).
 *
 * Strategia:
 *   - Max 5 tentativi (configurabile)
 *   - Backoff esponenziale base 5ms + jitter random 0-15ms per evitare
 *     "thundering herd" dei retry
 *   - Su altri errori (non-40001/40P01), rethrow immediato senza retry
 *   - Su SQLite (test) il codice non interferisce: SQLite non emette 40001
 *
 * Uso (sostituisce `sequelize.transaction(opts, work)`):
 *
 *   const result = await withSerializableRetry(sequelize, opts, async (t) => {
 *     // ...lavoro transazionale...
 *   });
 */

const SQLSTATE_SERIALIZATION = '40001';
const SQLSTATE_DEADLOCK = '40P01';

function isRetryableError(err) {
  const code = err?.parent?.code ?? err?.original?.code ?? err?.cause?.code ?? null;
  return code === SQLSTATE_SERIALIZATION || code === SQLSTATE_DEADLOCK;
}

async function withSerializableRetry(sequelize, options, work, opts = {}) {
  // Tarato per spike di booking concorrenti: 10 retry con backoff
  // esponenziale cappato a 250ms = ~2 s di attesa totale worst-case.
  const { maxRetries = 10, baseDelayMs = 5, maxDelayMs = 250 } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await sequelize.transaction(options, work);
    } catch (err) {
      if (!isRetryableError(err)) throw err;
      if (attempt === maxRetries) {
        // Esauriti i tentativi: il livello di contention SERIALIZABLE è
        // talmente alto che convertiamo in 409 (semanticamente "conflict"):
        // l'utente vede un messaggio coerente con BOOKING_CONFLICT invece
        // di un 500 internal. Tracciato l'errore originale per log.
        const wrap = new Error(
          'Troppe richieste concorrenti su questa risorsa, riprova fra qualche istante',
        );
        wrap.status = 409;
        wrap.code = 'TOO_MUCH_CONTENTION';
        wrap.cause = err;
        throw wrap;
      }
      lastErr = err;
      // Backoff esponenziale + jitter (0..40 ms), cappato a maxDelayMs.
      const exp = baseDelayMs * Math.pow(2, attempt);
      const delay = Math.min(exp, maxDelayMs) + Math.random() * 40;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

module.exports = { withSerializableRetry, isRetryableError };
