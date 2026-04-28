'use strict';

/**
 * capture-screenshots.js
 *
 * Cattura screenshot reali della web app Cadenza usando puppeteer.
 * Salva i PNG dentro `backend/scripts/screenshots/` da dove il
 * generate-slides.js li può embedare con `doc.image()`.
 *
 * Pagine catturate:
 *   - /display      (kiosk pubblico, no auth) — la più ricca visivamente
 *   - /login        (form di login, no auth)
 *
 * Le pagine autenticate (Dashboard, weekly view, analytics, form) richiedono
 * credenziali di un admin seedato e dati di esempio. Se il backend è seedato
 * con `npm run seed` e DEFAULT_ADMIN_EMAIL/PASSWORD impostati in .env, lo
 * script tenta il login automatico via API e include anche quelle pagine.
 *
 * Uso:
 *   node backend/scripts/capture-screenshots.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE = process.env.AULABOOK_URL || 'http://localhost:3000';
const OUT_DIR = path.join(__dirname, 'screenshots');
const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 2 };

async function ensureBackendUp() {
  const res = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`Backend non raggiungibile su ${BASE} — avvia con npm run start`);
  }
}

async function tryAdminLogin(browser, page) {
  const email = process.env.DEFAULT_ADMIN_EMAIL;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!email || !password) return null;

  // Login via API per bypassare 2FA UI (admin con 2FA disattivato)
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    console.warn('  ⚠ login admin fallito:', r.status);
    return null;
  }
  const json = await r.json();
  if (!json.token) return null;
  // Inietta il token nel localStorage prima del navigate.
  await page.evaluateOnNewDocument((tok) => {
    localStorage.setItem('conservatory_token', tok);
  }, json.token);
  return json.token;
}

async function shoot(page, url, file, opts = {}) {
  const full = path.join(OUT_DIR, file);
  console.log(`  → ${url} → ${file}`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle2', timeout: 15000 });
  // Pausa per fade-in / hydration React
  await new Promise((r) => setTimeout(r, opts.wait ?? 1500));
  await page.screenshot({
    path: full,
    type: 'png',
    fullPage: opts.fullPage ?? false,
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('• Verifico backend…');
  await ensureBackendUp();

  console.log('• Avvio browser headless…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    page.setDefaultTimeout(15000);

    // 1) /display — pubblica, no auth
    console.log('• /display (kiosk pubblico)…');
    try {
      await shoot(page, '/display', 'display.png', { wait: 3500 });
    } catch (err) {
      console.warn('  ⚠ display:', err.message);
    }

    // 2) /login — pubblica
    console.log('• /login…');
    try {
      await shoot(page, '/login', 'login.png', { wait: 1200 });
    } catch (err) {
      console.warn('  ⚠ login:', err.message);
    }

    // 3) Pagine autenticate — solo se admin credentials disponibili
    const token = await tryAdminLogin(browser, page);
    if (token) {
      console.log('• Login admin OK, catturo pagine autenticate…');
      const authedPages = [
        ['/dashboard', 'dashboard.png', 2500],
        ['/admin/analytics', 'analytics.png', 3000],
        ['/admin/users', 'admin-users.png', 1800],
      ];
      for (const [url, file, wait] of authedPages) {
        try {
          await shoot(page, url, file, { wait });
        } catch (err) {
          console.warn(`  ⚠ ${url}:`, err.message);
        }
      }
    } else {
      console.log('• (skip pagine autenticate: nessuna credenziale admin in env)');
    }
  } finally {
    await browser.close();
  }

  // Riassunto
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.png'));
  console.log(`\n✓ ${files.length} screenshot in ${OUT_DIR}:`);
  files.forEach((f) => {
    const sz = fs.statSync(path.join(OUT_DIR, f)).size;
    console.log(`    ${f} — ${(sz / 1024).toFixed(1)} KB`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
