'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sqlite3 = require('sqlite3');
const { performRestore } = require('../../services/backupRestore');
function database(file, sql) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file);
    db.exec(sql, (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
}
it('offline restore honors custom DB_STORAGE and separates old WAL/SHM', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-restore120-'));
  const originalStorage = process.env.DB_STORAGE;
  const originalDialect = process.env.DB_DIALECT;
  try {
    const src = path.join(temp, 'src');
    fs.mkdirSync(src);
    await database(
      path.join(src, 'conservatory.sqlite'),
      'CREATE TABLE restored (id INTEGER); INSERT INTO restored VALUES (120);',
    );
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ dialect: 'sqlite' }));
    const archivePath = path.join(temp, 'backup.tar.gz');
    execFileSync('tar', ['-czf', archivePath, '-C', src, 'manifest.json', 'conservatory.sqlite']);
    const target = path.join(temp, 'custom.sqlite');
    await database(target, 'CREATE TABLE previous (id INTEGER);');
    fs.writeFileSync(target + '-wal', 'old WAL fixture');
    fs.writeFileSync(target + '-shm', 'old SHM fixture');
    process.env.DB_STORAGE = target;
    process.env.DB_DIALECT = 'sqlite';
    await expect(performRestore({ archivePath })).rejects.toMatchObject({
      code: 'RESTORE_OFFLINE_REQUIRED',
    });
    const result = await performRestore({ archivePath, offline: true });
    expect(result.restored.db).toBe(true);
    expect(fs.readFileSync(target)).toEqual(fs.readFileSync(path.join(src, 'conservatory.sqlite')));
    expect(fs.existsSync(target + '-wal')).toBe(false);
    expect(fs.existsSync(target + '-shm')).toBe(false);
    const snapshot = path.resolve(__dirname, '../..', result.restored.savedDbBackup);
    expect(fs.readFileSync(snapshot + '-wal', 'utf8')).toBe('old WAL fixture');
  } finally {
    process.env.DB_STORAGE = originalStorage;
    process.env.DB_DIALECT = originalDialect;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
