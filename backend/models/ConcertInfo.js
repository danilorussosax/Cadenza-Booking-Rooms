'use strict';

const { DataTypes } = require('sequelize');

/**
 * Scheda informazioni di un concerto associata 1:1 a una Booking di tipo
 * 'concerto'. Una sola riga per booking — bookingId è UNIQUE.
 *
 * Campi:
 *   - title: titolo del concerto (es. "Concerto di primavera")
 *   - performers: testo libero — esecutori e strumenti, una per riga
 *   - program: testo libero — autori e brani in programma, uno per riga
 *   - posterUrl: URL pubblico della locandina caricata, oppure null per
 *     usare il fallback /assets/concerto.png blurato
 *
 * Le righe vengono cancellate in cascade dalla booking (vedi associations).
 */
module.exports = (sequelize) => {
  const ConcertInfo = sequelize.define(
    'ConcertInfo',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      bookingId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      performers: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      program: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      posterUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: 'concert_info',
      paranoid: true,
    },
  );

  return ConcertInfo;
};
