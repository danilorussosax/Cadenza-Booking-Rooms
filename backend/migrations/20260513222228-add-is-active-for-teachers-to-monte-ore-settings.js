'use strict';

/**
 * Aggiunge `isActiveForTeachers` a `monte_ore_settings`: override esplicito
 * dell'admin sull'AA che i docenti vedono per l'inserimento del monte ore.
 *
 * Logica di risoluzione (vedi monteOreCalendarService.resolveTargetAcademicYearForTeacher):
 *   1. settings con isActiveForTeachers=true → quell'AA
 *   2. altrimenti: comportamento storico (finestra di submission aperta →
 *      AA prossimo; altrimenti AA corrente)
 *
 * Vincolo: al più UN settings con isActiveForTeachers=true per istituto.
 * Implementato con UNIQUE INDEX parziale su Postgres.
 *
 * Idempotente.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      const desc = await queryInterface.describeTable('monte_ore_settings');
      const dialect = queryInterface.sequelize.getDialect();

      if (!desc.isActiveForTeachers) {
        await queryInterface.addColumn(
          'monte_ore_settings',
          'isActiveForTeachers',
          {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          { transaction: t },
        );
      }

      const idxName = 'monte_ore_settings_active_for_teachers_uq';
      if (dialect === 'postgres') {
        // UNIQUE parziale: solo per le righe con flag=true.
        // queryInterface.addIndex non supporta WHERE, usiamo raw SQL.
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS "${idxName}"
           ON monte_ore_settings ("instituteId")
           WHERE "isActiveForTeachers" = TRUE`,
          { transaction: t },
        );
      } else if (dialect === 'sqlite') {
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${idxName}
           ON monte_ore_settings (instituteId)
           WHERE isActiveForTeachers = 1`,
          { transaction: t },
        );
      }
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.sequelize
        .query('DROP INDEX IF EXISTS "monte_ore_settings_active_for_teachers_uq"', {
          transaction: t,
        })
        .catch(() => {});
      await queryInterface
        .removeColumn('monte_ore_settings', 'isActiveForTeachers', { transaction: t })
        .catch(() => {});
    });
  },
};
