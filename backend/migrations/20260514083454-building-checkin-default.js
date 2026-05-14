'use strict';

/**
 * Toggle "check-in per edificio" (impostazione generale).
 *
 * Cambia il modello dati per supportare un default a livello Building con
 * possibilità di override per Room:
 *
 *   - Aggiunge `buildings.checkInDefault` (BOOLEAN NOT NULL DEFAULT false).
 *     Toggle generale: se true, tutte le aule dell'edificio richiedono il
 *     check-in QR, salvo override esplicito a livello Room.
 *
 *   - Rende `rooms.requireCheckIn` NULLABLE.
 *     Nuova semantica:
 *       - NULL       → eredita Building.checkInDefault
 *       - true/false → override esplicito
 *
 *   - Reset: forza tutti i rooms esistenti a requireCheckIn=NULL così che
 *     ereditino il nuovo default (false), come richiesto: stato iniziale =
 *     "tutte le aule senza check-in". L'admin riattiverà manualmente quanto
 *     desidera con i nuovi toggle per-edificio o per-aula.
 *
 * Idempotente: la migration verifica le colonne con describeTable prima di
 * crearle/modificarle. La logica di risoluzione effettiva vive in
 * backend/lib/checkInPolicy.js.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      // 1) buildings.checkInDefault
      const buildingsDesc = await queryInterface.describeTable('buildings');
      if (!buildingsDesc.checkInDefault) {
        await queryInterface.addColumn(
          'buildings',
          'checkInDefault',
          {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          { transaction: t },
        );
      }

      // 2) rooms.requireCheckIn → NULLABLE
      const roomsDesc = await queryInterface.describeTable('rooms');
      if (roomsDesc.requireCheckIn && roomsDesc.requireCheckIn.allowNull === false) {
        await queryInterface.changeColumn(
          'rooms',
          'requireCheckIn',
          {
            type: Sequelize.BOOLEAN,
            allowNull: true,
            defaultValue: null,
          },
          { transaction: t },
        );
      }

      // 3) Reset richiesto dall'utente: tutte le aule a NULL → ereditano il
      //    nuovo default Building.checkInDefault (false).
      await queryInterface.sequelize.query('UPDATE rooms SET "requireCheckIn" = NULL', {
        transaction: t,
      });
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      // 1) Eventuali NULL → true (default storico) per consentire NOT NULL.
      await queryInterface.sequelize.query(
        'UPDATE rooms SET "requireCheckIn" = true WHERE "requireCheckIn" IS NULL',
        { transaction: t },
      );

      // 2) Ripristina NOT NULL DEFAULT true.
      await queryInterface
        .changeColumn(
          'rooms',
          'requireCheckIn',
          {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          { transaction: t },
        )
        .catch(() => {});

      // 3) Drop colonna sul Building.
      await queryInterface
        .removeColumn('buildings', 'checkInDefault', { transaction: t })
        .catch(() => {});
    });
  },
};
