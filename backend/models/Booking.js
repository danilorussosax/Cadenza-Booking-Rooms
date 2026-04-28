'use strict';

const crypto = require('crypto');
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Booking = sequelize.define(
    'Booking',
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
      purpose: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      type: {
        type: DataTypes.ENUM('studio_individuale', 'lezione', 'prova', 'concerto', 'altro'),
        defaultValue: 'studio_individuale',
      },
      status: {
        type: DataTypes.ENUM('confirmed', 'cancelled', 'completed', 'no_show', 'pending_approval'),
        defaultValue: 'confirmed',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelReason: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      reminderSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Sistema check-in / anti ghost-booking.
      // checkInToken: token opaco generato in beforeCreate; usato solo come
      //   identificatore stabile, NON è una chiave segreta (la sicurezza viene
      //   dall'autenticazione JWT sull'endpoint POST /:id/checkin).
      // checkedInAt: timestamp di conferma presenza; null finché non confermato.
      // autoCancelledAt: timestamp di auto-cancellazione da scheduler quando
      //   la grace period è scaduta senza check-in.
      checkInToken: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
      },
      checkedInAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      autoCancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'bookings',
      // Soft delete (paranoid): le prenotazioni cancellate via .destroy() vengono
      // marcate con deletedAt ma restano in DB (audit, riconciliazione iCal, ecc.).
      // Lo "status='cancelled'" rimane il flag funzionale primario per il
      // workflow utente; deletedAt è una protezione extra per i casi rari di
      // hard-destroy (es. cleanup admin).
      paranoid: true,
      indexes: [
        // Conflict detection: range query "stessa aula, intervallo sovrapposto, confirmed"
        { name: 'bookings_room_status_time', fields: ['roomId', 'status', 'startTime', 'endTime'] },
        // "Le mie prenotazioni attive" + ordinamento cronologico
        { name: 'bookings_user_status_end', fields: ['userId', 'status', 'endTime'] },
        // Range temporali su tutte le aule (vista calendario, statistiche)
        { name: 'bookings_status_start', fields: ['status', 'startTime'] },
        // Tick ghost-cancel: trova booking confermati con startTime nel passato
        // ancora senza checkedInAt e senza autoCancelledAt.
        { name: 'bookings_status_check', fields: ['status', 'checkedInAt', 'autoCancelledAt'] },
      ],
    },
  );

  // Genera un checkInToken al primo salvataggio se non già impostato.
  Booking.beforeCreate((booking) => {
    if (!booking.checkInToken) {
      booking.checkInToken = crypto.randomBytes(24).toString('hex');
    }
  });

  return Booking;
};
