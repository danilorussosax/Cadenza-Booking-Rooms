#!/usr/bin/env node
'use strict';

/**
 * Cadenza — backup script.
 *
 * Crea un archivio backups/backup-YYYY-MM-DD-HHmm.tar.gz contenente:
 *   - SQLite: snapshot atomico del DB (VACUUM INTO) + cartella uploads
 *   - Postgres: dump SQL via pg_dump + cartella uploads
 *
 * Usabile come modulo (`require('./backup').performBackup()`) o da CLI:
 *   $ node backend/scripts/backup.js
 *   $ npm run backup
 *
 * Variabili env opzionali:
 *   BACKUP_DIR      → dove salvare i file (default: project_root/backups)
 *   BACKUP_KEEP_DAILY   (default 30)
 *   BACKUP_KEEP_WEEKLY  (default 12)
 *   BACKUP_KEEP_MONTHLY (default 12)
 *
 * La rotazione mantiene UN backup per giorno (ultimi 30), uno per
 * settimana ISO (ultime 12) e uno per mese (ultimi 12). Tutti gli altri
 * vengono eliminati al termine di ogni run.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_ROOT = path.resolve(__dirname, '..');

const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(PROJECT_ROOT, 'backups');
const UPLOADS_DIR = path.join(BACKEND_ROOT, 'uploads');

const KEEP_DAILY = Number(process.env.BACKUP_KEEP_DAILY || 30);
const KEEP_WEEKLY = Number(process.env.BACKUP_KEEP_WEEKLY || 12);
const KEEP_MONTHLY = Number(process.env.BACKUP_KEEP_MONTHLY || 12);

const FILENAME_REGEX = /^backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.tar\.gz$/;

// ─────────────────────────────────────────────────────────────────────
// Util
// ─────────────────────────────────────────────────────────────────────

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestamp(date = new Date()) {
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes())
  );
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function spawnPromise(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function isoWeekKey(date) {
  // ISO week numbering: Monday = day 1
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(weekNo)}`;
}

function parseFilenameDate(filename) {
  const m = FILENAME_REGEX.exec(filename);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:00`);
}

// ─────────────────────────────────────────────────────────────────────
// Backup engines
// ─────────────────────────────────────────────────────────────────────

async function backupSqlite(stagingDir) {
  // Lazy require — solo quando serve, evita di toccare il DB se non SQLite
  const { sequelize } = require('../models');
  const targetDb = path.join(stagingDir, 'conservatory.sqlite');
  // VACUUM INTO produce uno snapshot atomico anche se il DB è in uso
  await sequelize.query(`VACUUM INTO '${targetDb.replace(/'/g, "''")}'`);
}

const { resolvePgDump } = require('../lib/pgBin');

async function backupPostgres(stagingDir) {
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const user = process.env.DB_USER;
  const database = process.env.DB_NAME;
  const password = process.env.DB_PASSWORD;
  if (!user || !database) {
    throw new Error('DB_USER e DB_NAME devono essere definiti per il backup Postgres');
  }
  const sqlPath = path.join(stagingDir, 'database.sql');
  const pgDump = resolvePgDump();
  try {
    await spawnPromise(
      pgDump,
      [
        '-h',
        host,
        '-p',
        String(port),
        '-U',
        user,
        '-d',
        database,
        '--no-owner',
        '--no-acl',
        '--clean',
        '--if-exists',
        '-f',
        sqlPath,
      ],
      { env: { ...process.env, PGPASSWORD: password || '' } },
    );
  } catch (err) {
    if (err.code === 'ENOENT') {
      const e = new Error(
        `pg_dump non trovato. Imposta PG_DUMP_PATH nell'env per indicarne il path completo (es. /Library/PostgreSQL/18/bin/pg_dump), oppure aggiungi la directory bin di Postgres al PATH del processo Node.`,
      );
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Rotation
// ─────────────────────────────────────────────────────────────────────

function rotate(opts = {}) {
  // Override runtime: i tre KEEP_* sono catturati a load-time da env;
  // l'admin può sovrascriverli da UI passando { keepDaily, keepWeekly, keepMonthly }.
  const keepDaily = Number.isFinite(opts.keepDaily) ? opts.keepDaily : KEEP_DAILY;
  const keepWeekly = Number.isFinite(opts.keepWeekly) ? opts.keepWeekly : KEEP_WEEKLY;
  const keepMonthly = Number.isFinite(opts.keepMonthly) ? opts.keepMonthly : KEEP_MONTHLY;

  if (!fs.existsSync(BACKUP_DIR)) return { kept: [], deleted: [] };

  const all = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => FILENAME_REGEX.test(f))
    .map((name) => ({ name, date: parseFilenameDate(name) }))
    .filter((f) => f.date)
    .sort((a, b) => b.date - a.date);

  const keep = new Set();
  const groupBy = (items, keyFn, max) => {
    const seen = new Map();
    for (const it of items) {
      const k = keyFn(it.date);
      if (!seen.has(k)) {
        seen.set(k, it);
        if (seen.size >= max) break;
      }
    }
    return [...seen.values()];
  };

  groupBy(all, (d) => d.toISOString().slice(0, 10), keepDaily).forEach((it) => keep.add(it.name));
  groupBy(all, isoWeekKey, keepWeekly).forEach((it) => keep.add(it.name));
  groupBy(all, (d) => d.toISOString().slice(0, 7), keepMonthly).forEach((it) => keep.add(it.name));

  const deleted = [];
  for (const it of all) {
    if (!keep.has(it.name)) {
      fs.unlinkSync(path.join(BACKUP_DIR, it.name));
      deleted.push(it.name);
    }
  }
  return { kept: [...keep], deleted };
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function performBackup(opts = {}) {
  ensureDir(BACKUP_DIR);

  const dialect = (process.env.DB_DIALECT || 'sqlite').toLowerCase();
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-bkp-'));
  const outputName = `backup-${timestamp()}.tar.gz`;
  const outputPath = path.join(BACKUP_DIR, outputName);

  try {
    // 1. dump del DB nello staging
    if (dialect === 'sqlite') {
      await backupSqlite(stagingDir);
    } else if (dialect === 'postgres') {
      await backupPostgres(stagingDir);
    } else {
      throw new Error(`Dialetto DB non supportato: ${dialect}`);
    }

    // 2. copia uploads (se esiste)
    if (fs.existsSync(UPLOADS_DIR)) {
      const target = path.join(stagingDir, 'uploads');
      fs.cpSync(UPLOADS_DIR, target, { recursive: true });
    }

    // 3. manifest
    fs.writeFileSync(
      path.join(stagingDir, 'manifest.json'),
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          dialect,
          contents: ['db', 'uploads', 'manifest'],
          appVersion: require('../package.json').version,
        },
        null,
        2,
      ),
    );

    // 4. tar.gz
    await spawnPromise('tar', ['-czf', outputPath, '-C', stagingDir, '.']);

    // 5. rotazione (override runtime di keep* dalla UI quando passati)
    const rot = rotate({
      keepDaily: opts.keepDaily,
      keepWeekly: opts.keepWeekly,
      keepMonthly: opts.keepMonthly,
    });

    const stats = fs.statSync(outputPath);
    const result = {
      file: outputName,
      path: outputPath,
      sizeBytes: stats.size,
      dialect,
      kept: rot.kept.length,
      deleted: rot.deleted,
    };
    return result;
  } finally {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => FILENAME_REGEX.test(f))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return {
        file: f,
        sizeBytes: stat.size,
        createdAt: parseFilenameDate(f)?.toISOString() ?? stat.mtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function deleteBackup(filename) {
  if (!FILENAME_REGEX.test(filename)) {
    throw new Error('Nome file non valido');
  }
  const fp = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(fp)) throw new Error('File non trovato');
  fs.unlinkSync(fp);
}

module.exports = {
  performBackup,
  listBackups,
  deleteBackup,
  rotate,
  BACKUP_DIR,
  KEEP_DAILY,
  KEEP_WEEKLY,
  KEEP_MONTHLY,
};

// ─────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const startedAt = Date.now();
  console.log(`[backup] inizio · destinazione: ${BACKUP_DIR}`);
  performBackup()
    .then((res) => {
      const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
      const sizeMb = (res.sizeBytes / 1024 / 1024).toFixed(2);
      console.log(`[backup] ✓ ${res.file} (${sizeMb} MB · ${dur}s)`);
      if (res.deleted.length) {
        console.log(`[backup] rimossi ${res.deleted.length} file obsoleti dalla rotazione`);
      }
    })
    .catch((err) => {
      console.error('[backup] ✗ errore:', err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        const { sequelize } = require('../models');
        await sequelize.close();
      } catch {
        /* ignore */
      }
    });
}
