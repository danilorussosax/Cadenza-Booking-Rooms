'use strict';

/**
 * Setup globale dei test backend (caricato da vitest.config.js).
 *
 * - Forza le env per SQLite in-memory PRIMA di toccare i model.
 * - Crea lo schema una sola volta per processo (singleFork=true).
 * - `resetDatabase()` viene chiamato dai singoli test (in beforeEach o
 *   beforeAll) quando vogliono una tabula rasa.
 */

// BACKUP_DIR deve essere isolato in tempdir PRIMA che scripts/backup.js
// venga caricato (cattura il path a load-time tramite costante module-level).
// Senza questo, se app.js viene importato da un altro file di test prima di
// backups.test.js, il backup finisce nella dir reale del progetto.
if (!process.env.BACKUP_DIR) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  process.env.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aulabook-tests-bkp-'));
}

require('../config/database.test');

// Vitest 3 è ESM-only. In CommonJS dobbiamo usare i global iniettati
// dall'opzione `globals: true` (vedi vitest.config.js): beforeAll,
// afterAll, beforeEach, describe, it, expect sono già definiti.

const { sequelize } = require('../models');

async function resetDatabase() {
  // Trunca/ricrea tutte le tabelle. Su SQLite in-memory è istantaneo.
  await sequelize.sync({ force: true });
}

globalThis.resetDatabase = resetDatabase;

// IMPORTANTE: NON chiudere sequelize in afterAll. Con `singleFork: true` i
// file di test condividono la stessa istanza Sequelize: chiudere dopo il
// primo file rompe i successivi (errori "ConnectionManager closed").
// SQLite in-memory viene rilasciato alla fine del processo, è OK.
beforeAll(async () => {
  if (sequelize.connectionManager?.pool?.destroyed) {
    // recover from setup precedente che ha chiuso
    return;
  }
  await sequelize.sync({ force: true });
});

module.exports = { resetDatabase };
