import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 3199);
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${BACKEND_PORT}`;

/**
 * Playwright config per Cadenza.
 *
 * Strategia:
 *  - Avviamo il backend Node con SQLite in-memory + seed E2E (vedi
 *    fixtures/seed-e2e.js). Il backend serve anche il frontend statico
 *    (dalla cartella frontend/dist), quindi una sola istanza copre tutto.
 *  - I test puntano direttamente all'origin del backend.
 *  - Per girare in locale serve aver fatto `npm run build` nel frontend
 *    almeno una volta (il backend serve dist/).
 *  - Niente browser installati di default: lancia `npm run install:browsers`
 *    la prima volta.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // i test condividono uno stato DB seed
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Avvia il backend in test mode con SQLite in-memory.
    // `seed-e2e.js` viene caricato da `tests/global-setup.ts` PRIMA che il
    // server stesso esegua start(): qui la webServer command si limita a
    // far partire il binario.
    command: 'node ' + path.resolve(__dirname, 'fixtures', 'start-e2e.js'),
    port: BACKEND_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(BACKEND_PORT),
      DB_DIALECT: 'sqlite',
      DB_STORAGE: ':memory:',
      DB_LOGGING: 'false',
      DB_SEED: 'false',
      DB_SYNC_MODE: 'force',
      JWT_SECRET: 'e2e-secret',
      SESSION_SECRET: 'e2e-session',
      BCRYPT_COST: '4',
      DISABLE_RATE_LIMIT: 'true',
    },
  },
});
