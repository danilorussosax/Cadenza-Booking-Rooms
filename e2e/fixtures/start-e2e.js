'use strict';

/**
 * Entry point dedicata agli E2E.
 * Importa l'app Express (backend), sincronizza lo schema SQLite in-memory,
 * applica il seed deterministico per i test e poi fa listen.
 *
 * Differenze rispetto a backend/server.js:
 *  - Niente reminderScheduler/retentionScheduler (rumore inutile per i test).
 *  - Niente preSyncMigrations (con sync({force}) lo schema è completo).
 *  - Seed E2E (`fixtures/seed-e2e.js`) invece di `seeders/initial.js`.
 */

const path = require('node:path');

const BACKEND_DIR = path.resolve(__dirname, '..', '..', 'backend');
process.chdir(BACKEND_DIR);

(async () => {
  const { sequelize } = require(path.join(BACKEND_DIR, 'models'));
  const { buildApp } = require(path.join(BACKEND_DIR, 'app'));
  const { seedE2E } = require('./seed-e2e');

  await sequelize.sync({ force: true });
  await seedE2E();

  const app = buildApp({ serveFrontend: true });
  const PORT = Number(process.env.PORT || 3199);
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[e2e] backend listening on :${PORT}`);
  });
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[e2e] startup failed:', err);
  process.exit(1);
});
