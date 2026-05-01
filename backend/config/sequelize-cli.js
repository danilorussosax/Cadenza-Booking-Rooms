'use strict';

/**
 * Configurazione DB per sequelize-cli (db:migrate, db:seed, db:migrate:undo).
 * Riusa le stesse env del runtime (config/database.js) per evitare drift.
 *
 * Uso:
 *   npx sequelize-cli db:migrate
 *   npx sequelize-cli db:migrate:status
 *   npx sequelize-cli db:migrate:undo
 *
 * Ambiente: rispetta NODE_ENV (development | test | production).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const dialect = process.env.DB_DIALECT || 'sqlite';

function commonOptions() {
  return {
    dialect,
    logging: process.env.DB_MIGRATION_LOG === 'true' ? console.log : false,
    define: { timestamps: true, underscored: false, freezeTableName: false },
    seederStorage: 'sequelize',
    seederStorageTableName: 'SequelizeData',
  };
}

function buildConfig() {
  if (dialect === 'sqlite') {
    const path = require('path');
    return {
      ...commonOptions(),
      storage:
        process.env.DB_STORAGE || path.resolve(__dirname, '..', 'data', 'conservatory.sqlite'),
    };
  }

  // postgres / mysql / mariadb
  return {
    ...commonOptions(),
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || (dialect === 'postgres' ? 5432 : 3306),
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    dialectOptions:
      dialect === 'postgres' && process.env.DB_SSL === 'true'
        ? {
            ssl: {
              require: true,
              rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
            },
          }
        : {},
  };
}

const cfg = buildConfig();
module.exports = {
  development: cfg,
  test: cfg,
  production: cfg,
};
