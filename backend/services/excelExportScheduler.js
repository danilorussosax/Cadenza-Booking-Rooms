'use strict';

/**
 * Tick periodico dell'export Excel.
 *
 * Pattern dietro mailOutboxScheduler.js:
 *   - tick ogni EXCEL_EXPORT_TICK_MIN minuti (default 10)
 *   - no-op se EXCEL_EXPORT_ENABLED=false
 *   - mai bloccante: errori loggati, retry al prossimo tick
 *   - single-flight: se il tick precedente è ancora in corso, salta
 */

const exporter = require('./excelExporter');
const logger = require('../lib/logger').child({ scope: 'excelExportScheduler' });

let timer = null;
let running = false;
let lastTickAt = null;
let lastError = null;

function getTickMs() {
  const n = Number(process.env.EXCEL_EXPORT_TICK_MIN);
  const minutes = Number.isFinite(n) && n >= 1 && n <= 60 ? n : 10;
  return minutes * 60 * 1000;
}

async function tick() {
  if (running) {
    logger.warn('tick skipped — export precedente ancora in corso');
    return;
  }
  running = true;
  try {
    const r = await exporter.exportNow();
    if (!r.ok) logger.warn({ reason: r.reason }, 'export skipped');
    lastError = null;
  } catch (err) {
    // exportNow non dovrebbe lanciare (gestisce errori internamente),
    // ma per sicurezza catch-all qui per non killare il process.
    lastError = err?.message ? String(err.message).slice(0, 500) : String(err).slice(0, 500);
    logger.error({ err: err.message }, 'export threw');
  } finally {
    lastTickAt = new Date();
    running = false;
  }
}

function getStatus() {
  const intervalMs = exporter.isEnabled() ? getTickMs() : null;
  return {
    name: 'excelExport',
    enabled: timer != null && exporter.isEnabled(),
    running,
    intervalMs,
    lastTickAt,
    lastError,
    nextTickAt: timer && intervalMs ? new Date(Date.now() + intervalMs) : null,
  };
}

function start() {
  if (timer) return;
  // PM2 cluster mode: solo l'istanza 0 esegue gli scheduler (vedi clusterRole.js).
  if (!require('../lib/clusterRole').isSchedulerMaster()) {
    logger.info('Excel export scheduler skipped — non-master cluster instance');
    return;
  }
  if (!exporter.isEnabled()) {
    logger.info('Export Excel disabilitato — scheduler non avviato.');
    return;
  }
  const tickMs = getTickMs();
  // primo tick a 30s dal boot (lascia tempo al DB sync e ai modelli)
  setTimeout(tick, 30_000);
  timer = setInterval(tick, tickMs);
  logger.info(`Scheduler avviato: tick ogni ${tickMs / 60_000} min`);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, tick, getStatus };
