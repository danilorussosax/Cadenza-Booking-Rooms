import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Garantisce che `frontend/dist` esista PRIMA che il backend E2E parta.
 * Il backend serve la SPA da quella cartella; se manca, gli E2E
 * vedrebbero un 404 su `/` e un white-screen su tutte le route SPA.
 *
 * Idempotente: se `dist/index.html` esiste già, salta la build (così i
 * giri locali ripetuti restano veloci). Forza la build con
 * `E2E_FORCE_BUILD=1` o quando si sta in CI.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..', '..');
const DIST_INDEX = path.join(FRONTEND_DIR, 'dist', 'index.html');

export default async function globalSetup(): Promise<void> {
  const needsBuild = !existsSync(DIST_INDEX) || !!process.env.CI || !!process.env.E2E_FORCE_BUILD;
  if (!needsBuild) {
    // eslint-disable-next-line no-console
    console.log('[e2e] frontend/dist già presente — skip build');
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[e2e] build SPA in corso (necessaria per backend serveFrontend)…');
  execSync('npm run build', {
    cwd: FRONTEND_DIR,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });
}
