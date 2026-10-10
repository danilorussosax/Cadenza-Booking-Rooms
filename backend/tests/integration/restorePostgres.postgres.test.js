'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { sequelize } = require('../../models');
const { performRestore } = require('../../services/backupRestore');
it.skipIf(sequelize.getDialect() !== 'postgres')(
  'a broken SQL restore rolls back all preceding statements',
  async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-pgrestore120-'));
    try {
      await sequelize.query(
        'CREATE TABLE restore_atomicity (id INTEGER); INSERT INTO restore_atomicity VALUES (120)',
      );
      fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify({ dialect: 'postgres' }));
      fs.writeFileSync(
        path.join(temp, 'database.sql'),
        'DROP TABLE restore_atomicity; THIS IS INVALID SQL;',
      );
      const archivePath = path.join(temp, 'bad.tar.gz');
      execFileSync('tar', ['-czf', archivePath, '-C', temp, 'manifest.json', 'database.sql']);
      await expect(performRestore({ archivePath, offline: true })).rejects.toThrow(/psql/);
      const [rows] = await sequelize.query('SELECT id FROM restore_atomicity');
      expect(rows).toEqual([{ id: 120 }]);
    } finally {
      await sequelize.query('DROP TABLE IF EXISTS restore_atomicity');
      fs.rmSync(temp, { recursive: true, force: true });
    }
  },
);
