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
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const logger = require('../lib/logger');
const { resolvePsql } = require('../lib/pgBin');

dayjs.extend(utc);
dayjs.extend(timezone);

// I nomi-file timestamp dei tarball (es. pre-restore-20260514-0230.tar.gz)
// devono allinearsi all'ora italiana mostrata in UI/log, non al TZ del
// processo Node: su VPS UTC si chiamerebbero "0030" invece di "0230".
const TS_TZ = 'Europe/Rome';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_ROOT = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(BACKEND_ROOT, 'uploads');
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(PROJECT_ROOT, 'backups');
// P2-6: i safety-net `.pre-restore-*` ora sono raccolti in
// `data/snapshots/` invece di sporcare la app dir (`uploads.pre-restore-*`)
// e `data/` (`conservatory.sqlite.pre-restore-*`). Più facile da gitignore-are
// e da pulire con un singolo `rm -rf`.
const SNAPSHOTS_DIR = path.join(BACKEND_ROOT, 'data', 'snapshots');

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

function spawnPromiseCapture(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    p.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

/**
 * Valida i membri del tarball PRIMA di estrarli. Tar binario di per sé non
 * difende contro:
 *   - symlink che puntano fuori dalla destinazione (l'archive può contenere
 *     `link -> /etc/passwd` + un file `link/foo` che scriverebbe in /etc)
 *   - hardlink simili
 *   - path assoluti (`/etc/cron.d/x`) — preserveremmo se passassimo `-P`
 *   - path traversal con `..`
 *
 * Strategia: list verbose (`-tvzf`) per ottenere il TIPO di ogni entry
 * (primo carattere della riga: `l`=symlink, `h`=hardlink, `-`=regular,
 * `d`=directory). E list normale (`-tzf`) per i nomi affidabili. Se uno
 * qualunque criterio fallisce → throw, niente extract.
 */
async function validateTarball(archivePath) {
  const verbose = await spawnPromiseCapture('tar', ['-tvzf', archivePath]);
  const verboseLines = verbose.split('\n').filter((l) => l.trim().length > 0);
  for (const line of verboseLines) {
    const type = line.charAt(0);
    if (type === 'l') {
      throw Object.assign(new Error('Tarball contiene symlink: rifiutato per sicurezza'), {
        code: 'BACKUP_UNSAFE_SYMLINK',
      });
    }
    if (type === 'h') {
      throw Object.assign(new Error('Tarball contiene hardlink: rifiutato per sicurezza'), {
        code: 'BACKUP_UNSAFE_HARDLINK',
      });
    }
  }
  const names = await spawnPromiseCapture('tar', ['-tzf', archivePath]);
  const entries = names.split('\n').filter((l) => l.length > 0);
  for (const entry of entries) {
    if (entry.startsWith('/') || entry.startsWith('~')) {
      throw Object.assign(new Error(`Tarball contiene path assoluto: ${entry}`), {
        code: 'BACKUP_UNSAFE_PATH',
      });
    }
    // path.normalize collassa `..` interni; confrontiamo che il risultato
    // resti relativo (no leading `..`, nessun salto fuori).
    const norm = path.normalize(entry);
    if (norm.startsWith('..') || path.isAbsolute(norm)) {
      throw Object.assign(new Error(`Tarball contiene path-traversal: ${entry}`), {
        code: 'BACKUP_UNSAFE_PATH',
      });
    }
  }
}

function ts() {
  // Timestamp filename in Europe/Rome: indipendente dal TZ del processo
  // così i nomi-file restano coerenti con l'orario locale dell'istituto.
  return dayjs().tz(TS_TZ).format('YYYYMMDD-HHmmss');
}

/** Ritorna `true` se attualmente è in corso un restore (single-flight). */
function isRestoreInProgress() {
  return restoreInProgress;
}

/**
 * Walk ricorsivo che rifiuta qualunque symlink incontrato nell'albero.
 * Difesa-in-profondità: validateTarball già lo rileva pre-extract, ma se
 * mai un symlink venisse creato (es. tarball confeziato in modo da bypassare
 * il list parsing), questo lo intercetta prima di un cpSync ricorsivo.
 */
function verifyTreeNoSymlinks(root) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        throw Object.assign(new Error(`Symlink rilevato durante restore: ${full}`), {
          code: 'BACKUP_UNSAFE_SYMLINK',
        });
      }
      if (e.isDirectory()) stack.push(full);
    }
  }
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
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-rst-'));
  let savedDbBackup = null;
  let savedUploadsBackup = null;
  try {
    logger.info({ archivePath }, '[restore] validazione contenuto archivio');
    await validateTarball(archivePath);
    logger.info({ archivePath }, '[restore] avvio estrazione');
    // Flag di sicurezza:
    //   --no-same-owner       : i file estratti non preservano UID/GID dell'archivio
    //   --no-same-permissions : permessi normalizzati al umask del processo
    // Senza `-P` (=preserve absolute paths), tar strippa lo slash iniziale
    // dai path assoluti — comunque ridondante, validateTarball li ha già
    // bloccati in pre-check.
    await spawnPromise('tar', [
      '-xzf',
      archivePath,
      '-C',
      stagingDir,
      '--no-same-owner',
      '--no-same-permissions',
    ]);

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
      // Difesa-in-profondità: validateTarball già rifiuta symlink, ma in
      // caso di bug nel parsing rilevamo qui un eventuale link prima di
      // copiarne il contenuto.
      if (fs.lstatSync(src).isSymbolicLink()) {
        throw new Error('conservatory.sqlite è un symlink: rifiutato');
      }
      const target = path.join(BACKEND_ROOT, 'data', 'conservatory.sqlite');
      if (fs.existsSync(target)) {
        // P2-6: snapshot raccolto in data/snapshots/db-<ts>.sqlite invece di
        // restare accanto al DB live nella stessa dir.
        fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
        const bak = path.join(SNAPSHOTS_DIR, `db-${stamp}.sqlite`);
        fs.renameSync(target, bak);
        savedDbBackup = path.relative(BACKEND_ROOT, bak);
        logger.info({ bak }, '[restore] DB attuale spostato in snapshots/');
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
      if (fs.lstatSync(sqlPath).isSymbolicLink()) {
        throw new Error('database.sql è un symlink: rifiutato');
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
      if (fs.lstatSync(srcUploads).isSymbolicLink()) {
        throw new Error('uploads/ è un symlink: rifiutato');
      }
      if (fs.existsSync(UPLOADS_DIR)) {
        // P2-6: snapshot uploads in data/snapshots/uploads-<ts>/ invece che
        // accanto a /uploads (sporcando la app dir come `uploads.pre-restore-*`).
        fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
        const bak = path.join(SNAPSHOTS_DIR, `uploads-${stamp}`);
        fs.renameSync(UPLOADS_DIR, bak);
        savedUploadsBackup = path.relative(BACKEND_ROOT, bak);
        logger.info({ bak }, '[restore] uploads attuali spostati in snapshots/');
      }
      // dereference: false è il default ma lo rendiamo esplicito — un
      // symlink dentro uploads/ verrebbe copiato come symlink (non
      // dereferenziato), ma `verifyTreeNoSymlinks` qui sotto rifiuta
      // l'intero restore se ne trova uno.
      verifyTreeNoSymlinks(srcUploads);
      fs.cpSync(srcUploads, UPLOADS_DIR, { recursive: true, dereference: false });
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
