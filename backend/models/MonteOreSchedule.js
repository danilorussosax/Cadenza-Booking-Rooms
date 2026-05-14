'use strict';

const { DataTypes } = require('sequelize');

/**
 * Monte Ore — riga di pianificazione associata a una `MonteOreProposal`.
 *
 * Ogni riga rappresenta una "regola" del tipo:
 *   "ogni LUNEDÌ, in AULA 102, dalle 14:00 alle 16:00, dal 15/09/2025 al 30/06/2026,
 *    tipo: lezione, attività: 'Pianoforte 3°'".
 *
 * Quando il coordinatore clicca **Genera prenotazioni**, il sistema espande
 * la riga in N Booking confermati (uno per occorrenza valida nel range, al
 * netto di festività/eccezioni e conflitti). Gli ID dei Booking generati
 * vengono salvati in `generatedBookingIds` JSON per supportare l'undo
 * (cancellazione massiva e rigenerazione).
 *
 * Il docente compila queste righe in fase di proposta. Il coordinatore può
 * MODIFICARLE prima di approvare (es. spostare l'aula, ritoccare l'orario).
 */
module.exports = (sequelize) => {
  const MonteOreSchedule = sequelize.define(
    'MonteOreSchedule',
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
      roomId: {
        // Aula assegnata. NULL in stato 'draft' se il docente non ha ancora
        // espresso una preferenza (es. "una qualsiasi aula con pianoforte").
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      dayOfWeek: {
        // 0 = Domenica, 1 = Lunedì, …, 6 = Sabato (compatibile con Date.getDay()
        // di JavaScript e con EXTRACT(DOW) di Postgres).
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 0, max: 6 },
      },
      startTime: {
        // "HH:MM" 24h locale (es. "14:00"). Stessa convenzione del campo
        // BookingRule.allowedStartTime / BookingRuleException.startTime.
        type: DataTypes.STRING(5),
        allowNull: false,
      },
      endTime: {
        type: DataTypes.STRING(5),
        allowNull: false,
      },
      bookingType: {
        // Tipo Booking generato. Default 'lezione' (lezione frontale del docente).
        type: DataTypes.ENUM('studio_individuale', 'lezione', 'prova', 'concerto', 'altro'),
        allowNull: false,
        defaultValue: 'lezione',
      },
      purpose: {
        // Etichetta breve mostrata nei Booking generati (es. "Pianoforte 3°").
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      excludeDates: {
        // Array di date "YYYY-MM-DD" da escludere puntualmente (oltre alle
        // BookingRuleException). Permette al docente di "saltare" un giorno
        // specifico senza dover creare un'eccezione globale.
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      generatedBookingIds: {
        // ID dei Booking effettivamente creati al momento della generate.
        // Vuoto finché lo stato della proposta non è 'generated'.
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
    },
    {
      tableName: 'monte_ore_schedules',
      paranoid: false,
      indexes: [
        // Composito (proposalId, dayOfWeek): copre l'expander ricorrenza e
        // le query del calendario monte ore. dayOfWeek da solo era poco
        // selettivo (7 valori), inutile come index singolo.
        { fields: ['proposalId', 'dayOfWeek'], name: 'monte_ore_schedules_proposal_day_idx' },
        { fields: ['roomId'] },
      ],
    },
  );

  return MonteOreSchedule;
};
