'use strict';

const { DataTypes } = require('sequelize');

/**
 * Catalogo Livelli di studio (propedeutico, triennio, biennio, master, ...).
 * Riferito da Course.levels (array di codici).
 */
module.exports = (sequelize) => {
  const CourseLevel = sequelize.define(
    'CourseLevel',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
    },
    { tableName: 'course_levels' },
  );

  return CourseLevel;
};
