'use strict';

/**
 * Aggiunge la hash-chain di integrità su `audit_log`.
 *
 * Modello: ogni riga ha un `rowHash` = SHA-256 del payload canonical + il
 * `prevHash` (rowHash della riga precedente, NULL per la prima). Una
 * manipolazione della tabella (UPDATE o DELETE di una riga) invalida la
 * catena dalla riga modificata in poi → rilevabile da
 * `/api/admin/audit-log/verify-integrity`.
 *
 * Le colonne sono nullable per non rompere il backfill: le righe pre-esistenti
 * restano senza hash (visualizzate come "legacy" nella verifica).
 *
 * Idempotente.
 */

const { runPreSyncStep } = require('../lib/preSyncMigrations');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // Stessa definizione delle pre-sync (una sola fonte).
  async up() {
    await runPreSyncStep('audit_log.rowHash');
    await runPreSyncStep('audit_log.prevHash');
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('audit_log', 'rowHash').catch(() => {});
    await queryInterface.removeColumn('audit_log', 'prevHash').catch(() => {});
  },
};
