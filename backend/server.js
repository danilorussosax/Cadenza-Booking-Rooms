'use strict';

require('dotenv').config();
// Sentry deve essere inizializzato PRIMA di qualunque altro require: l'auto
// instrumentation di @sentry/node patch-a http/express/postgres/ecc. Se
// SENTRY_DSN non è impostato, init() ritorna false e tutto è no-op.
require('./lib/sentry').init();
const { sequelize } = require('./models');
const { buildApp } = require('./app');

const PORT = process.env.PORT || 3000;
const app = buildApp();

// =============================================
// Strategia sync DB
//
// DB_SYNC_MODE controlla cosa viene fatto allo startup:
//   safe   (default): sync() — crea tabelle/indici mancanti, NON altera quelle esistenti
//   alter            : sync({alter:true}) — adegua lo schema (rischioso su SQLite, usalo dopo
//                      ogni cambio di model, una volta sola: poi torna a "safe")
//   force            : sync({force:true}) — DROP + CREATE di TUTTE le tabelle (PERDE I DATI)
//   none             : non chiama sync — usa quando si gestiscono migrazioni esterne
// =============================================
async function syncSchema() {
  const mode = (
    process.env.DB_SYNC_MODE || (process.env.NODE_ENV === 'development' ? 'safe' : 'safe')
  ).toLowerCase();
  const isSqlite = sequelize.getDialect() === 'sqlite';

  if (mode === 'none') {
    console.log('  ⓘ DB sync saltato (DB_SYNC_MODE=none)');
    return;
  }

  // Pulizia tabelle "_backup" orfane (residui di run precedenti falliti su SQLite)
  if (isSqlite && (mode === 'alter' || mode === 'force')) {
    const [orphans] = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_backup'",
    );
    for (const t of orphans) {
      console.warn(`  ⚠ Rimuovo tabella backup orfana: ${t.name}`);
      await sequelize.query(`DROP TABLE IF EXISTS \`${t.name}\`;`);
    }
  }

  // Disattiva temporaneamente le FK durante alter/force su SQLite
  // (la procedura drop+recreate fallirebbe sui vincoli)
  if (isSqlite && (mode === 'alter' || mode === 'force')) {
    await sequelize.query('PRAGMA foreign_keys = OFF;');
  }

  if (mode === 'force') {
    console.warn('  ⚠ DB_SYNC_MODE=force: drop e ricreazione di tutte le tabelle');
    await sequelize.sync({ force: true });
  } else if (mode === 'alter') {
    console.log('  ⓘ DB_SYNC_MODE=alter: adeguamento schema in corso');
    await sequelize.sync({ alter: true });
  } else {
    await sequelize.sync(); // safe: crea solo le mancanti
  }

  if (isSqlite) {
    await sequelize.query('PRAGMA foreign_keys = ON;');
  }

  console.log(`✓ Schema DB sincronizzato (mode=${mode})`);
}

// =============================================
// Avvio
// =============================================
let httpServer;

async function start() {
  try {
    await sequelize.connectWithRetry();
    console.log('✓ Database connesso');

    const { runPreSyncMigrations } = require('./lib/preSyncMigrations');
    await runPreSyncMigrations();

    await syncSchema();

    if (process.env.DB_SEED !== 'false') {
      await require('./seeders/initial')();
    }

    try {
      const { initOAuthStrategies } = require('./config/passport');
      const oauth = await initOAuthStrategies();
      console.log(
        `  ⓘ OAuth: Google=${oauth.google ? 'on' : 'off'}, Microsoft=${oauth.microsoft ? 'on' : 'off'}`,
      );
    } catch (err) {
      console.warn('  ⚠ Caricamento OAuth fallito:', err.message);
    }

    httpServer = app.listen(PORT, () => {
      console.log(`\n  🎼  Cadenza — Conservatory Booking System`);
      console.log(`      In ascolto su http://localhost:${PORT}`);
      console.log(`      Ambiente: ${process.env.NODE_ENV || 'development'}`);
      console.log(`      Database: ${process.env.DB_DIALECT || 'sqlite'}\n`);

      require('./services/reminderScheduler').start();
      require('./services/retentionScheduler').start();
      // backupScheduler.start() è async (legge BackupSettings da DB);
      // fire-and-forget: errori loggati internamente, non bloccano il boot.
      require('./services/backupScheduler')
        .start()
        .catch((e) => {
          console.error('[backup] start failed:', e.message);
        });
    });

    // Errori di listen (EADDRINUSE, EACCES, …) → messaggio chiaro invece di
    // stacktrace pg-protocol fuorviante.
    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n✗ Porta ${PORT} già occupata da un altro processo.`);
        console.error(`  Identifica il processo:  lsof -i :${PORT} -sTCP:LISTEN`);
        console.error(`  Termina e riavvia:       lsof -ti:${PORT} | xargs kill`);
        console.error(`  Oppure cambia porta:     PORT=3001 npm start\n`);
      } else if (err.code === 'EACCES') {
        console.error(`\n✗ Permesso negato per la porta ${PORT}.`);
        console.error(`  Le porte < 1024 richiedono sudo; usa una porta ≥ 1024.\n`);
      } else {
        console.error('\n✗ Errore avvio server:', err.message);
      }
      void safeShutdown(1);
    });
  } catch (err) {
    console.error('✗ Errore avvio server:', err);
    await safeShutdown(1);
  }
}

let shuttingDown = false;
async function safeShutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n→ Chiusura in corso…');
  try {
    if (httpServer && httpServer.listening) {
      await new Promise((res) => httpServer.close(res));
      console.log('  ✓ HTTP server fermato');
    }
    if (sequelize.connectionManager && !sequelize.connectionManager.pool?.destroyed) {
      await sequelize.close();
      console.log('  ✓ Connessioni DB chiuse');
    }
  } catch (err) {
    console.error('  ✗ Errore in chiusura:', err.message);
  } finally {
    process.exit(code);
  }
}

['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => safeShutdown(0)));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  safeShutdown(1);
});

start();
