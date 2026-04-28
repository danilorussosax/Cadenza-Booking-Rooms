'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BookingRule = sequelize.define(
    'BookingRule',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      role: {
        type: DataTypes.ENUM('admin', 'docente', 'studente'),
        allowNull: false,
        unique: true,
      },
      // Numero massimo di prenotazioni attive simultaneamente per utente
      maxActiveBookings: {
        type: DataTypes.INTEGER,
        defaultValue: 5,
        validate: { min: 0 },
      },
      // Numero massimo di ore prenotabili in totale per settimana
      maxHoursPerWeek: {
        type: DataTypes.INTEGER,
        defaultValue: 10,
        validate: { min: 0 },
      },
      // Numero massimo di ore prenotabili in un singolo giorno
      maxHoursPerDay: {
        type: DataTypes.INTEGER,
        defaultValue: 4,
        validate: { min: 0 },
      },
      // Durata massima di una singola prenotazione (in minuti)
      maxBookingDurationMinutes: {
        type: DataTypes.INTEGER,
        defaultValue: 120,
        validate: { min: 15 },
      },
      // Durata minima di una singola prenotazione (in minuti)
      minBookingDurationMinutes: {
        type: DataTypes.INTEGER,
        defaultValue: 30,
        validate: { min: 15 },
      },
      // Numero massimo di giorni in anticipo con cui si può prenotare
      maxAdvanceDays: {
        type: DataTypes.INTEGER,
        defaultValue: 14,
        validate: { min: 0 },
      },
      // Numero minimo di ore in anticipo per prenotare (per evitare prenotazioni dell'ultimo minuto)
      minAdvanceHours: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: { min: 0 },
      },
      // Numero massimo di ore prima dell'inizio entro cui si può cancellare
      cancellationDeadlineHours: {
        type: DataTypes.INTEGER,
        defaultValue: 2,
        validate: { min: 0 },
      },
      // Permesso di prenotazioni ricorrenti
      allowRecurring: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      // Permesso di prenotare in fasce notturne
      allowNightHours: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      // Orari permessi (formato HH:mm)
      allowedStartTime: {
        type: DataTypes.STRING(5),
        defaultValue: '08:00',
      },
      allowedEndTime: {
        type: DataTypes.STRING(5),
        defaultValue: '22:00',
      },
    },
    {
      tableName: 'booking_rules',
    },
  );

  return BookingRule;
};
