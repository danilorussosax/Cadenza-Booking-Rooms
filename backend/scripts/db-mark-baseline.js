'use strict';

/**
 * One-shot helper: registra `0000-initial-baseline.js` come applicato in
 * SequelizeMeta SENZA rieseguirla. Usalo su DB già esistenti che vengono
 * portati al sistema sequelize-cli.
 *
 * Eseguibile via:
 *   node scripts/db-mark-baseline.js
 *
 * Idempotente: se la riga è già presente, non fa nulla.
 */

require('dotenv').config();
const { sequelize } = require('../models');

const BASELINE_NAME = '0000-initial-baseline.js';
const META_TABLE = 'SequelizeMeta';

async function ensureMetaTable() {
  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS "${META_TABLE}" ("name" VARCHAR(255) NOT NULL UNIQUE PRIMARY KEY)`,
    );
  } else if (dialect === 'postgres') {
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS "${META_TABLE}" ("name" VARCHAR(255) NOT NULL UNIQUE PRIMARY KEY)`,
    );
  } else {
    // mysql / mariadb
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS \`${META_TABLE}\` (\`name\` VARCHAR(255) NOT NULL UNIQUE PRIMARY KEY)`,
    );
  }
}

async function main() {
  await ensureMetaTable();

  const [existing] = await sequelize.query(`SELECT name FROM "${META_TABLE}" WHERE name = :name`, {
    replacements: { name: BASELINE_NAME },
  });
  if (existing.length > 0) {
    console.log(`✓ ${BASELINE_NAME} già registrata in ${META_TABLE} — niente da fare.`);
    return;
  }

  await sequelize.query(`INSERT INTO "${META_TABLE}" (name) VALUES (:name)`, {
    replacements: { name: BASELINE_NAME },
  });
  console.log(
    `✓ ${BASELINE_NAME} registrata come baseline. Le prossime migration partiranno da qui.`,
  );
}

main()
  .catch((err) => {
    console.error('✗ Errore:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await sequelize.close();
  });
