#!/usr/bin/env node
'use strict';

/**
 * Cadenza — restore script.
 *
 * Ripristina un archivio backup-YYYY-MM-DD-HHmm.tar.gz creato da backup.js.
 * Usage:
 *   node backend/scripts/restore.js backups/backup-2026-04-25-1900.tar.gz
 *   npm run restore -- backups/backup-2026-04-25-1900.tar.gz
 *
 * IMPORTANTE: ferma il backend prima di eseguire il restore. Il file DB
 * corrente verrà rinominato con suffisso .pre-restore-<timestamp> per
 * sicurezza, e SOLO POI sovrascritto.
 *
 * Conferma esplicita richiesta: passare anche il flag --yes per saltarla.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_ROOT = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(BACKEND_ROOT, 'uploads');

function spawnPromise(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
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

async function confirm(msg) {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${msg} (digita "RESTORE" per confermare): `, (a) => {
      rl.close();
      resolve(a.trim() === 'RESTORE');
    });
  });
}

async function main() {
  const archive = process.argv.find((a) => a.endsWith('.tar.gz'));
  if (!archive) {
    console.error('Usage: node restore.js <path/to/backup.tar.gz> [--yes]');
    process.exit(1);
  }
  const archivePath = path.resolve(archive);
  if (!fs.existsSync(archivePath)) {
    console.error(`Archivio non trovato: ${archivePath}`);
    process.exit(1);
  }

  console.log(`[restore] archivio: ${archivePath}`);
  console.log('[restore] estrazione in cartella temporanea…');
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-rst-'));
  await spawnPromise('tar', ['-xzf', archivePath, '-C', stagingDir]);

  // Lettura manifest
  let manifest = { dialect: 'sqlite' };
  const manifestPath = path.join(stagingDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
  console.log(`[restore] manifest dialect=${manifest.dialect} createdAt=${manifest.createdAt}`);

  const ok = await confirm(
    'ATTENZIONE: il database e la cartella uploads attuali verranno sostituiti. Procedere?',
  );
  if (!ok) {
    console.log('[restore] annullato');
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return;
  }

  const stamp = ts();

  // ── Restore DB ──────────────────────────────────────────────
  if (manifest.dialect === 'sqlite' || !manifest.dialect) {
    const src = path.join(stagingDir, 'conservatory.sqlite');
    if (!fs.existsSync(src)) throw new Error('Archivio non contiene conservatory.sqlite');
    const target = path.join(BACKEND_ROOT, 'data', 'conservatory.sqlite');
    if (fs.existsSync(target)) {
      const bak = `${target}.pre-restore-${stamp}`;
      fs.renameSync(target, bak);
      console.log(`[restore] DB attuale salvato come ${path.basename(bak)}`);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
    }
    fs.copyFileSync(src, target);
    console.log(`[restore] ✓ DB SQLite ripristinato: ${target}`);
  } else if (manifest.dialect === 'postgres') {
    const sqlPath = path.join(stagingDir, 'database.sql');
    if (!fs.existsSync(sqlPath)) throw new Error('Archivio non contiene database.sql');
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || '5432';
    const user = process.env.DB_USER;
    const database = process.env.DB_NAME;
    const password = process.env.DB_PASSWORD;
    if (!user || !database) throw new Error('DB_USER e DB_NAME richiesti per restore Postgres');
    console.log(`[restore] ripristino Postgres su ${host}:${port}/${database}…`);
    await spawnPromise(
      'psql',
      ['-h', host, '-p', String(port), '-U', user, '-d', database, '-f', sqlPath],
      {
        env: { ...process.env, PGPASSWORD: password || '' },
      },
    );
    console.log('[restore] ✓ DB Postgres ripristinato');
  } else {
    throw new Error(`Dialect non supportato: ${manifest.dialect}`);
  }

  // ── Restore uploads ─────────────────────────────────────────
  const srcUploads = path.join(stagingDir, 'uploads');
  if (fs.existsSync(srcUploads)) {
    if (fs.existsSync(UPLOADS_DIR)) {
      const bak = `${UPLOADS_DIR}.pre-restore-${stamp}`;
      fs.renameSync(UPLOADS_DIR, bak);
      console.log(`[restore] uploads attuali salvati come ${path.basename(bak)}`);
    }
    fs.cpSync(srcUploads, UPLOADS_DIR, { recursive: true });
    console.log(`[restore] ✓ uploads ripristinati: ${UPLOADS_DIR}`);
  } else {
    console.log("[restore] (nessuna cartella uploads nell'archivio)");
  }

  fs.rmSync(stagingDir, { recursive: true, force: true });
  console.log('[restore] ✓ completato. Riavvia il backend.');
}

main().catch((err) => {
  console.error('[restore] ✗ errore:', err.message);
  process.exit(1);
});
