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

const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { AuditLog } = require('../models');
const logger = require('../lib/logger');

const DEFAULT_AUDIT_RETENTION_DAYS = 730; // 24 mesi
const TICK_HOUR = 3; // 03:00 locali

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

async function tick() {
  await pruneAuditLog();
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

module.exports = { start, stop, pruneAuditLog };
