'use strict';

/**
 * BASELINE — punto zero del sistema sequelize-cli.
 *
 * Questa migration NON crea/modifica tabelle: lo schema corrente è già
 * stato sincronizzato da `sequelize.sync()` + `lib/preSyncMigrations.js`.
 *
 * Il suo unico scopo è:
 *   - registrare in `SequelizeMeta` un marker "0000-initial-baseline" così
 *     che le migration successive (0001-*, 0002-*, ...) sappiano da dove
 *     partire e `db:migrate:status` mostri uno stato pulito.
 *
 * Su DB esistenti (con dati pre-cli):
 *   - eseguire UNA VOLTA `npm run db:migrate:mark-baseline` (vedi
 *     scripts/db-mark-baseline.js) per inserire la riga in SequelizeMeta
 *     SENZA rieseguire `up()`, oppure eseguire `db:migrate` direttamente:
 *     `up()` qui è no-op idempotente, quindi è sicuro.
 *
 * Su DB nuovi (vergine):
 *   - sequelize.sync() resta responsabile della creazione iniziale durante
 *     il periodo di transizione. Quando si ripristineranno tutte le
 *     migration replay-able, questo file verrà espanso col CREATE TABLE
 *     completo.
 *
 * `down()` è no-op: la baseline non si "annulla".
 */

module.exports = {
  /** @param {import('sequelize').QueryInterface} _queryInterface */
  async up(_queryInterface, _Sequelize) {
    // No-op intenzionale. Lo schema è già presente.
    return Promise.resolve();
  },

  async down(_queryInterface, _Sequelize) {
    // No-op: la baseline non si rolla indietro.
    return Promise.resolve();
  },
};
