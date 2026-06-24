/**
 * capture-m365-gate.js
 *
 * Cattura lo screenshot del "Gate gruppi Microsoft 365 + mapping ruoli editabile"
 * (Amministrazione → Utenti → tab SSO, card OAuthGroupGateSection) per il
 * MANUALE_ADMIN (§3.6bis). Output: docs/screenshots/users-m365-group-gate.png
 *
 * Prerequisiti:
 *   - backend+frontend Cadenza in locale (npm run dev), DB raggiungibile;
 *   - admin seedato con 2FA disattivato e DEFAULT_ADMIN_EMAIL/PASSWORD in backend/.env.
 *
 * Uso (dalla root del monorepo, con Cadenza avviata):
 *   node backend/scripts/capture-m365-gate.js
 *
 * Modellato su capture-screenshots.js / capture-docente-screenshots.js (stesso login via API).
 */
/* global document */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const puppeteer = require('puppeteer');

const BASE = process.env.AULABOOK_URL || 'http://localhost:3000';
const OUT_DIR = path.resolve(__dirname, '..', '..', 'docs', 'screenshots');
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 2 };

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(`Backend non raggiungibile su ${BASE} — avvia Cadenza con "npm run dev"`);
  }

  const email = process.env.DEFAULT_ADMIN_EMAIL;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('DEFAULT_ADMIN_EMAIL/PASSWORD non impostati in backend/.env');
  }

  // Login via API (bypassa la UI 2FA: usare un admin senza 2FA)
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`Login admin fallito: ${r.status}`);
  const { token } = await r.json();
  if (!token) throw new Error('Login senza token (admin con 2FA attivo?)');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    page.setDefaultTimeout(20000);
    await page.evaluateOnNewDocument(
      (tok) => localStorage.setItem('conservatory_token', tok),
      token,
    );

    await page.goto(`${BASE}/admin/users?tab=sso`, { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise((res) => setTimeout(res, 2500));

    // Porta in vista la card "Gate gruppi Microsoft 365"
    await page.evaluate(() => {
      const node = [
        ...document.querySelectorAll('h2, h3, [class*="CardTitle"], [class*="font-semibold"]'),
      ].find((e) => /gate gruppi/i.test(e.textContent || ''));
      if (node) node.scrollIntoView({ block: 'start' });
    });
    await new Promise((res) => setTimeout(res, 1200));

    const out = path.join(OUT_DIR, 'users-m365-group-gate.png');
    await page.screenshot({ path: out, type: 'png', fullPage: true });
    console.log('✓ salvato', out);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
