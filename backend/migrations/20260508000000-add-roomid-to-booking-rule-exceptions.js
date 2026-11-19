'use strict';

/**
 * Aggiunge `roomId` a `booking_rule_exceptions` per consentire eccezioni
 * di scope "per singola aula". null (default) = vale per tutte le aule
 * (comportamento storico, retrocompatibile).
 *
 * Idempotente: se la colonna esiste già (scenario tipico su DB upgrade
 * dove `lib/preSyncMigrations.js` l'ha già creata in fase di startup),
 * la migration la rispetta e si limita a registrarsi nel SequelizeMeta
 * ledger.
 */

const { runPreSyncStep } = require('../lib/preSyncMigrations');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Colonna: stessa definizione delle pre-sync (una sola fonte). Gli indici
    // restano qui (le pre-sync non li gestiscono).
    await runPreSyncStep('booking_rule_exceptions.roomId');

    await queryInterface.sequelize.transaction(async (t) => {
      // addIndex è idempotente solo se controlliamo prima — addIndex su
      // indice esistente fallisce su Postgres ("relation already exists").
      const indexes = await queryInterface.showIndex('booking_rule_exceptions', { transaction: t });
      const hasRoomIdIdx = indexes.some((i) => i.name === 'booking_rule_exceptions_room_id');
      const hasCompositeIdx = indexes.some(
        (i) => i.name === 'booking_rule_exceptions_role_room_id_is_active',
      );

      if (!hasRoomIdIdx) {
        await queryInterface.addIndex('booking_rule_exceptions', ['roomId'], {
          name: 'booking_rule_exceptions_room_id',
          transaction: t,
        });
      }
      if (!hasCompositeIdx) {
        await queryInterface.addIndex('booking_rule_exceptions', ['role', 'roomId', 'isActive'], {
          name: 'booking_rule_exceptions_role_room_id_is_active',
          transaction: t,
        });
      }
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface
        .removeIndex('booking_rule_exceptions', 'booking_rule_exceptions_role_room_id_is_active', {
          transaction: t,
        })
        .catch(() => {});
      await queryInterface
        .removeIndex('booking_rule_exceptions', 'booking_rule_exceptions_room_id', {
          transaction: t,
        })
        .catch(() => {});
      await queryInterface.removeColumn('booking_rule_exceptions', 'roomId', { transaction: t });
    });
  },
};
