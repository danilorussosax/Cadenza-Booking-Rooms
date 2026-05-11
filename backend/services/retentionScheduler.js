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
const zlib = require('zlib');
const crypto = require('crypto');
const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { AuditLog, MailOutbox } = require('../models');
const logger = require('../lib/logger').child({ scope: 'retentionScheduler' });

const DEFAULT_AUDIT_RETENTION_DAYS = 730; // 24 mesi
const DEFAULT_PRE_RESTORE_RETENTION_DAYS = 7;
const DEFAULT_MAIL_OUTBOX_RETENTION_DAYS = 30; // mail consegnate sopra i 30gg
const TICK_HOUR = 3; // 03:00 locali

const BACKEND_ROOT = path.resolve(__dirname, '..');
const AUDIT_ARCHIVE_DIR = path.join(BACKEND_ROOT, 'backups', 'audit');

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

/**
 * Chiave HMAC per firma archivi audit. Default: derivata dal JWT_SECRET
 * (così senza ulteriore configurazione si ha una firma valida per
 * verifica). Sovrascrivibile via env `AUDIT_ARCHIVE_HMAC_KEY` per chi
 * vuole una chiave dedicata (best-practice in PA: chiave conservata in
 * un HSM/Key Vault separata dal secret di sessione).
 */
function getAuditArchiveHmacKey() {
  if (process.env.AUDIT_ARCHIVE_HMAC_KEY) return process.env.AUDIT_ARCHIVE_HMAC_KEY;
  // Lazy require: evita circolare su startup test.
  const { getJwtSecret } = require('../lib/secrets');
  // SHA-256 del JWT_SECRET → chiave 32-byte adeguata per HMAC. Mai esporla.
  return crypto.createHash('sha256').update(getJwtSecret()).digest('hex');
}

/**
 * Archivia (export firmato) i record AuditLog più vecchi di `cutoff` PRIMA
 * di cancellarli da DB. Output:
 *   backups/audit/audit-YYYY-MM-DD-T..Z.jsonl.gz   (gzippato, 1 record per riga)
 *   backups/audit/audit-YYYY-MM-DD-T..Z.jsonl.gz.hmac  (sidecar JSON con
 *       firma HMAC SHA-256 dell'archivio + metadati: count, fromDate, toDate,
 *       generatedAt, hmacAlgo).
 *
 * Idempotente: se non ci sono record da archiviare, no-op. Se esiste già un
 * archivio per la stessa cutoff (improbabile dato il timestamp ms), aggiunge
 * un suffisso `-1`, `-2` per evitare overwrite.
 *
 * Streaming: legge a chunk di 500 record per evitare di tenere tutto in
 * memoria. Su un Conservatorio medio: 50k record AuditLog/anno → ~10 MB
 * gzippati = 100 chunk = pochi secondi a generare l'archivio.
 *
 * Restituisce { archivedCount, archivePath, hmacPath } oppure null se
 * non c'erano record da archiviare.
 */
async function archiveAuditLog(cutoff) {
  const where = { createdAt: { [Op.lt]: cutoff } };
  const total = await AuditLog.count({ where });
  if (total === 0) return null;

  // Setup dir + filename
  fs.mkdirSync(AUDIT_ARCHIVE_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  let basePath = path.join(AUDIT_ARCHIVE_DIR, `audit-${ts}.jsonl.gz`);
  // Anti-collision (paranoid): se già esiste, suffisso incrementale
  let counter = 0;
  while (fs.existsSync(basePath)) {
    counter += 1;
    basePath = path.join(AUDIT_ARCHIVE_DIR, `audit-${ts}-${counter}.jsonl.gz`);
  }
  const hmacPath = `${basePath}.hmac`;

  const fileStream = fs.createWriteStream(basePath);
  const gzip = zlib.createGzip({ level: 9 }); // compressione massima
  gzip.pipe(fileStream);

  const hmac = crypto.createHmac('sha256', getAuditArchiveHmacKey());
  let written = 0;
  let oldestSeen = null;
  let newestSeen = null;

  const CHUNK = 500;
  let lastId = 0;
  // Cursor-based: ordiniamo per id ASC e usiamo `id > lastId` per chunk-paging
  // (evita offset sliding mentre cancelliamo, anche se qui cancelliamo dopo).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await AuditLog.findAll({
      where: { ...where, id: { [Op.gt]: lastId } },
      order: [['id', 'ASC']],
      limit: CHUNK,
      raw: true,
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      const line = JSON.stringify(row) + '\n';
      hmac.update(line);
      gzip.write(line);
      written += 1;
      const created = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
      if (!oldestSeen || created < oldestSeen) oldestSeen = created;
      if (!newestSeen || created > newestSeen) newestSeen = created;
    }
    lastId = batch[batch.length - 1].id;
    if (batch.length < CHUNK) break;
  }

  // Chiudi il gzip e attendi flush su disco prima di scrivere il sidecar.
  await new Promise((resolve, reject) => {
    gzip.end();
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
    gzip.on('error', reject);
  });

  // Sidecar HMAC: meta + firma. Scritto come JSON per leggibilità + tooling.
  const stat = fs.statSync(basePath);
  const sidecar = {
    archive: path.basename(basePath),
    archivedCount: written,
    archiveBytes: stat.size,
    fromDate: oldestSeen ? oldestSeen.toISOString() : null,
    toDate: newestSeen ? newestSeen.toISOString() : null,
    cutoff: cutoff.toISOString(),
    generatedAt: new Date().toISOString(),
    hmacAlgo: 'HMAC-SHA256',
    hmac: hmac.digest('hex'),
  };
  fs.writeFileSync(hmacPath, JSON.stringify(sidecar, null, 2));

  logger.info(
    {
      archivedCount: written,
      archiveBytes: stat.size,
      archive: path.basename(basePath),
      fromDate: sidecar.fromDate,
      toDate: sidecar.toDate,
    },
    'audit log archived',
  );
  return { archivedCount: written, archivePath: basePath, hmacPath };
}

async function pruneAuditLog() {
  const days = getAuditRetentionDays();
  const cutoff = dayjs().subtract(days, 'day').toDate();
  try {
    // STEP 1 — Export firmato PRIMA di cancellare. Best-practice forensic:
    // se questo fallisce (disco pieno, permessi) il try/catch cattura e
    // SKIPPA la cancellazione → non si rischia di perdere audit irrecuperabili.
    let archive = null;
    try {
      archive = await archiveAuditLog(cutoff);
    } catch (err) {
      logger.error(
        { err: err.message, cutoff: cutoff.toISOString() },
        'audit log archive failed — skip prune to preserve records',
      );
      return;
    }

    // STEP 2 — Cancellazione fisica (l'archivio è sicuro su disco).
    const removed = await AuditLog.destroy({
      where: { createdAt: { [Op.lt]: cutoff } },
    });
    if (removed > 0) {
      logger.info(
        {
          removed,
          retentionDays: days,
          cutoff: cutoff.toISOString(),
          archivedCount: archive?.archivedCount ?? 0,
          archive: archive?.archivePath ? path.basename(archive.archivePath) : null,
        },
        'audit log retention sweep',
      );
      logger.info(
        `[retention] AuditLog: archiviati ${archive?.archivedCount ?? 0} record, rimossi ${removed} ` +
          `più vecchi di ${days}gg`,
      );
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
  // P2-6: la dir centralizzata `data/snapshots/` raccoglie sia gli snapshot
  // db-* sia uploads-*. Per backward-compat con installazioni precedenti
  // (che hanno la vecchia layout `data/conservatory.sqlite.pre-restore-*`
  // e `uploads.pre-restore-*`), continuiamo a sweep-are anche le vecchie
  // location: il prefix-match le identifica e una migrazione "lazy" le
  // pulisce nel tempo.
  const dirs = [
    {
      base: path.join(BACKEND_ROOT, 'data', 'snapshots'),
      prefix: 'db-',
    },
    {
      base: path.join(BACKEND_ROOT, 'data', 'snapshots'),
      prefix: 'uploads-',
    },
    // Legacy (pre-P2-6):
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
    logger.info(
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

/**
 * Cleanup outbox email: cancella le righe `mail_outbox` con status='sent'
 * più vecchie di N giorni (default 30, override via env). Le righe
 * `dead` NON vengono toccate: sono evidenze di problemi che vanno
 * ispezionati da un admin (e cancellati manualmente dalla UI).
 */
async function pruneMailOutbox() {
  const raw = Number(process.env.MAIL_OUTBOX_RETENTION_DAYS);
  const days =
    Number.isFinite(raw) && raw > 0
      ? Math.max(1, Math.floor(raw))
      : DEFAULT_MAIL_OUTBOX_RETENTION_DAYS;
  const cutoff = dayjs().subtract(days, 'day').toDate();
  try {
    const removed = await MailOutbox.destroy({
      where: {
        status: 'sent',
        sentAt: { [Op.lt]: cutoff },
      },
    });
    if (removed > 0) {
      logger.info(
        { removed, retentionDays: days, cutoff: cutoff.toISOString() },
        'mail outbox retention sweep',
      );
      logger.info(
        `[retention] mail_outbox: rimosse ${removed} righe sent più vecchie di ${days}gg`,
      );
    }
  } catch (err) {
    logger.error({ err: err.message }, 'mail outbox retention sweep failed');
  }
}

async function tick() {
  await pruneAuditLog();
  await prunePreRestoreSnapshots();
  await pruneMailOutbox();
  // P1-4: cleanup file temporanei delle integrazioni (Isidata import preview).
  // Lazy require per evitare cicli a startup; la funzione è esportata da
  // `routes/integrations.js`. È best-effort: se manca/lancia, log e continua.
  try {
    const { cleanupExpiredTmpFiles } = require('../routes/integrations');
    if (typeof cleanupExpiredTmpFiles === 'function') {
      cleanupExpiredTmpFiles();
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'integrations tmp cleanup failed');
  }
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
  logger.info(
    `[retention] scheduler avviato (sweep alle ${String(TICK_HOUR).padStart(2, '0')}:00, audit log = ${getAuditRetentionDays()}gg)`,
  );
}

function stop() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

module.exports = {
  start,
  stop,
  pruneAuditLog,
  prunePreRestoreSnapshots,
  pruneMailOutbox,
  archiveAuditLog,
  // export interno utile ai test:
  AUDIT_ARCHIVE_DIR,
};
