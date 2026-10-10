'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const os = require('os');
const { performRestore } = require('../services/backupRestore');
const { performBackup } = require('./backup');
const lockPath = path.join(__dirname, '..', 'data', 'restore-maintenance.lock');

async function main() {
  const archive = process.argv.slice(2).find((arg) => arg.endsWith('.tar.gz'));
  if (!archive || !process.argv.includes('--offline')) {
    throw new Error(
      'Arrestare TUTTE le istanze, poi: node backend/scripts/restore.js <backup.tar.gz> --offline. Il flag conferma che tutti i processi sono arrestati.',
    );
  }
  // Copia privata: lo snapshot corrente potrebbe avere lo stesso nome del backup scelto.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-offline-'));
  const archivePath = path.join(temp, 'restore.tar.gz');
  let locked = false;
  let completed = false;
  try {
    fs.copyFileSync(path.resolve(archive), archivePath);
    await performRestore({ archivePath, dryRun: true });
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    locked = true;
    fs.writeFileSync(
      fd,
      JSON.stringify({
        pid: process.pid,
        archive: path.resolve(archive),
        startedAt: new Date().toISOString(),
      }),
    );
    fs.closeSync(fd);
    const snapshotPath = path.join(
      __dirname,
      '..',
      'data',
      'snapshots',
      `pre-restore-${Date.now()}.tar.gz`,
    );
    const snapshot = await performBackup({ outputPath: snapshotPath, skipRotation: true });
    console.log(`Snapshot precedente: ${snapshot.path}`);
    await require('../models').sequelize.close();
    await performRestore({ archivePath, offline: true });
    completed = true;
    console.log('Ripristino completato. È possibile riavviare tutte le istanze.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    if (locked && completed) fs.unlinkSync(lockPath);
    if (locked && !completed)
      console.error(
        `Ripristino fallito: mantenere il servizio fermo. Verificare snapshot e dati prima di rimuovere ${lockPath}`,
      );
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Chiude anche il pool aperto da un backup fallito.
    try {
      await require('../models').sequelize.close();
    } catch {
      /* già chiuso */
    }
  });
