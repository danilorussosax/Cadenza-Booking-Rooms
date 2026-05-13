#!/usr/bin/env node
'use strict';

/**
 * capture-docente-screenshots.js
 *
 * Genera gli screenshot specifici per le pagine docente che NON sono già
 * presenti in docs/screenshots/ (la maggior parte arriva dalla cattura
 * admin esistente). Pagine target:
 *
 *   - /monte-ore             — Sezione A (pattern) + Sezione B (griglia) come docente
 *   - /monte-ore con banner "proposta da rivalidare" attivo
 *   - dialog "Spostamento lezione" aperto sui tre tab (change_time, change_room, move_to)
 *   - dialog "Richiedi nuovo giorno"
 *   - /my-loans              — prestiti strumenti dal punto di vista del docente
 *
 * Prerequisiti (per ognuno script segnala se manca):
 *
 *   1. Backend in esecuzione su http://localhost:3000 (`npm run start` o
 *      `npm run dev:backend`)
 *   2. Frontend buildato e servito dallo stesso backend (`npm run build`)
 *   3. Dati seed minimi:
 *      - admin@conservatorio.it / Admin123!   (creato da `npm --prefix backend run seed`)
 *      - un edificio + 2 aule prenotabili
 *      - settings Monte Ore aperto per l'AA corrente
 *      - un utente DOCENTE con email/password noti (vedi DOCENTE_EMAIL/PASSWORD env)
 *      - una proposta Monte Ore del docente in stato "approved" o "generated"
 *        con almeno 2 schedule e qualche slot attivo
 *
 * Uso base:
 *   DOCENTE_EMAIL=docente@cadenza.test DOCENTE_PASSWORD=Docente123! \
 *     node backend/scripts/capture-docente-screenshots.js
 *
 * In modalità seed-anchecredenziali:
 *   node backend/scripts/capture-docente-screenshots.js --seed
 *   (richiede --user-id <id> per indicare quale utente esistente promuovere a docente)
 *
 * NOTA: lo script è IDEMPOTENTE. Se uno screenshot esiste già lo riscrive.
 * I PNG vanno in docs/screenshots/ (NON in backend/scripts/screenshots/ come
 * il capture-screenshots.js del PDF marketing).
 */

const fs = require('fs');
const path = require('path');

const BASE = process.env.AULABOOK_URL || process.env.CADENZA_URL || 'http://localhost:3000';
const OUT_DIR = path.resolve(__dirname, '..', '..', 'docs', 'screenshots');
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 2 };
const WAIT_DEFAULT = 1500;

const DOCENTE_EMAIL = process.env.DOCENTE_EMAIL || 'docente@cadenza.test';
const DOCENTE_PASSWORD = process.env.DOCENTE_PASSWORD || 'Docente123!';

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch {
  console.error(
    '❌ puppeteer non installato. Installa con:\n   cd backend && npm install --save-dev puppeteer',
  );
  process.exit(1);
}

async function ensureBackendUp() {
  const res = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      `Backend non raggiungibile su ${BASE}.\n  Avvia con: npm run start (oppure npm run dev)`,
    );
  }
}

/**
 * Login via API → restituisce il JWT del docente. Se il login fallisce,
 * stampa istruzioni per creare l'utente e termina senza errore (lascia gli
 * screenshot esistenti intatti).
 */
async function loginDocente() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD }),
  });
  if (!r.ok) {
    console.warn(
      `⚠ Login docente fallito (HTTP ${r.status}). Verifica che esista un utente:\n` +
        `   email:    ${DOCENTE_EMAIL}\n` +
        `   password: ${DOCENTE_PASSWORD}\n` +
        `   role:     docente\n` +
        `Per crearlo: login admin → /admin/users → + Nuovo utente`,
    );
    return null;
  }
  const json = await r.json();
  return json.token || null;
}

/**
 * Cattura uno screenshot della pagina url e salva file con il nome dato.
 * - waitFor: selettore CSS da attendere prima dello scatto (es. `.monte-ore-grid`)
 * - clip: oggetto {x,y,width,height} per cattura parziale
 * - clickAfterLoad: selettore CSS da cliccare dopo il load (es. il bottone `⋮`)
 */
async function shoot(page, url, fileName, opts = {}) {
  const full = path.join(OUT_DIR, fileName);
  console.log(`  → ${url} → ${fileName}`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle2', timeout: 20000 });
  if (opts.waitFor) {
    try {
      await page.waitForSelector(opts.waitFor, { timeout: 10000 });
    } catch {
      console.warn(`    ⚠ selector ${opts.waitFor} non trovato (timeout)`);
    }
  }
  await new Promise((r) => setTimeout(r, opts.wait ?? WAIT_DEFAULT));
  if (opts.clickAfterLoad) {
    try {
      await page.click(opts.clickAfterLoad);
      await new Promise((r) => setTimeout(r, 700));
    } catch (err) {
      console.warn(`    ⚠ click ${opts.clickAfterLoad} fallito:`, err.message);
    }
  }
  await page.screenshot({
    path: full,
    type: 'png',
    fullPage: opts.fullPage ?? false,
    clip: opts.clip,
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('• Verifico backend…');
  await ensureBackendUp();

  console.log('• Login docente…');
  const token = await loginDocente();
  if (!token) {
    console.log('✗ Senza credenziali docente non posso fare il resto. Esco senza errore.');
    process.exit(0);
  }

  console.log('• Avvio browser headless…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    page.setDefaultTimeout(20000);

    // Inietta il token PRIMA di navigare. Cadenza legge da localStorage
    // alla key 'conservatory_token' (vedi frontend/src/lib/api.ts).
    await page.evaluateOnNewDocument((tok) => {
      localStorage.setItem('conservatory_token', tok);
    }, token);

    // Pagine docente ad hoc — TUTTE le altre (dashboard, profilo, my-bookings,
    // booking-page, rooms-grouped, login, complete-profile) sono già nel repo
    // perché condivise con il manuale admin.
    const shots = [
      // Monte Ore docente — vista globale (pattern + griglia)
      {
        url: '/monte-ore',
        file: 'monteore-docente-overview.png',
        opts: { wait: 2500, fullPage: true },
      },
      // Monte Ore — banner rivalidazione (richiede flag requiresRevalidation=true
      // sulla proposta del docente; lo setti via admin → /monte-ore-override
      // di routes/users.js cambiando contractType)
      {
        url: '/monte-ore',
        file: 'monteore-docente-revalidate-banner.png',
        opts: { wait: 2000, clip: { x: 0, y: 100, width: 1280, height: 160 } },
      },
      // Pagina prestiti utente
      {
        url: '/my-loans',
        file: 'my-loans-docente.png',
        opts: { wait: 2000, fullPage: true },
      },
      // Avvisi/Bacheca lato docente
      {
        url: '/announcements',
        file: 'announcements-docente.png',
        opts: { wait: 1500, fullPage: true },
      },
    ];

    for (const { url, file, opts } of shots) {
      try {
        await shoot(page, url, file, opts);
      } catch (err) {
        console.warn(`  ⚠ ${url}: ${err.message}`);
      }
    }

    // Dialog "Spostamento lezione" — richiede che ci sia uno slot attivo
    // nella griglia. Se non c'è, salta con un warning.
    console.log('\n• Dialog spostamento lezione (3 tab)…');
    try {
      await page.goto(`${BASE}/monte-ore`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('button[aria-label="Apri opzioni di spostamento"]', {
        timeout: 5000,
      });
      await page.click('button[aria-label="Apri opzioni di spostamento"]');
      await new Promise((r) => setTimeout(r, 700));

      // Tab "Cambia orario" (default)
      await page.screenshot({
        path: path.join(OUT_DIR, 'monteore-docente-spostamento-orario.png'),
        type: 'png',
      });
      // Tab "Cambia aula"
      const tabs = await page.$$('div[role="dialog"] button');
      if (tabs[1]) {
        await tabs[1].click();
        await new Promise((r) => setTimeout(r, 500));
        await page.screenshot({
          path: path.join(OUT_DIR, 'monteore-docente-spostamento-aula.png'),
          type: 'png',
        });
      }
      // Tab "Sposta a…"
      if (tabs[2]) {
        await tabs[2].click();
        await new Promise((r) => setTimeout(r, 500));
        await page.screenshot({
          path: path.join(OUT_DIR, 'monteore-docente-spostamento-sposta-a.png'),
          type: 'png',
        });
      }
    } catch (err) {
      console.warn(
        '  ⚠ Dialog spostamento lezione non catturato:',
        err.message,
        '\n  Assicurati di avere una proposta in stato approved/generated con almeno uno slot attivo.',
      );
    }
  } finally {
    await browser.close();
  }

  // Riassunto
  const files = fs
    .readdirSync(OUT_DIR)
    .filter(
      (f) =>
        f.startsWith('monteore-docente-') ||
        f.startsWith('my-loans-docente') ||
        f === 'announcements-docente.png',
    );
  console.log(`\n✓ ${files.length} screenshot docente in ${OUT_DIR}:`);
  files.forEach((f) => {
    const sz = fs.statSync(path.join(OUT_DIR, f)).size;
    console.log(`    ${f} — ${(sz / 1024).toFixed(1)} KB`);
  });
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
