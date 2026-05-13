'use strict';

const { DataTypes } = require('sequelize');

/**
 * Monte Ore — richiesta di variazione del piano dopo l'approvazione.
 *
 * Logica di approvazione (richiesta dalla spec):
 *   - Se la modifica ricade in una giornata già APPROVATA nel piano
 *     originale (es. "lun 17 nov" che era già attivo): viene applicata
 *     subito e marcata `status='auto_approved'`.
 *   - Se la modifica interessa una NUOVA giornata lavorativa: lo stato è
 *     `pending` finché l'admin non clicca "Approva" o "Rifiuta".
 *
 * Limite annuale: il numero massimo di amendments è in
 * MonteOreSettings.maxAmendmentsPerYear; la POST controlla
 * proposal.amendmentCount < settings.maxAmendmentsPerYear.
 *
 * `payload` contiene il delta:
 *   { slotId, newDate?, newStartTime?, newEndTime?, isActive }
 * Quando approvato, il payload viene applicato allo `MonteOreSlot`
 * referenziato e (se la proposta è in stato 'generated') il Booking
 * collegato viene aggiornato/cancellato.
 */
module.exports = (sequelize) => {
  const MonteOreAmendment = sequelize.define(
    'MonteOreAmendment',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      proposalId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      requesterId: {
        // Tipicamente il docente proprietario della proposta, ma teoricamente
        // un admin potrebbe creare un amendment per conto del docente.
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      slotId: {
        // Slot bersaglio dell'amendment (NULL per amendment "additivi", es.
        // aggiunta di un giorno completamente nuovo che non esisteva).
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      kind: {
        // change_room: cambia l'aula di UN'occorrenza (slot) lasciando il
        //   pattern intatto. Sempre pending: l'aula è risorsa condivisa.
        // move_to: sposta una lezione da una cella attiva a una cella diversa
        //   (toggle off+on atomico, conta come 1 sola variazione di budget).
        type: DataTypes.ENUM(
          'toggle_off',
          'toggle_on',
          'change_time',
          'add_new_day',
          'change_room',
          'move_to',
        ),
        allowNull: false,
      },
      payload: {
        // Dettagli della modifica. Schema dipende da `kind`.
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: DataTypes.ENUM('pending', 'auto_approved', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      requestNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      decidedAt: { type: DataTypes.DATE, allowNull: true },
      decidedBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      tableName: 'monte_ore_amendments',
      paranoid: false,
      indexes: [{ fields: ['proposalId'] }, { fields: ['status'] }, { fields: ['requesterId'] }],
      validate: {
        // Schema del payload dipendente da `kind`. Senza questo, una richiesta
        // malformata viene accettata e crasha solo all'approvazione.
        payloadShape() {
          const p = this.payload || {};
          if (this.kind === 'add_new_day') {
            if (!p.date || !p.startTime || !p.endTime) {
              throw new Error("Payload 'add_new_day' richiede {date, startTime, endTime}");
            }
          } else if (this.kind === 'change_time') {
            if (!p.startTime && !p.endTime) {
              throw new Error("Payload 'change_time' richiede startTime o endTime");
            }
          } else if (this.kind === 'change_room') {
            if (!Number.isInteger(p.roomId) || p.roomId <= 0) {
              throw new Error("Payload 'change_room' richiede {roomId} intero positivo");
            }
          } else if (this.kind === 'move_to') {
            if (!Number.isInteger(p.targetSlotId) || p.targetSlotId <= 0) {
              throw new Error("Payload 'move_to' richiede {targetSlotId} intero positivo");
            }
          }
          // toggle_on/toggle_off: payload libero (debug only)
        },
      },
    },
  );

  return MonteOreAmendment;
};
