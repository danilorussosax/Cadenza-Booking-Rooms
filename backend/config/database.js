'use strict';

const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');
require('dotenv').config();

const dialect = process.env.DB_DIALECT || 'sqlite';
const isProd = process.env.NODE_ENV === 'production';

// Logging: disattivato in prod, log limitato (solo righe di SQL distillate) in dev
function makeLogger() {
  if (process.env.DB_LOGGING === 'true') return console.log;
  if (process.env.DB_LOGGING === 'false') return false;
  return isProd
    ? false
    : (sql) => {
        const trimmed = sql.replace(/^Executing \(.+?\): /, '').slice(0, 200);
        console.log('  sql ›', trimmed);
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
  benchmark: !isProd,
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
  // postgres | mysql | mariadb
  const dialectOptions = {};

  if (dialect === 'postgres' && process.env.DB_SSL === 'true') {
    dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
  }
  if (dialect === 'mysql' || dialect === 'mariadb') {
    dialectOptions.dateStrings = false;
    dialectOptions.connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT || 20000);
  }

  sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    ...baseOptions,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || (dialect === 'postgres' ? 5432 : 3306),
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
