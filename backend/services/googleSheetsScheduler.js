'use strict';

/**
 * Scheduler tick periodico del mirror Google Sheets.
 *
 * Patternato dietro mailOutboxScheduler.js e backupScheduler.js:
 *   - tick ogni GOOGLE_SHEETS_TICK_MIN minuti (default 10)
 *   - no-op se disabilitato o config mancante
 *   - mai bloccante: errori loggati, retry al prossimo tick
 */

const cron = require('node-cron');
const mirror = require('./googleSheetsMirror');
const logger = require('../lib/logger').child({ scope: 'googleSheetsScheduler' });

let task = null;

function start() {
  if (!mirror.isEnabled()) {
    logger.info('Mirror Google Sheets disabilitato — scheduler non avviato.');
    return;
  }
  const tickMin = Number(process.env.GOOGLE_SHEETS_TICK_MIN || 10);
  if (!Number.isInteger(tickMin) || tickMin < 1 || tickMin > 60) {
    logger.warn(`GOOGLE_SHEETS_TICK_MIN non valido (${tickMin}), uso 10`);
  }
  const minutes = Number.isInteger(tickMin) && tickMin >= 1 && tickMin <= 60 ? tickMin : 10;
  // Espressione cron: ogni `minutes` minuti
  const cronExpr = `*/${minutes} * * * *`;
  task = cron.schedule(cronExpr, async () => {
    try {
      const r = await mirror.syncNow();
      if (!r.ok) logger.warn({ reason: r.reason }, 'sync skipped');
    } catch (err) {
      // syncNow non dovrebbe lanciare (gestisce errori internamente),
      // ma per sicurezza catch-all qui per non killare il process.
      logger.error({ err }, 'sync threw');
    }
  });
  logger.info(`Scheduler avviato: tick ogni ${minutes} min (cron: ${cronExpr})`);
}

function stop() {
  if (task) {
    task.stop();
    task = null;
  }
}

module.exports = { start, stop };
