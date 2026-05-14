import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Playwright config "produzione-like" per il frontend Cadenza.
 *
 * Strategia: il backend Node serve sia le API sia la SPA buildata in
 * `frontend/dist`, quindi una sola istanza HTTP copre tutto.
 *  - La build statica viene assicurata da `tests/e2e/global-setup.ts` PRIMA
 *    che il backend webServer parta (evita di dover lanciare `npm run build`
 *    a mano la prima volta).
 *  - SQLite in-memory + seed E2E deterministico riusando lo script
 *    `e2e/fixtures/start-e2e.js` (un'unica sorgente di verità per il
 *    bootstrap test del backend).
 *  - baseURL punta direttamente al backend (porta 3199 di default): nessun
 *    dev-server Vite separato, niente HMR né proxy in mezzo, ambiente più
 *    vicino a quello reale.
 *
 * Solo Chromium per ora (un singolo browser è sufficiente per uno smoke).
 */
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 3199);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${BACKEND_PORT}`;

const REPO_ROOT = path.resolve(__dirname, '..');
const START_SCRIPT = path.join(REPO_ROOT, 'e2e', 'fixtures', 'start-e2e.js');

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node ${START_SCRIPT}`,
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
