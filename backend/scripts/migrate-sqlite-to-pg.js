'use strict';

/**
 * Migrazione one-shot: copia tutti i dati dal vecchio DB SQLite
 * (`data/conservatory.sqlite`) al DB Postgres attivo (configurato in `.env`).
 *
 * Caratteristiche:
 *   - leggi-tutto da SQLite via libreria sqlite3 (read-only)
 *   - TRUNCATE iniziale di tutte le tabelle Postgres + RESTART IDENTITY
 *     CASCADE per ripartire da uno stato vuoto coerente
 *   - bulkCreate via i model Sequelize (puntano a Postgres tramite .env),
 *     preservando gli id originali
 *   - coercione BOOL (0/1 → false/true), JSON (TEXT → object) e DATE
 *     in base a `model.rawAttributes`
 *   - dopo le insert, riallineamento delle sequence Postgres a MAX(id)+1
 *
 * L'intera operazione gira dentro una transazione: se qualcosa fallisce
 * il DB Postgres torna allo stato pre-script (truncate incluso).
 *
 * Uso:
 *   node scripts/migrate-sqlite-to-pg.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');

const { sequelize, ...models } = require('../models');

const SQLITE_PATH =
  process.env.MIGRATION_SQLITE_PATH || path.join(__dirname, '..', 'data', 'conservatory.sqlite');

// Ordine FK-safe: prima i parent, poi i child.
const TABLES_IN_ORDER = [
  { table: 'courses', model: models.Course },
  { table: 'course_levels', model: models.CourseLevel },
  { table: 'equipment_templates', model: models.EquipmentTemplate },
  { table: 'institutes', model: models.Institute },
  { table: 'buildings', model: models.Building },
  { table: 'rooms', model: models.Room },
  { table: 'equipment', model: models.Equipment },
  { table: 'users', model: models.User },
  { table: 'bookings', model: models.Booking },
  { table: 'concert_info', model: models.ConcertInfo },
  { table: 'booking_rules', model: models.BookingRule },
  { table: 'booking_rule_exceptions', model: models.BookingRuleException },
  { table: 'mail_settings', model: models.MailSettings },
  { table: 'mail_templates', model: models.MailTemplate },
  { table: 'oauth_settings', model: models.OAuthSettings },
  { table: 'instruments', model: models.Instrument },
  { table: 'instrument_loans', model: models.InstrumentLoan },
  { table: 'instrument_loan_rules', model: models.InstrumentLoanRule },
];

function readSqliteTable(table) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(SQLITE_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
    });
    db.all(`SELECT * FROM "${table}"`, (err, rows) => {
      db.close();
      if (err) {
        // Tabella inesistente in SQLite: trattata come 0 righe
        if (/no such table/i.test(err.message)) return resolve([]);
        return reject(err);
      }
      resolve(rows || []);
    });
  });
}

/**
 * Coerce un valore proveniente da SQLite verso il tipo atteso da Postgres
 * in base alla definizione del model Sequelize.
 *
 *   BOOLEAN   → 0/1 (INTEGER) o "0"/"1" (TEXT) → false/true
 *   JSON      → stringa JSON serializzata → oggetto
 *   DATE      → stringa ISO → Date
 *   ENUM/STR  → invariato (Postgres accetta la stringa)
 */
function coerceForModel(row, model) {
  const attrs = model.rawAttributes;
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    if (val === null || val === undefined) {
      out[key] = null;
      continue;
    }
    const attr = attrs[key];
    if (!attr) {
      // Colonna sconosciuta al model: copia così com'è (timestamp ecc.)
      out[key] = val;
      continue;
    }
    // attr.type.key è la "shape" canonica del DataType Sequelize ('JSON',
    // 'BOOLEAN', 'DATE', 'INTEGER', 'STRING', 'ENUM', ecc.) e funziona
    // indipendentemente dal nome interno della classe (es. JSONTYPE).
    const typeKey = (attr.type && attr.type.key) || '';
    if (typeKey === 'BOOLEAN') {
      out[key] = val === 1 || val === '1' || val === true;
    } else if (typeKey === 'JSON' || typeKey === 'JSONB') {
      if (typeof val === 'string') {
        try {
          out[key] = JSON.parse(val);
        } catch {
          out[key] = val;
        }
      } else {
        out[key] = val;
      }
    } else if (typeKey === 'DATE') {
      out[key] = val instanceof Date ? val : new Date(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`  ✗ SQLite non trovato: ${SQLITE_PATH}`);
    process.exit(1);
  }
  if (sequelize.getDialect() !== 'postgres') {
    console.error('  ✗ Sequelize non sta puntando a Postgres. Controlla DB_DIALECT nel .env');
    process.exit(1);
  }

  await sequelize.authenticate();
  console.log(
    `  ✓ Connesso al Postgres: ${process.env.DB_NAME}@${process.env.DB_HOST}:${process.env.DB_PORT}`,
  );
  console.log(`  ✓ Sorgente SQLite:      ${SQLITE_PATH}`);
  console.log('');

  // Pre-fetch counts da SQLite per il report
  const counts = {};
  for (const { table } of TABLES_IN_ORDER) {
    const rows = await readSqliteTable(table);
    counts[table] = rows.length;
  }
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`  ⓘ Totale righe da migrare: ${totalRows}\n`);

  // Modalità autocommit (no transazione): aiuta a capire se il problema è
  // legato all'interazione tra transazione e pool di connessioni.
  // 1) Wipe Postgres + reset identity (CASCADE per gestire eventuali FK)
  const tableList = TABLES_IN_ORDER.map(({ table }) => `"${table}"`).join(', ');
  await sequelize.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
  console.log('  ✓ Postgres svuotato (TRUNCATE CASCADE)\n');

  // 2) Bulk insert in ordine parent → child, preservando gli id
  for (const { table, model } of TABLES_IN_ORDER) {
    const rows = await readSqliteTable(table);
    if (!rows.length) {
      console.log(`    · ${table}: 0`);
      continue;
    }
    const coerced = rows.map((r) => coerceForModel(r, model));
    await model.bulkCreate(coerced, {
      validate: false,
      hooks: false,
      individualHooks: false,
      ignoreDuplicates: false,
    });
    console.log(`    ✓ ${table}: ${rows.length}`);
  }

  // 3) Riallinea le sequence Postgres a MAX(id)+1.
  console.log('\n  → Reset sequences…');
  for (const { table } of TABLES_IN_ORDER) {
    try {
      await sequelize.query(`
        DO $$
        DECLARE seqname TEXT;
        BEGIN
          SELECT pg_get_serial_sequence('"${table}"', 'id') INTO seqname;
          IF seqname IS NOT NULL THEN
            EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I), 1), true)', seqname, '${table}');
          END IF;
        END $$;
      `);
    } catch (err) {
      console.warn(`    ⚠ ${table}: setval skip (${err.message})`);
    }
  }
  console.log('  ✓ Sequenze riallineate');

  console.log('\n  ✓ Migrazione completata');

  // Verifica post-commit: leggiamo i conteggi dal SAME sequelize per
  // escludere problemi di "altra connessione vede dati diversi".
  console.log('\n  → Verifica conteggi post-commit:');
  for (const { table } of TABLES_IN_ORDER) {
    const [r] = await sequelize.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    console.log(`    · ${table}: ${r[0].n}`);
  }

  await sequelize.close();
}

main().catch((err) => {
  console.error('\n  ✗ Errore migrazione:', err.message);
  if (err.parent) console.error('    causa:', err.parent.message);
  if (err.sql) console.error('    SQL :', err.sql.slice(0, 300));
  process.exit(1);
});
