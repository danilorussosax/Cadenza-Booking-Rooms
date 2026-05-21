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
      // Tipologia evento — rendering kiosk con chip colorato. NULL = comportamento
      // legacy (renderizzato come 'concerto'). Validazione lato app perché su
      // SQLite l'ENUM è un CHECK constraint solo, e vogliamo gestire i tipi
      // futuri senza migration.
      eventType: {
        type: DataTypes.STRING(40),
        allowNull: true,
        validate: {
          isIn: [['concerto', 'saggio', 'masterclass', 'conferenza', 'lezione_aperta']],
        },
      },
      // Sub-headline mostrata sotto al title sulla slide kiosk.
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      // Codice ISO 639-1 (it, en, fr, de, es, ...) per masterclass/conferenze
      // straniere. Renderizzato come bandierina nella riga della data.
      language: {
        type: DataTypes.STRING(2),
        allowNull: true,
        validate: { is: /^[a-z]{2}$/ },
      },
    },
    {
      tableName: 'concert_info',
      paranoid: true,
    },
  );

  return ConcertInfo;
};
