'use strict';

/**
 * Registry dei profili di sync esterno verso il modello User di Cadenza.
 *
 * Un "profilo" è una piccola configurazione che identifica una sorgente dati
 * (Isidata, ESSE3 CINECA, futuri provider) e specifica:
 *
 *   - `source` (string): valore persistito in `User.externalSource`.
 *   - `provider` (string): chiave logica usata in `IntegrationConfig.provider`
 *      e `IntegrationSyncRun.provider`. Tipicamente coincide con `source`.
 *   - `displayName` (string): etichetta human-readable per UI/log.
 *   - `matchBy` (string): strategia di matching primaria per diffEngine.
 *
 * NOTA — Tutti i profili condividono lo stesso parser (csvImporter) e mapping
 * (fieldMapping.DEFAULT_ALIASES), che è stato esteso con alias ESSE3-specifici.
 * Per aggiungere un nuovo provider basta registrarlo qui: niente nuove route
 * o nuovi handler, perché routes/integrations.js è source-parametrico.
 */

const PROFILES = {
  isidata: {
    source: 'isidata',
    provider: 'isidata',
    displayName: 'Isidata',
    matchBy: 'matricola',
  },
  esse3: {
    source: 'esse3',
    provider: 'esse3',
    displayName: 'ESSE3 (CINECA)',
    matchBy: 'matricola',
  },
};

function getProfile(source) {
  const key = String(source || '').toLowerCase();
  return PROFILES[key] || null;
}

function listProfiles() {
  return Object.values(PROFILES).map((p) => ({ ...p }));
}

module.exports = { PROFILES, getProfile, listProfiles };
