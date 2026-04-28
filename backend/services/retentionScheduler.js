'use strict';

/**
 * Scheduler retention GDPR — gira una volta al giorno e applica le
 * politiche di conservazione documentate nella Privacy Policy.
 *
 * Politiche correnti:
 *   - AuditLog: massimo 24 mesi (configurabile via GDPR_AUDIT_LOG_RETENTION_DAYS,
 *     default 730). Cancellazione fisica perché l'audit è append-only e
 *     anonimizzarlo non avrebbe senso (resterebbero record vuoti).
 *
 * Lo scheduler si avvia con `start()` chiamato da server.js. Calcola
 * dinamicamente il delay al prossimo tick alle 03:00 locali per evitare
 * di mordere le ore di traffico (e per non sommarsi al backup notturno).
 *
 * Tutti i tick sono "fail-safe": un errore non blocca i successivi.
 */

const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { AuditLog } = require('../models');
const logger = require('../lib/logger');

const DEFAULT_AUDIT_RETENTION_DAYS = 730; // 24 mesi
const DEFAULT_PRE_RESTORE_RETENTION_DAYS = 7;
const TICK_HOUR = 3; // 03:00 locali

const BACKEND_ROOT = path.resolve(__dirname, '..');

let timer = null;

function nextRunDelayMs() {
  const now = dayjs();
  let next = now.startOf('day').add(TICK_HOUR, 'hour');
  if (!next.isAfter(now)) {
    next = next.add(1, 'day');
  }
  return next.diff(now);
}

function getAuditRetentionDays() {
  const raw = Number(process.env.GDPR_AUDIT_LOG_RETENTION_DAYS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_AUDIT_RETENTION_DAYS;
  // Limite minimo 30 giorni: una retention più aggressiva sarebbe
  // probabilmente un errore di configurazione che farebbe perdere
  // tracciabilità di indagini su incidenti recenti.
  return Math.max(30, Math.floor(raw));
}

async function pruneAuditLog() {
  const days = getAuditRetentionDays();
  const cutoff = dayjs().subtract(days, 'day').toDate();
  try {
    const removed = await AuditLog.destroy({
      where: { createdAt: { [Op.lt]: cutoff } },
    });
    if (removed > 0) {
      logger.info(
        { removed, retentionDays: days, cutoff: cutoff.toISOString() },
        'audit log retention sweep',
      );
      console.log(`[retention] AuditLog: rimossi ${removed} record più vecchi di ${days}gg`);
    }
  } catch (err) {
    logger.error({ err: err.message }, 'audit log retention sweep failed');
  }
}

/**
 * Cancella le directory `data/conservatory.sqlite.pre-restore-*` e
 * `uploads.pre-restore-*` più vecchie di N giorni. Sono safety-net
 * create automaticamente da `services/backupRestore.js` ad ogni
 * restore — se non vengono mai pulite riempiono il volume.
 */
async function prunePreRestoreSnapshots() {
  const days = Math.max(
    1,
    Number(process.env.PRE_RESTORE_RETENTION_DAYS) || DEFAULT_PRE_RESTORE_RETENTION_DAYS,
  );
  const cutoff = dayjs().subtract(days, 'day').valueOf();
  const dirs = [
    { base: path.join(BACKEND_ROOT, 'data'), prefix: 'conservatory.sqlite.pre-restore-' },
    { base: BACKEND_ROOT, prefix: 'uploads.pre-restore-' },
  ];
  let totalDeleted = 0;
  let totalBytes = 0;
  for (const d of dirs) {
    if (!fs.existsSync(d.base)) continue;
    let entries;
    try {
      entries = fs.readdirSync(d.base);
    } catch (err) {
      logger.warn({ err: err.message, base: d.base }, 'pre-restore retention: readdir failed');
      continue;
    }
    for (const name of entries) {
      if (!name.startsWith(d.prefix)) continue;
      const full = path.join(d.base, name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs >= cutoff) continue; // Recente, mantieni
        // Calcola size approssimativa (per log)
        const size = st.isDirectory() ? estimateDirSize(full) : st.size;
        if (st.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
        else fs.unlinkSync(full);
        totalDeleted += 1;
        totalBytes += size;
      } catch (err) {
        logger.warn({ err: err.message, name }, 'pre-restore retention: cleanup item failed');
      }
    }
  }
  if (totalDeleted > 0) {
    logger.info(
      { removed: totalDeleted, freedBytes: totalBytes, retentionDays: days },
      'pre-restore retention sweep',
    );
    console.log(
      `[retention] pre-restore: rimossi ${totalDeleted} snapshot più vecchi di ${days}gg ` +
        `(${(totalBytes / 1024 / 1024).toFixed(1)} MB liberati)`,
    );
  }
}

function estimateDirSize(dir) {
  let size = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) size += estimateDirSize(p);
        else size += st.size;
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    /* skip */
  }
  return size;
}

async function tick() {
  await pruneAuditLog();
  await prunePreRestoreSnapshots();
  // Riprogramma il prossimo tick a 24h.
  scheduleNext();
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, nextRunDelayMs());
}

function start() {
  if (timer) return;
  scheduleNext();
  console.log(
    `[retention] scheduler avviato (sweep alle ${String(TICK_HOUR).padStart(2, '0')}:00, audit log = ${getAuditRetentionDays()}gg)`,
  );
}

function stop() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

module.exports = { start, stop, pruneAuditLog, prunePreRestoreSnapshots };
