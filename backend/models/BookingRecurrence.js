'use strict';

const { DataTypes } = require('sequelize');

/**
 * Regola di ricorrenza di un gruppo di prenotazioni (pattern MRBS-style).
 *
 * Strategia "eager + group": alla creazione della serie, il backend espande
 * la regola in N booking individuali e li lega tutti a questa riga via
 * `Booking.recurrenceId`. Vantaggi:
 *   - ogni occorrenza è una Booking normale: si modifica/cancella
 *     individualmente con le route esistenti
 *   - la detezione conflitti riusa l'index `bookings_room_status_time`
 *   - i query "Le mie prenotazioni" mostrano già tutte le occorrenze senza
 *     join virtuali
 *
 * Limiti pratici (vincoli runtime, non DB):
 *   - max 52 occorrenze per serie (1 anno di settimane)
 *   - max 1 anno di range tra startDate e endDate
 *
 * Schema:
 *   - frequency: 'daily' | 'weekly' (MVP). 'monthly'/'yearly' rinviati.
 *   - interval: ogni N giorni/settimane (default 1)
 *   - byWeekday: array di nomi inglesi (es. ['MO','WE','FR']) — usato solo
 *     con frequency='weekly'. Se vuoto/null per weekly, usa il weekday di
 *     startDate.
 *   - startDate: prima occorrenza (data senza ora)
 *   - endDate: ultima occorrenza possibile (data senza ora, inclusiva)
 *   - excludeDates: array di YYYY-MM-DD da skippare ("ogni lunedì tranne
 *     25/12 e 1/1")
 *
 * L'orario (ore/minuti) viene preso dal Booking template — i campi
 * startTime/endTime nella tabella bookings.
 */
module.exports = (sequelize) => {
  const BookingRecurrence = sequelize.define(
    'BookingRecurrence',
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
      frequency: {
        type: DataTypes.ENUM('daily', 'weekly'),
        allowNull: false,
      },
      interval: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: { min: 1, max: 12 },
      },
      // Array di codici weekday ISO: MO, TU, WE, TH, FR, SA, SU
      byWeekday: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: null,
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      // Date YYYY-MM-DD da escludere (es. festività)
      excludeDates: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
    },
    {
      tableName: 'booking_recurrences',
      timestamps: true,
      indexes: [{ fields: ['userId'] }, { fields: ['roomId'] }],
    },
  );

  return BookingRecurrence;
};
