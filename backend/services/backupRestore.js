'use strict';

/**
 * Restore programmatico dei backup creati da scripts/backup.js.
 * Estrae l'archivio tar.gz, legge il manifest, sostituisce DB e uploads
 * con safety-net (`.pre-restore-<ts>` per la versione precedente).
 *
 * NB: il restore di un database mentre il backend è in esecuzione è
 * INTRINSECAMENTE rischioso. Pattern raccomandato:
 *   1. Eseguire il restore via questo modulo (lascia il pool sequelize
 *      aperto: per SQLite scrive sul file, Postgres usa psql diretto).
 *   2. Dopo il return, il caller (routes/backups.js) chiama
 *      `process.exit(0)` con piccolo delay → systemd/pm2 riavvia.
 *
 * Lock: `restoreInProgress` impedisce restore concorrenti.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../lib/logger');
const { resolvePsql } = require('../lib/pgBin');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_ROOT = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(BACKEND_ROOT, 'uploads');
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(PROJECT_ROOT, 'backups');

let restoreInProgress = false;

function spawnPromise(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stderr = '';
    p.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/** Ritorna `true` se attualmente è in corso un restore (single-flight). */
function isRestoreInProgress() {
  return restoreInProgress;
}

/**
 * Esegue il restore di un archivio.
 *
 * @param {object} opts
 * @param {string} opts.archivePath  Path assoluto del file tar.gz
 * @param {boolean} [opts.dryRun]    Solo lettura del manifest (no scritture)
 * @returns {Promise<{ok, manifest, restored: {db, uploads, savedDbBackup, savedUploadsBackup}}>}
 */
async function performRestore({ archivePath, dryRun = false }) {
  if (restoreInProgress) {
    const err = new Error('Restore già in corso');
    err.code = 'RESTORE_IN_PROGRESS';
    throw err;
  }
  if (!fs.existsSync(archivePath)) {
    const err = new Error(`Archivio non trovato: ${archivePath}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  restoreInProgress = true;
  const startedAt = Date.now();
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aulabook-rst-'));
  let savedDbBackup = null;
  let savedUploadsBackup = null;
  try {
    logger.info({ archivePath }, '[restore] avvio estrazione');
    await spawnPromise('tar', ['-xzf', archivePath, '-C', stagingDir]);

    let manifest = { dialect: 'sqlite' };
    const manifestPath = path.join(stagingDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    logger.info({ manifest }, '[restore] manifest letto');

    if (dryRun) {
      return { ok: true, manifest, restored: null, dryRun: true };
    }

    const stamp = ts();
    let restoredDb = false;
    let restoredUploads = false;

    // ── DB restore ─────────────────────────────────────────────
    if (manifest.dialect === 'sqlite' || !manifest.dialect) {
      const src = path.join(stagingDir, 'conservatory.sqlite');
      if (!fs.existsSync(src)) {
        throw new Error('Archivio non contiene conservatory.sqlite');
      }
      const target = path.join(BACKEND_ROOT, 'data', 'conservatory.sqlite');
      if (fs.existsSync(target)) {
        const bak = `${target}.pre-restore-${stamp}`;
        fs.renameSync(target, bak);
        savedDbBackup = path.basename(bak);
        logger.info({ bak }, '[restore] DB attuale salvato come .pre-restore');
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
      }
      fs.copyFileSync(src, target);
      restoredDb = true;
      logger.info({ target }, '[restore] DB SQLite ripristinato');
    } else if (manifest.dialect === 'postgres') {
      const sqlPath = path.join(stagingDir, 'database.sql');
      if (!fs.existsSync(sqlPath)) {
        throw new Error('Archivio non contiene database.sql');
      }
      const host = process.env.DB_HOST || 'localhost';
      const port = process.env.DB_PORT || '5432';
      const user = process.env.DB_USER;
      const database = process.env.DB_NAME;
      const password = process.env.DB_PASSWORD;
      if (!user || !database) {
        throw new Error('DB_USER e DB_NAME richiesti per restore Postgres');
      }
      logger.info({ host, port, database }, '[restore] avvio psql restore');
      const psql = resolvePsql();
      try {
        await spawnPromise(
          psql,
          [
            '-h',
            host,
            '-p',
            String(port),
            '-U',
            user,
            '-d',
            database,
            '-v',
            'ON_ERROR_STOP=1',
            '-q',
            '-f',
            sqlPath,
          ],
          { env: { ...process.env, PGPASSWORD: password || '' } },
        );
      } catch (err) {
        if (err.code === 'ENOENT' || /ENOENT/.test(err.message || '')) {
          throw new Error(
            "psql non trovato. Imposta PSQL_PATH nell'env per indicarne il path completo (es. /Library/PostgreSQL/18/bin/psql), oppure aggiungi la directory bin di Postgres al PATH del processo Node.",
          );
        }
        throw err;
      }
      restoredDb = true;
      // Per Postgres NON salviamo un .pre-restore: la dump conteneva DROP+CREATE.
      // L'unica salvaguardia è eseguire un backup PRIMA del restore (vedi route).
      logger.info('[restore] DB Postgres ripristinato');
    } else {
      throw new Error(`Dialect non supportato: ${manifest.dialect}`);
    }

    // ── Uploads restore ───────────────────────────────────────
    const srcUploads = path.join(stagingDir, 'uploads');
    if (fs.existsSync(srcUploads)) {
      if (fs.existsSync(UPLOADS_DIR)) {
        const bak = `${UPLOADS_DIR}.pre-restore-${stamp}`;
        fs.renameSync(UPLOADS_DIR, bak);
        savedUploadsBackup = path.basename(bak);
        logger.info({ bak }, '[restore] uploads attuali salvati come .pre-restore');
      }
      fs.cpSync(srcUploads, UPLOADS_DIR, { recursive: true });
      restoredUploads = true;
      logger.info({ UPLOADS_DIR }, '[restore] uploads ripristinati');
    }

    const durationMs = Date.now() - startedAt;
    logger.info({ durationMs }, '[restore] completato');
    return {
      ok: true,
      manifest,
      restored: {
        db: restoredDb,
        uploads: restoredUploads,
        savedDbBackup,
        savedUploadsBackup,
      },
      durationMs,
    };
  } finally {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    restoreInProgress = false;
  }
}

module.exports = {
  performRestore,
  isRestoreInProgress,
  BACKUP_DIR,
  UPLOADS_DIR,
};
