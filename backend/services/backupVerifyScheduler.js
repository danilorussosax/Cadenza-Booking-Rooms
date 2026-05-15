'use strict';

/**
 * Scheduler weekly che verifica l'integrita' dell'ultimo backup creato
 * da `backupScheduler`. Tick configurato di default a domenica 03:00
 * (Europe/Rome) — 30 min dopo il backup nightly.
 *
 * Approccio "shallow ma sostanziale": niente CREATEDB / pg_restore
 * (richiederebbero privilegi DB elevati + scratch DB management +
 * 30-60s per ciclo). Verifica invece:
 *
 *  1) Esiste un backup recente (eta' < BACKUP_VERIFY_MAX_AGE_HOURS, default 36h)
 *  2) Tarball strutturalmente safe (no symlinks, no path traversal —
 *     riusa `validateTarball` di backupRestore.js)
 *  3) manifest.json estraibile e parseabile, contiene i campi attesi
 *  4) database.sql ha size > MIN_SQL_BYTES (default 1024)
 *  5) Il dump contiene CREATE TABLE per tutte le tabelle critiche
 *     (Users, Bookings, Rooms, Buildings)
 *  6) Il dump ha almeno una sezione dati (COPY o INSERT INTO)
 *  7) Numero di CREATE TABLE nel dump entro ±BACKUP_VERIFY_TABLE_TOLERANCE
 *     rispetto a `information_schema.tables` di prod (default ±2)
 *
 * Mail admin solo se ALMENO una verifica fallisce (silent-on-success).
 * Failure modes catturati: backup mancante/vecchio, file corrotto,
 * gzip/tar truncato, dump senza tabelle critiche (es. pg_dump morto a
 * meta'), dump senza dati, schema disallineato.
 *
 * Failure modes NON catturati: errori SQL logici nel dump (es. dati
 * referenzialmente inconsistenti). Catturarli richiederebbe restore
 * vero — futura estensione "deep verify" se serve.
 *
 * Configurazione (env-only, no UI per ora):
 *   BACKUP_VERIFY_ENABLED         default true
 *   BACKUP_VERIFY_DAY             0-6 (0=domenica), default 0
 *   BACKUP_VERIFY_HOUR            0-23, default 3
 *   BACKUP_VERIFY_MINUTE          0-59, default 0
 *   BACKUP_VERIFY_MAX_AGE_HOURS   default 36
 *   BACKUP_VERIFY_MIN_SQL_BYTES   default 1024
 *   BACKUP_VERIFY_TABLE_TOLERANCE default 2 (±N tabelle differenza accettata)
 *
 * Stato esposto via `getStatus()` consumato da `opsSnapshot.gatherSchedulers`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const SCHEDULER_TZ = 'Europe/Rome';
const logger = require('../lib/logger').child({ scope: 'backupVerify' });
const { listBackups, BACKUP_DIR } = require('../scripts/backup');
const { validateTarball } = require('./backupRestore');
const { sequelize, MailOutbox } = require('../models');

const CRITICAL_TABLES = ['Users', 'Bookings', 'Rooms', 'Buildings'];

let timer = null;
let inProgress = false;
let lastRun = null;

// ─────────────────────────────────────────────────────────────────────────────
// Config

function envBool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return v === '1' || v.toLowerCase() === 'true';
}

function envInt(name, def, min, max) {
  const v = parseInt(process.env[name] ?? '', 10);
  if (Number.isNaN(v)) return def;
  if (typeof min === 'number' && v < min) return def;
  if (typeof max === 'number' && v > max) return def;
  return v;
}

function getConfig() {
  return {
    enabled: envBool('BACKUP_VERIFY_ENABLED', true),
    dayOfWeek: envInt('BACKUP_VERIFY_DAY', 0, 0, 6),
    hour: envInt('BACKUP_VERIFY_HOUR', 3, 0, 23),
    minute: envInt('BACKUP_VERIFY_MINUTE', 0, 0, 59),
    maxAgeHours: envInt('BACKUP_VERIFY_MAX_AGE_HOURS', 36, 1, 24 * 30),
    minSqlBytes: envInt('BACKUP_VERIFY_MIN_SQL_BYTES', 1024, 1, 10 * 1024 * 1024),
    tableTolerance: envInt('BACKUP_VERIFY_TABLE_TOLERANCE', 2, 0, 100),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling

function nextRunDelayMs() {
  const cfg = getConfig();
  const now = dayjs().tz(SCHEDULER_TZ);
  // Prossimo `cfg.dayOfWeek` alle hh:mm. Se oggi e' quel giorno e l'orario
  // e' gia' passato → prossima settimana.
  let target = now.day(cfg.dayOfWeek).hour(cfg.hour).minute(cfg.minute).second(0).millisecond(0);
  if (target.isBefore(now)) target = target.add(7, 'day');
  return target.diff(now);
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  const cfg = getConfig();
  if (!cfg.enabled) {
    timer = null;
    return;
  }
  timer = setTimeout(tick, nextRunDelayMs());
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification logic

async function spawnPromiseCapture(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => (out += c.toString()));
    p.stderr.on('data', (c) => (err += c.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err}`));
    });
  });
}

/**
 * Estrae solo `manifest.json` e `database.sql` dal tarball in una
 * directory temporanea, senza toccare `uploads/`. Ritorna i path.
 */
async function extractRelevant(archivePath, stagingDir) {
  // tar accetta path relativi specifici; estraiamo solo i due che ci
  // servono per ridurre I/O (uploads/* puo' essere centinaia di MB).
  await spawnPromiseCapture('tar', [
    '-xzf',
    archivePath,
    '-C',
    stagingDir,
    'manifest.json',
    'database.sql',
  ]);
  return {
    manifestPath: path.join(stagingDir, 'manifest.json'),
    sqlPath: path.join(stagingDir, 'database.sql'),
  };
}

/**
 * Conta le tabelle "user" (non-system) in prod via information_schema.
 * Funziona solo su Postgres. Per altri dialect ritorna null e si saltano
 * i check schema-based.
 */
async function countProdTables() {
  const dialect = sequelize.getDialect();
  if (dialect !== 'postgres') return null;
  const [rows] = await sequelize.query(
    `SELECT COUNT(*)::int AS n
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'`,
  );
  return rows[0]?.n ?? null;
}

/**
 * Esegue tutte le verifiche sull'ultimo backup. Ritorna un report con
 * `ok: boolean` e una lista di `checks` con esito per ognuna. Mai throw —
 * gli errori finiscono come check fallito.
 */
async function verify() {
  const cfg = getConfig();
  const checks = [];
  const pushCheck = (name, ok, detail) => checks.push({ name, ok, ...(detail ? { detail } : {}) });

  // 1) backup recente esiste
  const items = listBackups();
  if (items.length === 0) {
    pushCheck('latest_backup_exists', false, 'nessun backup presente in BACKUP_DIR');
    return { ok: false, reason: 'no_backups', checks };
  }
  const latest = items[0];
  const latestPath = path.join(BACKUP_DIR, latest.file);
  pushCheck('latest_backup_exists', true, latest.file);

  // 2) eta'
  const ageHours = (Date.now() - new Date(latest.createdAt).getTime()) / 3_600_000;
  const ageOk = ageHours <= cfg.maxAgeHours;
  pushCheck('age_within_threshold', ageOk, `${ageHours.toFixed(1)}h vs ${cfg.maxAgeHours}h max`);
  if (!ageOk) {
    return { ok: false, reason: 'stale', ageHours, checks };
  }

  // 3) file size minimo
  const sizeOk = latest.sizeBytes > 1024;
  pushCheck('archive_size_ok', sizeOk, `${latest.sizeBytes}B`);
  if (!sizeOk) {
    return { ok: false, reason: 'archive_too_small', size: latest.sizeBytes, checks };
  }

  // 4) tarball safety + struttura
  try {
    await validateTarball(latestPath);
    pushCheck('tarball_safe', true);
  } catch (err) {
    pushCheck('tarball_safe', false, err.message);
    return { ok: false, reason: 'unsafe_tarball', checks };
  }

  // 5) estrai manifest + database.sql in staging
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-verify-'));
  try {
    let manifestPath, sqlPath;
    try {
      ({ manifestPath, sqlPath } = await extractRelevant(latestPath, staging));
      pushCheck('extract_relevant_entries', true);
    } catch (err) {
      pushCheck('extract_relevant_entries', false, err.message);
      return { ok: false, reason: 'extract_failed', checks };
    }

    // 6) manifest parsabile + campi attesi
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      const hasContents = Array.isArray(manifest.contents) && manifest.contents.includes('db');
      pushCheck('manifest_valid', hasContents, `version=${manifest.version}`);
      if (!hasContents) {
        return { ok: false, reason: 'manifest_missing_db', checks };
      }
    } catch (err) {
      pushCheck('manifest_valid', false, err.message);
      return { ok: false, reason: 'manifest_unparseable', checks };
    }

    // 7) database.sql size + contenuti
    const sqlStat = fs.statSync(sqlPath);
    const sqlSizeOk = sqlStat.size >= cfg.minSqlBytes;
    pushCheck('sql_size_ok', sqlSizeOk, `${sqlStat.size}B vs ${cfg.minSqlBytes}B min`);
    if (!sqlSizeOk) {
      return { ok: false, reason: 'sql_too_small', sqlSize: sqlStat.size, checks };
    }

    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // 8) CREATE TABLE per le tabelle critiche
    const missingTables = [];
    for (const t of CRITICAL_TABLES) {
      // pg_dump emette nomi quoted: CREATE TABLE public."Users" oppure
      // CREATE TABLE "Users". Match permissivo su entrambi.
      const re = new RegExp(`CREATE TABLE\\s+(public\\.)?"?${t}"?\\s*\\(`, 'i');
      if (!re.test(sqlContent)) missingTables.push(t);
    }
    pushCheck(
      'critical_tables_present',
      missingTables.length === 0,
      missingTables.length > 0 ? `mancanti: ${missingTables.join(', ')}` : 'tutte presenti',
    );
    if (missingTables.length > 0) {
      return { ok: false, reason: 'critical_tables_missing', missingTables, checks };
    }

    // 9) ha dati (COPY o INSERT)
    const hasData =
      /\bCOPY\s+\S+\s+\([^)]+\)\s+FROM\s+stdin/i.test(sqlContent) ||
      /INSERT\s+INTO\s+/i.test(sqlContent);
    pushCheck('has_data_section', hasData, hasData ? 'COPY/INSERT trovati' : 'nessun dato');
    if (!hasData) {
      return { ok: false, reason: 'no_data_section', checks };
    }

    // 10) count tabelle dump vs prod (entro tolleranza)
    const dumpTableCount = (sqlContent.match(/CREATE TABLE/gi) || []).length;
    const prodTableCount = await countProdTables();
    if (prodTableCount != null) {
      const diff = Math.abs(dumpTableCount - prodTableCount);
      const tableCountOk = diff <= cfg.tableTolerance;
      pushCheck(
        'table_count_aligned',
        tableCountOk,
        `dump=${dumpTableCount} prod=${prodTableCount} diff=${diff} (max ${cfg.tableTolerance})`,
      );
      if (!tableCountOk) {
        return { ok: false, reason: 'schema_drift', dumpTableCount, prodTableCount, checks };
      }
    } else {
      pushCheck('table_count_aligned', true, 'skip (non-postgres dialect)');
    }

    return {
      ok: true,
      file: latest.file,
      ageHours: Math.round(ageHours * 10) / 10,
      checks,
    };
  } finally {
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch {
      /* swallow cleanup errors */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mail alert

async function sendAlertEmail(report) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.MAIL_FROM;
    if (!adminEmail) {
      logger.warn('[verify] nessun ADMIN_EMAIL/MAIL_FROM configurato — skip alert');
      return;
    }
    const checksHtml = report.checks
      .map(
        (c) =>
          `<li>${c.ok ? '✓' : '✗'} <code>${c.name}</code>${
            c.detail ? ` — ${escapeHtml(c.detail)}` : ''
          }</li>`,
      )
      .join('\n');
    const subject = `[Cadenza] Backup integrity check FAILED (${report.reason ?? 'unknown'})`;
    const bodyHtml = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<h2 style="color:#b91c1c">⚠️ Verifica backup fallita</h2>
<p>La verifica settimanale dell'ultimo backup ha rilevato un problema.</p>
<table style="border-collapse:collapse;margin:12px 0">
<tr><td style="padding:4px 12px 4px 0"><b>Reason</b></td><td><code>${escapeHtml(
      report.reason ?? 'unknown',
    )}</code></td></tr>
<tr><td style="padding:4px 12px 4px 0"><b>Date</b></td><td>${new Date().toISOString()}</td></tr>
</table>
<h3>Check details</h3>
<ul style="font-family:ui-monospace,monospace;font-size:13px">
${checksHtml}
</ul>
<p>Azione consigliata: verifica subito <code>/admin/ops</code> (widget Backup integrity)
e i log dello scheduler. Se serve, esegui un backup manuale dalla pagina admin
Backup e rilancia la verifica.</p>
</body></html>`;
    // idempotencyKey per giorno+reason: stessa failure replicata nello stesso
    // giorno non genera doppia mail (UNIQUE constraint del MailOutbox).
    const dayKey = new Date().toISOString().slice(0, 10);
    await MailOutbox.create({
      kind: 'security',
      to: adminEmail,
      subject,
      bodyHtml,
      priority: 0, // critica: prima nella coda
      idempotencyKey: `backup_verify_fail:${dayKey}:${report.reason ?? 'unknown'}`,
      status: 'pending',
    });
    logger.warn({ reason: report.reason }, '[verify] alert email enqueued');
  } catch (err) {
    // Una sequelize UniqueConstraintError sull'idempotencyKey e' attesa
    // se la stessa failure si ripresenta in giornata — non logghiamo errore.
    if (err.name === 'SequelizeUniqueConstraintError') {
      logger.info({ reason: report.reason }, "[verify] alert email gia' inviata oggi (dedup)");
      return;
    }
    logger.error({ err: err.message }, '[verify] failed to enqueue alert email');
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API

async function tick() {
  if (inProgress) {
    logger.warn('[verify] tick skipped — verifica precedente ancora in corso');
    scheduleNext();
    return;
  }
  inProgress = true;
  const startedAt = Date.now();
  try {
    logger.info('[verify] tick automatico in esecuzione…');
    const report = await verify();
    const durationMs = Date.now() - startedAt;
    lastRun = {
      ok: report.ok,
      reason: report.reason ?? null,
      file: report.file ?? null,
      ageHours: report.ageHours ?? null,
      checks: report.checks,
      durationMs,
      finishedAt: new Date().toISOString(),
    };
    if (report.ok) {
      logger.info(
        { file: report.file, durationMs },
        `[verify] ✓ ultimo backup OK (${(durationMs / 1000).toFixed(1)}s)`,
      );
    } else {
      logger.error(
        { reason: report.reason, checks: report.checks },
        `[verify] ✗ verifica FALLITA — invio alert email`,
      );
      await sendAlertEmail(report);
    }
  } catch (err) {
    lastRun = {
      ok: false,
      reason: 'scheduler_exception',
      error: err.message || String(err),
      durationMs: Date.now() - startedAt,
      finishedAt: new Date().toISOString(),
    };
    logger.error({ err: err.message }, '[verify] tick crashed — non blocca tick successivi');
  } finally {
    inProgress = false;
    scheduleNext();
  }
}

async function start() {
  if (timer) return; // idempotente
  // PM2 cluster mode: solo l'istanza 0 esegue gli scheduler (vedi clusterRole.js).
  if (!require('../lib/clusterRole').isSchedulerMaster()) {
    logger.info('[verify] scheduler skipped — non-master cluster instance');
    return;
  }
  const cfg = getConfig();
  if (!cfg.enabled) {
    logger.info('[verify] scheduler DISABILITATO (BACKUP_VERIFY_ENABLED=false)');
    return;
  }
  scheduleNext();
  const dayName = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'][cfg.dayOfWeek];
  const hh = String(cfg.hour).padStart(2, '0');
  const mm = String(cfg.minute).padStart(2, '0');
  logger.info(`[verify] scheduler avviato (tick ${dayName} alle ${hh}:${mm} ${SCHEDULER_TZ})`);
}

function stop() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Per `opsSnapshot.gatherSchedulers` e widget /admin/ops. */
function getStatus() {
  const cfg = getConfig();
  return {
    name: 'backupVerify',
    enabled: cfg.enabled && timer != null,
    running: inProgress,
    intervalMs: 7 * 24 * 60 * 60 * 1000,
    lastTickAt: lastRun?.finishedAt ?? null,
    lastError: lastRun && !lastRun.ok ? (lastRun.reason ?? lastRun.error ?? 'unknown') : null,
    nextTickAt: timer ? new Date(Date.now() + nextRunDelayMs()).toISOString() : null,
    lastRun,
  };
}

module.exports = { start, stop, tick, verify, getStatus };
