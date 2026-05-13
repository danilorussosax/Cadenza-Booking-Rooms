'use strict';

/**
 * Aggiunge a `monte_ore_proposals` i campi di tracciamento dell'origine
 * della proposta:
 *
 *   - `source`           → ENUM('user','admin_import'). Distingue le proposte
 *                          create dal docente da quelle importate dall'admin
 *                          via Excel (template "Monte Ore").
 *                          Default 'user' (retrocompatibile).
 *   - `importedAt`       → timestamp dell'import (NULL per le proposte normali).
 *   - `importedById`     → ID dell'admin che ha fatto l'import (riferimento
 *                          logico, niente FK constraint — stesso pattern di
 *                          User.contractType).
 *   - `importSourceRef`  → nome del file caricato (utile per audit/log).
 *
 * Idempotente: la migration verifica colonne/indici prima di crearli per
 * tollerare DB già patchati. Lo stile dell'up/down segue
 * `20260513214348-add-category-to-monte-ore-suspensions.js`.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      const desc = await queryInterface.describeTable('monte_ore_proposals');
      const dialect = queryInterface.sequelize.getDialect();

      if (!desc.source) {
        if (dialect === 'sqlite') {
          // SQLite non ha ENUM: TEXT con default. Sequelize legge ENUM come
          // stringa quindi a livello applicativo è retrocompatibile.
          await queryInterface.sequelize.query(
            "ALTER TABLE monte_ore_proposals ADD COLUMN source TEXT NOT NULL DEFAULT 'user'",
            { transaction: t },
          );
        } else {
          await queryInterface.addColumn(
            'monte_ore_proposals',
            'source',
            {
              type: Sequelize.ENUM('user', 'admin_import'),
              allowNull: false,
              defaultValue: 'user',
            },
            { transaction: t },
          );
        }
      }

      if (!desc.importedAt) {
        await queryInterface.addColumn(
          'monte_ore_proposals',
          'importedAt',
          { type: Sequelize.DATE, allowNull: true },
          { transaction: t },
        );
      }

      if (!desc.importedById) {
        await queryInterface.addColumn(
          'monte_ore_proposals',
          'importedById',
          { type: Sequelize.INTEGER, allowNull: true },
          { transaction: t },
        );
      }

      if (!desc.importSourceRef) {
        await queryInterface.addColumn(
          'monte_ore_proposals',
          'importSourceRef',
          { type: Sequelize.STRING(255), allowNull: true },
          { transaction: t },
        );
      }

      // Indice composto (source, status) per filtrare rapidamente le proposte
      // importate ancora in submitted dall'admin.
      const indexes = await queryInterface.showIndex('monte_ore_proposals', { transaction: t });
      const idxName = 'monte_ore_proposals_source_status';
      const hasIdx = indexes.some((i) => i.name === idxName);
      if (!hasIdx) {
        await queryInterface.addIndex('monte_ore_proposals', ['source', 'status'], {
          name: idxName,
          transaction: t,
        });
      }
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface
        .removeIndex('monte_ore_proposals', 'monte_ore_proposals_source_status', {
          transaction: t,
        })
        .catch(() => {});
      await queryInterface
        .removeColumn('monte_ore_proposals', 'importSourceRef', { transaction: t })
        .catch(() => {});
      await queryInterface
        .removeColumn('monte_ore_proposals', 'importedById', { transaction: t })
        .catch(() => {});
      await queryInterface
        .removeColumn('monte_ore_proposals', 'importedAt', { transaction: t })
        .catch(() => {});
      await queryInterface
        .removeColumn('monte_ore_proposals', 'source', { transaction: t })
        .catch(() => {});
      // Drop dell'ENUM type su Postgres (Sequelize non lo fa in automatico).
      const dialect = queryInterface.sequelize.getDialect();
      if (dialect === 'postgres') {
        await queryInterface.sequelize
          .query('DROP TYPE IF EXISTS "enum_monte_ore_proposals_source"', { transaction: t })
          .catch(() => {});
      }
    });
  },
};
