'use strict';

const { DataTypes } = require('sequelize');

/**
 * Template di prenotazione "rapida" — l'utente salva una combinazione
 * (aula, giorno-della-settimana, orario, tipo, scopo) per riusarla con
 * un click dal Dashboard.
 *
 * Campi:
 *  - userId          owner; CASCADE delete
 *  - name            etichetta umana, UNIQUE per owner
 *  - roomId          aula di default
 *  - dayOfWeek       0=Sun … 6=Sat (convenzione Date.getDay() / dayjs.day())
 *  - startMinutes    minuti dalla mezzanotte (0..1439)
 *  - durationMinutes durata in minuti (>0)
 *  - type            tipo prenotazione (stesso enum di Booking.type)
 *  - purpose         scopo opzionale, copiato nel booking
 *  - isFavorite      mostrato nel "Quick book" del Dashboard (max 3 visibili)
 *
 * La validazione effettiva (regole ruolo, conflitti, quota, finestra
 * di prenotazione, ecc.) avviene quando il template viene "consumato"
 * tramite POST /:id/quick-book — riusa il `bookingValidator` standard.
 */
module.exports = (sequelize) => {
  return sequelize.define(
    'BookingTemplate',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      roomId: { type: DataTypes.INTEGER, allowNull: false },
      dayOfWeek: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 0, max: 6 },
      },
      startMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 0, max: 1439 },
      },
      durationMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 1440 },
      },
      type: {
        type: DataTypes.ENUM('studio_individuale', 'lezione', 'prova', 'concerto', 'altro'),
        defaultValue: 'studio_individuale',
      },
      purpose: { type: DataTypes.STRING(255), allowNull: true },
      isFavorite: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    {
      tableName: 'booking_templates',
      indexes: [
        // UNIQUE owner+nome → previene duplicati e conferisce semantica al campo
        { name: 'booking_templates_user_name_unique', unique: true, fields: ['userId', 'name'] },
        // List "quick book" del dashboard: filtra per user, ordine per favorite/aggiornamento
        { name: 'booking_templates_user_fav', fields: ['userId', 'isFavorite'] },
      ],
    },
  );
};
