'use strict';

/**
 * Scheduler di backup automatico — gira una volta al giorno e crea uno
 * snapshot tar.gz del database + cartella uploads, applicando la rotation
 * configurata dall'admin (giornaliera/settimanale/mensile).
 *
 * Comportamento:
 *   - tick all'ora pianificata locale (default 02:30) → precede di 30 min
 *     il retention scheduler (03:00) così abbiamo lo snapshot di TUTTO
 *     l'audit log prima della pulizia
 *   - fail-safe: errori loggati ma non bloccano i tick successivi
 *   - opzionalmente disabilitabile da UI (BackupSettings.autoEnabled=false)
 *     o via env BACKUP_AUTO_ENABLED=false
 *
 * Configurazione: priorità DB (BackupSettings, singleton) > env > default.
 * Quando l'admin modifica le impostazioni via PUT /settings, il route
 * handler chiama `reschedule()` che ricarica la config e ricalcola il
 * prossimo tick.
 *
 * Il singolo tick è single-flight: se il backup precedente è ancora in
 * corso quando arriva il nuovo tick, lo saltiamo e logghiamo warning.
 *
 * Dopo ogni esecuzione mantiene in memoria `lastRun` (status, file,
 * sizeBytes, deleted, durationMs, error?) accessibile via `getStatus()`
 * per la pagina admin.
 */

const dayjs = require('dayjs');
const logger = require('../lib/logger');
const {
  performBackup,
  listBackups,
  BACKUP_DIR,
  KEEP_DAILY,
  KEEP_WEEKLY,
  KEEP_MONTHLY,
} = require('../scripts/backup');

const DEFAULT_HOUR = 2;
const DEFAULT_MIN = 30;

let timer = null;
let inProgress = false;
let lastRun = null; // { status, file, sizeBytes, deleted, durationMs, finishedAt, error? }
let cachedConfig = null; // ultima EffectiveConfig calcolata, per evitare round-trip DB ad ogni read

// ---------------------------------------------------------------------------
// Effective config — fonde DB > env > default
// ---------------------------------------------------------------------------

function envBool(name, def) {
  const v = process.env[name];
  if (v == null) return def;
  return v === 'true' || v === '1';
}

function envInt(name, def, min, max) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < min || raw > max) return def;
  return Math.floor(raw);
}

/**
 * Carica/aggiorna la cache di EffectiveConfig.
 * Prova prima la riga BackupSettings (id=1); se manca o errore, usa env+default.
 *
 * @returns {Promise<EffectiveConfig>}
 */
async function loadEffectiveConfig() {
  // env-only baseline (sempre disponibile, non dipende da DB)
  const baseline = {
    autoEnabled: envBool('BACKUP_AUTO_ENABLED', true),
    scheduledHour: envInt('BACKUP_TICK_HOUR', DEFAULT_HOUR, 0, 23),
    scheduledMinute: envInt('BACKUP_TICK_MINUTE', DEFAULT_MIN, 0, 59),
    keepDaily: KEEP_DAILY,
    keepWeekly: KEEP_WEEKLY,
    keepMonthly: KEEP_MONTHLY,
    autoRestartEnabled: envBool('AUTO_RESTART_ENABLED', false),
    source: 'env',
  };

  try {
    const { sequelize, BackupSettings } = require('../models');
    // Skip proattivo: durante safeShutdown il connection manager viene
    // chiuso PRIMA che lo scheduler abbia drenato l'eventuale tick/start
    // in volo. Un `findByPk` qui aprirebbe una nuova connessione e
    // fallirebbe con "ConnectionManager was called after the connection
    // manager was closed!". Cadiamo sulla cache (se c'è) o sul baseline
    // senza emettere query: silenziosi e zero round-trip al DB.
    if (sequelize?.connectionManager?.pool?.destroyed) {
      return cachedConfig || (cachedConfig = baseline);
    }
    const row = await BackupSettings.findByPk(1);
    if (row) {
      cachedConfig = {
        autoEnabled: row.autoEnabled,
        scheduledHour: row.scheduledHour,
        scheduledMinute: row.scheduledMinute,
        keepDaily: row.keepDaily,
        keepWeekly: row.keepWeekly,
        keepMonthly: row.keepMonthly,
        autoRestartEnabled: row.autoRestartEnabled,
        source: 'db',
      };
      return cachedConfig;
    }
  } catch (err) {
    // Difesa reattiva: la pool può chiudersi DOPO il check sopra (race tra
    // shutdown e query in volo). In quel caso filtra il messaggio
    // specifico — è atteso e il fallback env è già attivo.
    if (!/connection manager was closed/i.test(err.message || '')) {
      logger.debug?.({ err: err.message }, '[backup] BackupSettings non leggibile, uso env');
    }
  }
  cachedConfig = baseline;
  return cachedConfig;
}

/** Versione sincrona: usa la cache, fallback su env+default. Mai async. */
function getCachedConfig() {
  if (cachedConfig) return cachedConfig;
  return {
    autoEnabled: envBool('BACKUP_AUTO_ENABLED', true),
    scheduledHour: envInt('BACKUP_TICK_HOUR', DEFAULT_HOUR, 0, 23),
    scheduledMinute: envInt('BACKUP_TICK_MINUTE', DEFAULT_MIN, 0, 59),
    keepDaily: KEEP_DAILY,
    keepWeekly: KEEP_WEEKLY,
    keepMonthly: KEEP_MONTHLY,
    autoRestartEnabled: envBool('AUTO_RESTART_ENABLED', false),
    source: 'env',
  };
}

function nextRunDelayMs() {
  const cfg = getCachedConfig();
  const now = dayjs();
  let next = now.startOf('day').hour(cfg.scheduledHour).minute(cfg.scheduledMinute);
  if (!next.isAfter(now)) next = next.add(1, 'day');
  return next.diff(now);
}

async function tick() {
  if (inProgress) {
    logger.warn('[backup] tick skipped — backup precedente ancora in corso');
    scheduleNext();
    return;
  }
  inProgress = true;
  const startedAt = Date.now();
  try {
    logger.info('[backup] tick automatico in esecuzione…');
    // Ricarico config a ogni tick: se l'admin l'ha cambiata in giornata
    // (es. ridotto i keep* per liberare spazio), il prossimo tick rispetta
    // i nuovi valori senza richiedere reschedule esplicito.
    const cfg = await loadEffectiveConfig();
    const result = await performBackup({
      keepDaily: cfg.keepDaily,
      keepWeekly: cfg.keepWeekly,
      keepMonthly: cfg.keepMonthly,
    });
    const durationMs = Date.now() - startedAt;
    lastRun = {
      status: 'ok',
      file: result.file,
      sizeBytes: result.sizeBytes,
      kept: result.kept,
      deleted: result.deleted,
      durationMs,
      finishedAt: new Date().toISOString(),
    };
    const sizeMb = (result.sizeBytes / 1024 / 1024).toFixed(2);
    logger.info(
      { file: result.file, sizeMb, deleted: result.deleted.length, durationMs },
      `[backup] ✓ ${result.file} (${sizeMb} MB · ${(durationMs / 1000).toFixed(1)}s)`,
    );
  } catch (err) {
    lastRun = {
      status: 'error',
      error: err.message || String(err),
      durationMs: Date.now() - startedAt,
      finishedAt: new Date().toISOString(),
    };
    logger.error({ err: err.message }, '[backup] tick automatico fallito');
  } finally {
    inProgress = false;
    scheduleNext();
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  const cfg = getCachedConfig();
  if (!cfg.autoEnabled) {
    timer = null;
    return;
  }
  timer = setTimeout(tick, nextRunDelayMs());
}

async function start() {
  if (timer) return; // già attivo (idempotente per HMR/hot reload)
  await loadEffectiveConfig();
  const cfg = getCachedConfig();
  if (!cfg.autoEnabled) {
    console.log(`[backup] scheduler DISABILITATO (source=${cfg.source})`);
    return;
  }
  scheduleNext();
  const hh = String(cfg.scheduledHour).padStart(2, '0');
  const mm = String(cfg.scheduledMinute).padStart(2, '0');
  // Numero di backup attualmente presenti (informativo, non blocca lo start)
  const existing = listBackups();
  console.log(
    `[backup] scheduler avviato (tick alle ${hh}:${mm} locali · source=${cfg.source} · ${existing.length} backup presenti in ${BACKUP_DIR})`,
  );
}

function stop() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Rilegge le impostazioni e riprogramma il tick. Da chiamare dopo PUT /settings.
 * Se autoEnabled passa a false → ferma il timer; se passa a true → riavvia.
 */
async function reschedule() {
  await loadEffectiveConfig();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  scheduleNext();
}

/** Esposto alla UI admin: lo stato dell'ultimo run + il prossimo tick atteso
 *  + la configurazione corrente (modificabile via PUT /settings).
 */
function getStatus() {
  const cfg = getCachedConfig();
  return {
    enabled: cfg.autoEnabled && timer != null,
    autoEnabledEnv: cfg.autoEnabled,
    nextRunAt: timer ? new Date(Date.now() + nextRunDelayMs()).toISOString() : null,
    scheduledHour: cfg.scheduledHour,
    scheduledMinute: cfg.scheduledMinute,
    inProgress,
    lastRun,
    config: {
      backupDir: BACKUP_DIR, // non modificabile da UI
      keepDaily: cfg.keepDaily,
      keepWeekly: cfg.keepWeekly,
      keepMonthly: cfg.keepMonthly,
      autoRestartEnabled: cfg.autoRestartEnabled,
      source: cfg.source, // 'db' | 'env'
    },
  };
}

module.exports = { start, stop, tick, getStatus, reschedule, loadEffectiveConfig };
