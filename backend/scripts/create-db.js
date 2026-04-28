'use strict';

/**
 * Crea il database Postgres dell'applicazione se non esiste.
 * Legge le credenziali dal `.env` e si connette al DB di sistema `postgres`
 * (l'utente DB_USER deve avere il privilegio CREATEDB).
 *
 * Idempotente: se il DB esiste già, esce con success.
 *
 * Uso: node scripts/create-db.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');

async function main() {
  const dbName = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT) || 5432;

  if (!dbName || !user) {
    console.error('  ✗ DB_NAME e DB_USER sono obbligatori nel .env');
    process.exit(1);
  }

  const client = new Client({ host, port, user, password, database: 'postgres' });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    const safeName = `"${dbName.replace(/"/g, '""')}"`;
    if (rows.length > 0) {
      // Verifica encoding: se non è UTF8 il seed con caratteri come "—" fallisce
      const enc = await client.query(
        'SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = $1',
        [dbName],
      );
      const current = enc.rows[0]?.encoding;
      if (current !== 'UTF8') {
        console.warn(
          `  ⚠ Database "${dbName}" esistente con encoding ${current}, ricreo come UTF8…`,
        );
        await client.query(`DROP DATABASE ${safeName}`);
      } else {
        console.log(`  ⓘ Database "${dbName}" già esistente (UTF8) — niente da fare`);
        return;
      }
    }
    // template0 è l'unico template che permette di forzare ENCODING/LOCALE
    // diversi da quelli del cluster (template1, di solito).
    await client.query(
      `CREATE DATABASE ${safeName} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
    );
    console.log(`  ✓ Database "${dbName}" creato (UTF8)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('  ✗ Errore creazione DB:', err.message);
  process.exit(1);
});
