'use strict';

/**
 * Cleanup + UNIQUE INDEX su `monte_ore_suspensions` per impedire duplicati
 * a livello DB.
 *
 * Bug pregresso: le POST /admin/monte-ore/suspensions e /exam-sessions
 * creavano la riga senza controllare duplicati → double click / retry HTTP
 * produceva 2+ righe identiche. Il bootstrap automatico è invece idempotente.
 *
 * Step:
 *   1. Cancella i duplicati esatti (instituteId, academicYear, name, dateFrom,
 *      dateTo) tenendo la riga con id più basso (la più vecchia, ipotesi: meglio
 *      mantenere quella che ha eventuali bookingRuleExceptionId linkati).
 *   2. Crea UNIQUE INDEX sui 5 campi normalizzati (name in lower-case).
 *
 * Idempotente: il delete usa NOT IN su min(id) → su DB pulito è no-op.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, _Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      const dialect = queryInterface.sequelize.getDialect();

      // 1) Cleanup duplicati: tieni la riga con id MIN per ogni gruppo
      //    (instituteId, academicYear, LOWER(TRIM(name)), dateFrom, dateTo).
      if (dialect === 'postgres') {
        await queryInterface.sequelize.query(
          `DELETE FROM monte_ore_suspensions a
           USING monte_ore_suspensions b
           WHERE a.id > b.id
             AND a."instituteId" = b."instituteId"
             AND a."academicYear" = b."academicYear"
             AND LOWER(TRIM(a.name)) = LOWER(TRIM(b.name))
             AND a."dateFrom" = b."dateFrom"
             AND a."dateTo" = b."dateTo"`,
          { transaction: t },
        );
      } else if (dialect === 'sqlite') {
        await queryInterface.sequelize.query(
          `DELETE FROM monte_ore_suspensions
           WHERE id NOT IN (
             SELECT MIN(id) FROM monte_ore_suspensions
             GROUP BY instituteId, academicYear, LOWER(TRIM(name)), dateFrom, dateTo
           )`,
          { transaction: t },
        );
      }

      // 2) UNIQUE INDEX
      const idxName = 'monte_ore_suspensions_uniq_key';
      if (dialect === 'postgres') {
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS "${idxName}"
           ON monte_ore_suspensions
              ("instituteId", "academicYear", LOWER(TRIM(name)), "dateFrom", "dateTo")`,
          { transaction: t },
        );
      } else if (dialect === 'sqlite') {
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${idxName}
           ON monte_ore_suspensions
              (instituteId, academicYear, LOWER(TRIM(name)), dateFrom, dateTo)`,
          { transaction: t },
        );
      }
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.sequelize
      .query('DROP INDEX IF EXISTS "monte_ore_suspensions_uniq_key"')
      .catch(() => {});
  },
};
