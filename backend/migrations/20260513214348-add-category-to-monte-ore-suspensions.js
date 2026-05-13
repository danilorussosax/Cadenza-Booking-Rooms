'use strict';

/**
 * Aggiunge `category` a `monte_ore_suspensions` per distinguere il "perché"
 * di una sospensione, complementare a `kind` (che dice "come" è renderizzata
 * nella griglia: full_week vs partial).
 *
 * Valori:
 *   - 'holiday'        → festività deterministiche (Natale, Pasqua, 1 nov…)
 *                        generate dal bootstrap AA.
 *   - 'exam_session'   → finestre d'esame (estive/autunnali/invernali),
 *                        configurabili dall'admin per ciascun AA.
 *   - 'custom'         → tutto il resto (ponti ad hoc, chiusure straordinarie).
 *                        Default per le righe pre-esistenti.
 *
 * Idempotente: la migration verifica le colonne/indici prima di crearli per
 * tollerare DB già patchati da preSyncMigrations.js (nessuno al momento ma
 * convenzione del progetto).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      const desc = await queryInterface.describeTable('monte_ore_suspensions');
      const dialect = queryInterface.sequelize.getDialect();

      if (!desc.category) {
        if (dialect === 'sqlite') {
          // SQLite non ha ENUM: usiamo TEXT con default. Sequelize legge ENUM
          // come stringa quindi è retrocompatibile a livello applicativo.
          await queryInterface.sequelize.query(
            "ALTER TABLE monte_ore_suspensions ADD COLUMN category TEXT NOT NULL DEFAULT 'custom'",
            { transaction: t },
          );
        } else {
          await queryInterface.addColumn(
            'monte_ore_suspensions',
            'category',
            {
              type: Sequelize.ENUM('exam_session', 'holiday', 'custom'),
              allowNull: false,
              defaultValue: 'custom',
            },
            { transaction: t },
          );
        }
      }

      // addIndex su indice già esistente fa errore su Postgres: controlliamo.
      const indexes = await queryInterface.showIndex('monte_ore_suspensions', { transaction: t });
      const idxName = 'monte_ore_suspensions_inst_year_category';
      const hasIdx = indexes.some((i) => i.name === idxName);
      if (!hasIdx) {
        await queryInterface.addIndex(
          'monte_ore_suspensions',
          ['instituteId', 'academicYear', 'category'],
          { name: idxName, transaction: t },
        );
      }
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface
        .removeIndex('monte_ore_suspensions', 'monte_ore_suspensions_inst_year_category', {
          transaction: t,
        })
        .catch(() => {});
      await queryInterface
        .removeColumn('monte_ore_suspensions', 'category', { transaction: t })
        .catch(() => {});
      // Drop dell'ENUM type su Postgres (Sequelize non lo fa in automatico).
      const dialect = queryInterface.sequelize.getDialect();
      if (dialect === 'postgres') {
        await queryInterface.sequelize
          .query('DROP TYPE IF EXISTS "enum_monte_ore_suspensions_category"', { transaction: t })
          .catch(() => {});
      }
    });
  },
};
