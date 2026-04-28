'use strict';

const { DataTypes } = require('sequelize');

/**
 * Coda d'attesa (waitlist) sulle prenotazioni.
 *
 * Quando un utente prova a prenotare un'aula in un orario già occupato
 * (BOOKING_CONFLICT), può iscriversi alla coda. Se la prenotazione esistente
 * viene cancellata (Booking.afterDestroy), il primo in coda con interval
 * sovrapposto riceve una notifica via email con un link "claim" che ha 30
 * minuti per essere usato. Allo scadere, lo scheduler promuove il successivo.
 *
 * Stato di una entry (derivato dai timestamp):
 *   - in coda      : notifiedAt = null
 *   - notificata   : notifiedAt ≠ null, claimedAt = null, cancelledAt = null
 *                    (l'utente ha 30 min per `POST /:id/claim`)
 *   - claimed      : claimedAt ≠ null (booking creato con successo)
 *   - cancellata   : cancelledAt ≠ null (utente ha rinunciato o expired)
 *
 * `position` è una colonna di sequenza per-room: 0 = primo in coda. Viene
 * mantenuta dai route handler (insert: max+1; rimozione: shift -1 sui
 * successivi). Non c'è UNIQUE su position perché la sovrapposizione
 * temporale fa sì che più entries con position diversa possano coesistere
 * nello stesso "slot".
 */
module.exports = (sequelize) => {
  const BookingWaitlist = sequelize.define(
    'BookingWaitlist',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      roomId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      startTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      endTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      /**
       * Posizione FIFO per-room: 0 = primo in coda. Mantenuta dagli handler
       * (insert/remove). Vedi commento al model per la semantica.
       */
      position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      /** Tipo prenotazione richiesta (replicato dall'attempt fallito) */
      type: {
        type: DataTypes.ENUM('studio_individuale', 'lezione', 'prova', 'concerto', 'altro'),
        defaultValue: 'studio_individuale',
      },
      /** Note opzionali (purpose) per facilitare il claim */
      purpose: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      /** Timestamp di notifica al primo in coda (null = ancora in coda). */
      notifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      /** Scadenza del claim: notifiedAt + 30 min. Lo scheduler agisce su expiresAt < now. */
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      /** Quando il claim è andato a buon fine e la booking è stata creata. */
      claimedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      /** Cancellazione utente o auto (expiresAt scaduto). */
      cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelReason: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: 'booking_waitlist',
      paranoid: true,
      indexes: [
        // Lookup principale: trova next-in-line per (room, slot)
        { fields: ['roomId', 'startTime', 'position'] },
        // Lookup user-side: "le mie code"
        { fields: ['userId', 'cancelledAt', 'claimedAt'] },
        // Tick scheduler: scadenze attive
        { fields: ['expiresAt', 'claimedAt', 'cancelledAt'] },
      ],
    },
  );

  return BookingWaitlist;
};
