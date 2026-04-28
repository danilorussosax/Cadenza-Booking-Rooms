'use strict';

const { DataTypes } = require('sequelize');

const ALL_LEVELS = ['propedeutico', 'triennio', 'biennio', 'master', 'altro'];

module.exports = (sequelize) => {
  const Course = sequelize.define(
    'Course',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(250),
        allowNull: false,
      },
      department: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      // Array di livelli: ['propedeutico','triennio','biennio','master','altro']
      // Salvato come TEXT JSON per compatibilità SQLite/MySQL/Postgres
      levels: {
        type: DataTypes.TEXT,
        defaultValue: JSON.stringify(['triennio', 'biennio']),
        get() {
          const raw = this.getDataValue('levels');
          if (!raw) return ['triennio', 'biennio'];
          if (Array.isArray(raw)) return raw;
          try {
            return JSON.parse(raw);
          } catch {
            return ['triennio', 'biennio'];
          }
        },
        set(val) {
          // I livelli ammessi sono ora gestiti dinamicamente dal catalogo CourseLevel.
          // Qui ripuliamo solo stringhe vuote/non-string mantenendo l'array così com'è.
          let arr;
          if (Array.isArray(val)) arr = val;
          else if (typeof val === 'string') {
            try {
              arr = JSON.parse(val);
            } catch {
              arr = [];
            }
          } else arr = [];
          const cleaned = arr
            .filter((l) => typeof l === 'string')
            .map((l) => l.trim())
            .filter(Boolean);
          this.setDataValue('levels', JSON.stringify(cleaned));
        },
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: 'courses',
      paranoid: true,
    },
  );

  Course.ALL_LEVELS = ALL_LEVELS;

  return Course;
};
