'use strict';

/**
 * Cleanup one-time delle aule e degli edifici orfani.
 *
 * Contesto: i model Room/Building/Institute sono `paranoid: true`, ma il
 * soft-delete in Sequelize NON cascada ai figli. Prima di questa migration,
 * eliminare un Building (o un Institute) lasciava in piedi le righe Room
 * con `deletedAt IS NULL`. Risultato: query che NON joinano via Building
 * (es. `Room.count` in `/api/public/stats`) contavano aule "orfane" non
 * visibili dall'albero Structure → discrepanza nei KPI del kiosk Display
 * vs admin Structure (es. 44 vs 39).
 *
 * I delete handler in `routes/structure.js` sono stati corretti per
 * cascadere il soft-delete d'ora in avanti. Questa migration sistema le
 * orfane già presenti in DB.
 *
 * Idempotente: la WHERE seleziona solo righe ancora alive con parent
 * soft-deleted; un secondo run non altera nulla.
 *
 * `down` non è significativo (non sappiamo quali fossero alive prima del
 * cleanup): no-op intenzionale.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, _Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      // 1. Buildings orfani (Institute soft-deleted, Building ancora alive).
      //    Va prima dei rooms, così lo step 2 cattura anche le rooms i cui
      //    parent diventa soft-deleted ora.
      await queryInterface.sequelize.query(
        `UPDATE buildings
         SET deletedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
         WHERE deletedAt IS NULL
           AND instituteId IN (SELECT id FROM institutes WHERE deletedAt IS NOT NULL)`,
        { transaction: t },
      );

      // 2. Rooms orfane (Building soft-deleted, Room ancora alive).
      await queryInterface.sequelize.query(
        `UPDATE rooms
         SET deletedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
         WHERE deletedAt IS NULL
           AND buildingId IN (SELECT id FROM buildings WHERE deletedAt IS NOT NULL)`,
        { transaction: t },
      );
    });
  },

  async down(_queryInterface, _Sequelize) {
    // Data cleanup: rollback non significativo.
  },
};
