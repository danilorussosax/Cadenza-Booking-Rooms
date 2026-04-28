'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Equipment = sequelize.define(
    'Equipment',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      roomId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      type: {
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
      brand: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      model: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      quantity: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },
      serialNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isWorking: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: 'equipment',
      paranoid: true,
    },
  );

  return Equipment;
};
