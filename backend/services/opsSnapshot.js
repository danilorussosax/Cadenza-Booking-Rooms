'use strict';

/**
 * Snapshot aggregato dello stato operativo (VPS · Postgres · MailOutbox ·
 * Backup · Scheduler) usato dalla dashboard /admin/ops.
 *
 * Cache in-memory TTL 5s: la dashboard fa polling ogni 10s ma più admin
 * connessi insieme non devono moltiplicare le query.
 *
 * Filosofia: ogni gather* è isolato in try/catch e restituisce
 * `{ error }` per la propria sezione invece di far cadere l'intero
 * snapshot. La UI degrada graziosamente sui widget falliti.
 */

const fs = require('fs');
const os = require('os');
const { sequelize, MailOutbox } = require('../models');
const { listBackups, BACKUP_DIR } = require('../scripts/backup');
const reminderScheduler = require('./reminderScheduler');
const retentionScheduler = require('./retentionScheduler');
const mailOutboxScheduler = require('./mailOutboxScheduler');
const backupScheduler = require('./backupScheduler');
const excelExportScheduler = require('./excelExportScheduler');

const CACHE_TTL_MS = 5_000;
let cached = null;
let cachedAt = 0;
let inflight = null;

// ─────────────────────────────────────────────────────────────────────────────
// VPS

async function gatherVps() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const disk = await gatherDisk();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpuCount: os.cpus().length,
    loadAvg: os.loadavg(), // [1m, 5m, 15m]
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usedPercent: totalMem ? Math.round((usedMem / totalMem) * 100) : null,
    },
    uptimeSec: Math.round(os.uptime()),
    processUptimeSec: Math.round(process.uptime()),
    nodeVersion: process.version,
    disk,
  };
}

async function gatherDisk() {
  // fs.promises.statfs è disponibile da Node 18.15 / 19.6. Cadenza richiede
  // Node 20+ ma facciamo guard per ambienti più vecchi.
  if (typeof fs.promises.statfs !== 'function') return null;
  try {
    const stat = await fs.promises.statfs('/');
    const total = Number(stat.blocks) * Number(stat.bsize);
    const avail = Number(stat.bavail) * Number(stat.bsize);
    const used = total - avail;
    return {
      totalBytes: total,
      usedBytes: used,
      availBytes: avail,
      usedPercent: total ? Math.round((used / total) * 100) : null,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Postgres

async function gatherPostgres() {
  const dialect = sequelize.getDialect();
  if (dialect !== 'postgres') {
    return { dialect, available: false };
  }
  const out = { dialect, available: true };

  try {
    const [rows] = await sequelize.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE state = 'active')::int AS active,
         COUNT(*) FILTER (WHERE state = 'idle')::int AS idle,
         COUNT(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_tx
       FROM pg_stat_activity
       WHERE datname = current_database()`,
    );
    out.connections = rows[0] || null;
  } catch (err) {
    out.connectionsError = shortMsg(err);
  }

  try {
    const [rows] = await sequelize.query(
      `SELECT pg_database_size(current_database())::bigint AS bytes`,
    );
    out.dbSizeBytes = Number(rows[0]?.bytes ?? 0);
  } catch (err) {
    out.dbSizeError = shortMsg(err);
  }

  try {
    const [rows] = await sequelize.query(
      `SELECT relname,
              COALESCE(n_live_tup, 0)::bigint AS live,
              last_autovacuum,
              last_autoanalyze
       FROM pg_stat_user_tables
       ORDER BY COALESCE(n_live_tup, 0) DESC
       LIMIT 5`,
    );
    out.topTables = rows.map((r) => ({
      table: r.relname,
      liveTuples: Number(r.live ?? 0),
      lastAutovacuum: r.last_autovacuum,
      lastAutoanalyze: r.last_autoanalyze,
    }));
  } catch (err) {
    out.topTablesError = shortMsg(err);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// MailOutbox

async function gatherMailOutbox() {
  try {
    const [pending, sent, dead] = await Promise.all([
      MailOutbox.count({ where: { status: 'pending' } }),
      MailOutbox.count({ where: { status: 'sent' } }),
      MailOutbox.count({ where: { status: 'dead' } }),
    ]);
    const oldestPending = await MailOutbox.findOne({
      where: { status: 'pending' },
      order: [['createdAt', 'ASC']],
      attributes: ['createdAt'],
    });
    const oldestAt = oldestPending?.createdAt ?? null;
    return {
      pending,
      sent,
      dead,
      total: pending + sent + dead,
      oldestPendingAt: oldestAt,
      oldestPendingAgeSec: oldestAt
        ? Math.round((Date.now() - new Date(oldestAt).getTime()) / 1000)
        : null,
    };
  } catch (err) {
    return { error: shortMsg(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backups

function gatherBackups() {
  try {
    const items = listBackups();
    if (items.length === 0) {
      return {
        count: 0,
        lastBackup: null,
        lastBackupAgeHours: null,
        totalSizeBytes: 0,
        dir: BACKUP_DIR,
      };
    }
    const last = items[0]; // listBackups ordina per createdAt desc
    const totalSize = items.reduce((s, b) => s + b.sizeBytes, 0);
    const ageHours = (Date.now() - new Date(last.createdAt).getTime()) / 3_600_000;
    return {
      count: items.length,
      lastBackup: {
        file: last.file,
        sizeBytes: last.sizeBytes,
        createdAt: last.createdAt,
      },
      lastBackupAgeHours: Math.round(ageHours * 10) / 10,
      totalSizeBytes: totalSize,
      dir: BACKUP_DIR,
    };
  } catch (err) {
    return { error: shortMsg(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedulers

function gatherSchedulers() {
  return [
    safeStatus('reminder', () => reminderScheduler.getStatus()),
    safeStatus('retention', () => retentionScheduler.getStatus()),
    safeStatus('mailOutbox', () => mailOutboxScheduler.getStatus()),
    // backupScheduler ha una getStatus() preesistente con shape diversa
    // (richiamata anche da /api/admin/backups). La normalizziamo qui sul
    // formato comune così la UI può iterare uniforme.
    adaptBackupStatus(),
    safeStatus('excelExport', () => excelExportScheduler.getStatus()),
  ];
}

function safeStatus(name, fn) {
  try {
    return fn();
  } catch (err) {
    return { name, enabled: false, error: shortMsg(err) };
  }
}

function adaptBackupStatus() {
  try {
    const raw = backupScheduler.getStatus();
    return {
      name: 'backup',
      enabled: !!raw.enabled,
      running: !!raw.inProgress,
      intervalMs: 24 * 60 * 60 * 1000,
      lastTickAt: raw.lastRun?.at ?? null,
      lastError: raw.lastRun?.ok === false ? (raw.lastRun?.error ?? null) : null,
      nextTickAt: raw.nextRunAt ?? null,
    };
  } catch (err) {
    return { name: 'backup', enabled: false, error: shortMsg(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function shortMsg(err) {
  return err?.message ? String(err.message).slice(0, 200) : String(err).slice(0, 200);
}

async function buildSnapshot() {
  const [vps, postgres, mailOutbox] = await Promise.all([
    gatherVps(),
    gatherPostgres(),
    gatherMailOutbox(),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    vps,
    postgres,
    mailOutbox,
    backups: gatherBackups(),
    schedulers: gatherSchedulers(),
  };
}

/**
 * Restituisce uno snapshot. Il risultato è memoizzato per CACHE_TTL_MS
 * e la coda di chiamate concorrenti collassa su una sola buildSnapshot()
 * (no thundering herd se più admin polling-ano insieme).
 *
 * @param {{ force?: boolean }} opts — `force:true` bypassa la cache.
 */
async function getSnapshot({ force = false } = {}) {
  const now = Date.now();
  if (!force && cached && now - cachedAt < CACHE_TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = buildSnapshot()
    .then((snap) => {
      cached = snap;
      cachedAt = Date.now();
      return snap;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function _resetCacheForTest() {
  cached = null;
  cachedAt = 0;
  inflight = null;
}

module.exports = { getSnapshot, _resetCacheForTest };
