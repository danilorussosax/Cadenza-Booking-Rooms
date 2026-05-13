'use strict';

/**
 * Middleware `requireModuleEnabled(moduleKey)` — blocca le richieste alle
 * rotte di un modulo disattivato con **404 MODULE_DISABLED**.
 *
 * Perché 404 e non 403/451:
 *   - Dal punto di vista dell'utente, un modulo "spento" semplicemente
 *     non esiste (non è un'autorizzazione negata). 404 è semanticamente
 *     più aderente e riduce il rumore di info per chi prova a bypassare
 *     via bookmark/deep-link.
 *
 * Cache:
 *   Per evitare una SELECT su `institutes` ad ogni richiesta, mantieniamo
 *   in memoria gli ultimi flag letti (TTL 30s). La PUT `/module-settings`
 *   chiama `invalidateModuleCache()` per propagare le modifiche immediate.
 *   Su deploy multi-istanza il TTL garantisce comunque convergenza in 30s.
 */

const { moduleColumn, isValidKey } = require('../services/moduleFlags');

const CACHE_TTL_MS = 30 * 1000;
let cache = { ts: 0, flags: null };

async function loadFlags() {
  // Lazy require per evitare cicli con models/index.
  const { Institute } = require('../models');
  const inst = await Institute.findOne({
    attributes: ['moduleMonteOreEnabled', 'moduleInstrumentLoansEnabled'],
    order: [['id', 'ASC']],
  });
  // Se non c'è ancora un Institute (deploy fresco), tutti i moduli sono
  // considerati attivi (defaultEnabled in registry). Il primo seed/admin
  // creerà l'Institute e i defaults verranno persistiti.
  return {
    monteOre: !inst || !!inst.moduleMonteOreEnabled,
    instrumentLoans: !inst || !!inst.moduleInstrumentLoansEnabled,
  };
}

async function getFlags() {
  const now = Date.now();
  if (cache.flags && now - cache.ts < CACHE_TTL_MS) return cache.flags;
  const flags = await loadFlags();
  cache = { ts: now, flags };
  return flags;
}

function invalidateModuleCache() {
  cache = { ts: 0, flags: null };
}

function requireModuleEnabled(moduleKey) {
  if (!isValidKey(moduleKey)) {
    // Configurazione errata: fallback fail-closed
    throw new Error(`Module key sconosciuto: ${moduleKey}`);
  }
  // Doppio check: la colonna deve esistere. Non blocchiamo qui, solo log.
  if (!moduleColumn(moduleKey)) {
    throw new Error(`Module ${moduleKey}: colonna DB mancante nel registry`);
  }

  return async function moduleGuard(req, res, next) {
    try {
      const flags = await getFlags();
      if (!flags[moduleKey]) {
        return res.status(404).json({
          error: 'Modulo non attivo per questa installazione',
          code: 'MODULE_DISABLED',
          module: moduleKey,
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireModuleEnabled, invalidateModuleCache };
