'use strict';

const { DataTypes } = require('sequelize');

/**
 * Catalogo "Dotazioni": elenco riusabile di nomi di attrezzature,
 * utilizzato per pre-compilare l'aggiunta di Equipment a una Room.
 */
module.exports = (sequelize) => {
  const EquipmentTemplate = sequelize.define(
    'EquipmentTemplate',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
        unique: true,
      },
      type: {
        // stesso enum di Equipment.type
        type: DataTypes.ENUM(
          'pianoforte',
          'pianoforte_a_coda',
          'organo',
          'clavicembalo',
          'leggio',
          'amplificatore',
          'mixer',
          'microfono',
          'computer',
          'proiettore',
          'lavagna',
          'sedia',
          'altro',
        ),
        defaultValue: 'altro',
      },
    },
    { tableName: 'equipment_templates' },
  );

  return EquipmentTemplate;
};
