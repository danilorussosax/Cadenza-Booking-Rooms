'use strict';

/**
 * Registry centralizzato dei "moduli funzionali" attivabili/disattivabili
 * dall'admin in `/admin/server-settings → Moduli`.
 *
 * Stato attuale del modello:
 *   I flag sono colonne BOOLEAN sull'`Institute` singleton (vedi
 *   models/Institute.js). Quando in futuro aggiungeremo molti moduli
 *   potremo migrare a una colonna JSON `Institute.moduleFlags`; per ora
 *   conservare le colonne dedicate è più semplice e già supportato.
 *
 * **Come aggiungere un nuovo modulo**:
 *   1. Aggiungere una colonna `module<Key>Enabled` (BOOLEAN, default true)
 *      a `models/Institute.js` + migration in `lib/preSyncMigrations.js`.
 *   2. Aggiungere un'entry qui.
 *   3. In `app.js` applicare `requireModuleEnabled('<key>')` come middleware
 *      davanti alle route protette.
 *   4. La UI admin `pages/admin/Modules.tsx` itera sul `GET /module-settings/registry`,
 *      quindi non serve toccare nient'altro frontend.
 */

const MODULE_REGISTRY = Object.freeze({
  monteOre: Object.freeze({
    key: 'monteOre',
    column: 'moduleMonteOreEnabled',
    label: 'Monte Ore docenti',
    description:
      'Voci di sidebar "Monte ore" (utente) e "Gestione Monte Ore" (admin). Quando il modulo è disattivato le rotte `/api/monte-ore/*` e `/api/admin/monte-ore/*` ritornano 404 con codice `MODULE_DISABLED`.',
    defaultEnabled: true,
    routes: ['/api/monte-ore', '/api/admin/monte-ore'],
  }),
  instrumentLoans: Object.freeze({
    key: 'instrumentLoans',
    column: 'moduleInstrumentLoansEnabled',
    label: 'Prestito strumenti',
    description:
      'Voci di sidebar "Strumenti", "I miei prestiti" e "Gestione strumenti". Quando il modulo è disattivato le rotte di inventario e prestiti ritornano 404 con codice `MODULE_DISABLED`.',
    defaultEnabled: true,
    routes: [
      '/api/instruments',
      '/api/loans',
      '/api/admin/instrument-loan-rules',
      '/api/admin/instrument-loan-quotas',
    ],
  }),
});

function listModules() {
  return Object.values(MODULE_REGISTRY);
}

function moduleColumn(key) {
  return MODULE_REGISTRY[key]?.column;
}

function isValidKey(key) {
  return Object.prototype.hasOwnProperty.call(MODULE_REGISTRY, key);
}

/**
 * Ritorna un payload pubblico (per UI) del registry: niente dettagli interni
 * tipo `routes` o `column` (che è un'implementation detail del DB).
 */
function publicRegistry() {
  return listModules().map((m) => ({
    key: m.key,
    column: m.column, // utile alla UI per matchare con i valori in /module-settings
    label: m.label,
    description: m.description,
    defaultEnabled: m.defaultEnabled,
  }));
}

module.exports = {
  MODULE_REGISTRY,
  listModules,
  moduleColumn,
  isValidKey,
  publicRegistry,
};
