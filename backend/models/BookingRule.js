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
      // Intervallo minimo (in minuti) tra una prenotazione e la successiva
      // dello stesso utente. Serve a evitare che il cap "max ore al giorno"
      // venga aggirato concatenando più prenotazioni di durata massima:
      // es. cap 4h/giorno con maxBookingDurationMinutes=120 — senza questo
      // vincolo lo studente prenoterebbe 14:00–16:00 + 16:00–18:00. Con un
      // cooldown di 60 min, deve aspettare almeno fino alle 17:00.
      // Calcolo cross-day sui minuti astronomici tra fine e inizio.
      // 0 = nessun cooldown (default, backward compatible).
      minIntervalBetweenBookingsMinutes: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
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
