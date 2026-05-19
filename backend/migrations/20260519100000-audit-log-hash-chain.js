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

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const desc = await queryInterface.describeTable('audit_log');
    if (!desc.rowHash) {
      await queryInterface.addColumn('audit_log', 'rowHash', {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
    }
    if (!desc.prevHash) {
      await queryInterface.addColumn('audit_log', 'prevHash', {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('audit_log', 'rowHash').catch(() => {});
    await queryInterface.removeColumn('audit_log', 'prevHash').catch(() => {});
  },
};
