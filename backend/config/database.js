'use strict';

const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');
// Path esplicito al .env del backend: senza, `dotenv.config()` dipende dalla
// CWD del processo (server.js, vitest, sequelize-cli, scripts diag) e
// silenziosamente cade sui default Sequelize quando la CWD non è `backend/`.
// Idempotente: dotenv non sovrascrive var già caricate da server.js.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dialect = process.env.DB_DIALECT || 'sqlite';
const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Lazy require per evitare ciclo (requestContext non è ancora pronto al boot
// del modulo config — viene risolto a primo uso).
let slowQueryRecorder;
function getRecorder() {
  if (!slowQueryRecorder) slowQueryRecorder = require('../lib/slowQueryRecorder');
  return slowQueryRecorder;
}

// Logging: con `benchmark: true` Sequelize passa il secondo argomento
// `timingMs` alla callback. In dev: stampa in console. In prod: silenzioso
// salvo per le query lente, registrate nel ring-buffer slowQueryRecorder.
// In test: silenzioso (i record vengono comunque catturati se sopra threshold).
function makeLogger() {
  const forced = process.env.DB_LOGGING;
  const consoleLog = forced === 'true' || (!isProd && !isTest && forced !== 'false');

  return (sql, timingMs) => {
    if (typeof timingMs === 'number') {
      try {
        getRecorder().record({ sql, durationMs: timingMs });
      } catch {
        // Recorder non disponibile (test isolato che mocka il modulo): ignora.
      }
    }
    if (consoleLog) {
      const trimmed = String(sql)
        .replace(/^Executing \(.+?\): /, '')
        .slice(0, 200);
      const tag = typeof timingMs === 'number' ? ` (${timingMs}ms)` : '';
      console.log(`  sql${tag} ›`, trimmed);
    }
  };
}

// Pool configurabile via env (utile per Postgres/MySQL in produzione)
const pool = {
  max: Number(process.env.DB_POOL_MAX || (isProd ? 20 : 5)),
  min: Number(process.env.DB_POOL_MIN || 0),
  acquire: Number(process.env.DB_POOL_ACQUIRE || 30000),
  idle: Number(process.env.DB_POOL_IDLE || 10000),
  evict: Number(process.env.DB_POOL_EVICT || 1000),
};

const retry = {
  // Sequelize riprova automaticamente le query su errori transient noti
  max: Number(process.env.DB_RETRY_MAX || 3),
  match: [
    /SQLITE_BUSY/,
    /database is locked/i,
    /ETIMEDOUT/,
    /ECONNREFUSED/,
    /ECONNRESET/,
    /Deadlock/i,
    /SequelizeConnectionError/,
    /SequelizeConnectionRefusedError/,
  ],
};

const baseOptions = {
  dialect,
  logging: makeLogger(),
  pool,
  retry,
  define: { timestamps: true, underscored: false, freezeTableName: false },
  // benchmark sempre attivo: il costo di process.hrtime per query è trascurabile
  // (~1 µs), in cambio abbiamo tempi di esecuzione disponibili anche in prod
  // per `slowQueryRecorder`.
  benchmark: true,
};

let sequelize;

if (dialect === 'sqlite') {
  const storagePath =
    process.env.DB_STORAGE || path.join(__dirname, '..', 'data', 'conservatory.sqlite');
  const dir = path.dirname(storagePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  sequelize = new Sequelize({
    ...baseOptions,
    storage: storagePath,
    // SQLite ha sempre una sola connessione fisica: limitiamo il pool
    pool: { ...pool, max: 1 },
  });

  // Configurazione PRAGMA per ogni connessione SQLite:
  //   - WAL: scrittori concorrenti con i lettori, throughput nettamente migliore
  //   - synchronous=NORMAL: bilanciamento durabilità/perf (ok in WAL)
  //   - foreign_keys=ON: integrità referenziale
  //   - busy_timeout=5s: attesa automatica su lock invece di errore immediato
  //   - cache_size negativo: KB di cache page (default troppo basso)
  sequelize.afterConnect(async (conn) => {
    const run = (sql) =>
      new Promise((res, rej) => conn.run(sql, (err) => (err ? rej(err) : res())));
    await run('PRAGMA journal_mode = WAL;');
    await run('PRAGMA synchronous = NORMAL;');
    await run('PRAGMA foreign_keys = ON;');
    await run('PRAGMA busy_timeout = 5000;');
    await run('PRAGMA cache_size = -16000;'); // ~16 MB
    await run('PRAGMA temp_store = MEMORY;');
  });
} else {
  // postgres
  const dialectOptions = {};

  if (process.env.DB_SSL === 'true') {
    dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
  }

  // Quando il backend punta a PgBouncer (DB_PORT=6432 o flag esplicito):
  //   - prepared_statements=false: PgBouncer in transaction pooling non
  //     supporta prepared statement named (ogni transazione può finire su
  //     una connessione server diversa).
  //   - statement_timeout / idle_in_transaction_session_timeout vengono
  //     passati come startup parameter e PgBouncer li inoltra a Postgres.
  //     In transaction pooling, DISCARD ALL al termine della tx NON
  //     resetta i parametri settati via startup packet (solo quelli via
  //     SET SESSION). Quindi sono sicuri da usare.
  const isPgBouncer = process.env.DB_PORT === '6432' || process.env.DB_PGBOUNCER === 'true';
  if (isPgBouncer) {
    dialectOptions.prepared_statements = false;
  }

  // Timeout server-side per evitare query stuck (planner cattivo, lock
  // GiST, deadlock SERIALIZABLE) che esauriscano il pool. Override via env.
  //   statement_timeout: kill della query dopo N ms
  //   idle_in_transaction_session_timeout: kill se la tx resta idle
  dialectOptions.statement_timeout = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000);
  dialectOptions.idle_in_transaction_session_timeout = Number(
    process.env.DB_IDLE_IN_TX_TIMEOUT_MS || 60000,
  );

  sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    ...baseOptions,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    dialectOptions,
    timezone: process.env.DB_TIMEZONE || '+00:00',
  });
}

/**
 * Tenta di stabilire la connessione con retry esponenziale.
 * Utile in scenari containerizzati dove il DB potrebbe essere ancora in fase di boot.
 */
sequelize.connectWithRetry = async function connectWithRetry({
  attempts = Number(process.env.DB_CONNECT_ATTEMPTS || 5),
  baseDelayMs = Number(process.env.DB_CONNECT_BASE_DELAY || 800),
} = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      await this.authenticate();
      return;
    } catch (err) {
      lastErr = err;
      if (i === attempts) break;
      const delay = baseDelayMs * Math.pow(2, i - 1);
      console.warn(
        `  ⚠ Connessione DB fallita (tentativo ${i}/${attempts}), riprovo tra ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
};

module.exports = sequelize;
