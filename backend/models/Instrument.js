'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Instrument = sequelize.define(
    'Instrument',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      family: {
        // Famiglia organologica
        type: DataTypes.ENUM(
          'archi',
          'fiati_legni',
          'fiati_ottoni',
          'tastiere',
          'percussioni',
          'corde',
          'voce',
          'elettronica',
          'altro',
        ),
        allowNull: false,
        defaultValue: 'altro',
      },
      brand: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      model: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      serialNumber: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      condition: {
        // Stato di conservazione (esclude la disponibilità: vedi isLoanable)
        type: DataTypes.ENUM('ottimo', 'buono', 'discreto', 'da_riparare', 'fuori_uso'),
        allowNull: false,
        defaultValue: 'buono',
      },
      isLoanable: {
        // Se false, lo strumento esiste a inventario ma non è prestabile.
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Lista di Course.id (codici SAD) abilitati a richiedere il prestito di
      // QUESTO strumento. Convenzione: array vuoto = tutti i ruoli/corsi non
      // admin possono richiederlo (comportamento permissivo di default,
      // coerente con Room.allowedCourseIds).
      allowedCourseIds: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      photoUrl: {
        // URL pubblico della foto (es. "/storage/instrument-12-…webp")
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: 'instruments',
      paranoid: true,
      indexes: [{ fields: ['name'] }, { fields: ['family'] }, { fields: ['isLoanable'] }],
    },
  );

  return Instrument;
};
