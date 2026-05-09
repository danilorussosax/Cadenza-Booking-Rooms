#!/usr/bin/env node
/**
 * Generatore screenshot del manuale admin.
 *
 * Uso:
 *   cd e2e/
 *   ADMIN_EMAIL_HINT=<sub-email-admin> node screenshots.mjs
 *
 * Per gli screenshot del banner docente con deroga (opzionale):
 *   DOC_EMAIL_HINT=<sub-email-docente> node screenshots.mjs
 *
 * Variabili opzionali:
 *   BASE_URL  (default: http://localhost:3000)
 *   OUT_DIR   (default: ../docs/screenshots)
 *
 * Lo script bypassa login + 2FA emettendo un JWT direttamente via lo script
 * interno backend/scripts/_issue-admin-token.cjs. Il JWT viene iniettato in
 * localStorage con la chiave attesa dal frontend (`conservatory_token`).
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OUT_DIR = process.env.OUT_DIR || resolve(__dirname, '..', 'docs', 'screenshots');
const ADMIN_EMAIL_HINT = process.env.ADMIN_EMAIL_HINT || 'danilorusso';
const DOC_EMAIL_HINT = process.env.DOC_EMAIL_HINT || null;
const ISSUE_TOKEN_SCRIPT = resolve(__dirname, '..', 'backend', 'scripts', '_issue-admin-token.cjs');

mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

function issueToken(emailHint) {
  const out = execFileSync('node', [ISSUE_TOKEN_SCRIPT, emailHint], {
    encoding: 'utf-8',
    env: process.env,
  });
  // L'output può contenere log Sequelize all'inizio; il JSON è sull'ultima riga.
  const lines = out.trim().split('\n');
  const jsonLine = lines[lines.length - 1];
  return JSON.parse(jsonLine);
}

async function authenticatedContext(browser, token, user) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: 'it-IT' });
  // Iniettiamo token + user cache prima di ogni navigazione.
  await ctx.addInitScript(
    ({ tk, usr }) => {
      try {
        window.localStorage.setItem('conservatory_token', tk);
        window.localStorage.setItem('conservatory_user', JSON.stringify(usr));
      } catch {}
    },
    { tk: token, usr: user },
  );
  return ctx;
}

async function shot(page, url, file, opts = {}) {
  await page.goto(`${BASE_URL}${url}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  if (opts.beforeShot) await opts.beforeShot(page);
  await page.waitForTimeout(700);
  const target = resolve(OUT_DIR, file);
  await page.screenshot({ path: target, fullPage: !!opts.fullPage });
  console.log(`  ✓ ${file}`);
}

(async () => {
  console.log(`▶ Emetto JWT admin per "${ADMIN_EMAIL_HINT}"…`);
  const admin = issueToken(ADMIN_EMAIL_HINT);
  console.log(`  ✓ admin: ${admin.user.email} (id=${admin.user.id})`);

  const browser = await chromium.launch();
  const ctx = await authenticatedContext(browser, admin.token, admin.user);
  const page = await ctx.newPage();

  console.log('▶ Genero screenshot pagine admin…');

  // Navigazione iniziale per "scaldare" lo store (token in localStorage):
  await page.goto(`${BASE_URL}/admin`);
  await page.waitForLoadState('networkidle').catch(() => {});

  // §6 Regole prenotazione — tabs guidati da setState in React, vanno cliccati.
  async function clickTab(p, regex) {
    const btn = p.getByRole('button', { name: regex }).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click();
      await p.waitForTimeout(500);
    }
  }
  await shot(page, '/admin/rules', 'rules-overview.png', { fullPage: true });
  await shot(page, '/admin/rules', 'rules-per-ruolo.png', {
    beforeShot: (p) => clickTab(p, /per ruolo/i),
  });
  await shot(page, '/admin/rules', 'rules-quote.png', {
    beforeShot: async (p) => {
      // Click su "Quote" ma evitare match con "Quote prestiti"
      const btns = p.getByRole('button').filter({ hasText: /^Quote$/i });
      if (await btns.first().isVisible({ timeout: 1500 }).catch(() => false)) {
        await btns.first().click();
      } else {
        await clickTab(p, /^quote(?!\s+prestiti)/i);
      }
      await p.waitForTimeout(500);
    },
  });
  await shot(page, '/admin/rules', 'rules-eccezioni.png', {
    beforeShot: (p) => clickTab(p, /eccezioni|exceptions/i),
  });
  // (rules-preview rimosso: il componente RulesPreview non è esposto nella UI corrente)

  // §8 Monte Ore admin: 2 tab interne (proposte, variazioni) + pagina settings separata.
  await shot(page, '/admin/monte-ore', 'monteore-overview.png', { fullPage: true });
  await shot(page, '/admin/monte-ore/settings', 'monteore-settings.png');
  await shot(page, '/admin/monte-ore', 'monteore-proposte.png', {
    beforeShot: (p) => clickTab(p, /proposte|proposals/i),
  });
  await shot(page, '/admin/monte-ore', 'monteore-amendments.png', {
    beforeShot: (p) => clickTab(p, /variazioni|amendments|richieste/i),
  });

  // §3.5 / §8.10 — form deroga Monte Ore
  await page.goto(`${BASE_URL}/admin/users`);
  await page.waitForLoadState('networkidle').catch(() => {});
  // Filtra ruolo=docente
  const ruoloFilter = page.getByRole('combobox', { name: /ruolo/i }).first();
  if (await ruoloFilter.isVisible({ timeout: 1500 }).catch(() => false)) {
    await ruoloFilter.click();
    await page.getByRole('option', { name: /docente/i }).click();
    await page.waitForTimeout(400);
  }
  // Click sul primo bottone "Modifica" (icona pencil)
  const editBtn = page
    .locator('button[title="Modifica"], button[aria-label*="odif" i]')
    .first();
  if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await editBtn.click();
    await page.waitForTimeout(800);
    // Scroll fino al blocco Monte Ore
    await page.evaluate(() => {
      const node =
        Array.from(document.querySelectorAll('p,label,div')).find((n) =>
          /Monte Ore — Tipo contratto/i.test(n.textContent || ''),
        );
      if (node) node.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: resolve(OUT_DIR, 'users-form-monteore-override.png'),
      fullPage: false,
    });
    console.log('  ✓ users-form-monteore-override.png');
  } else {
    console.log('  ⚠ Pulsante "Modifica" non trovato');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §3 Users · §4 Courses · §5 Structure
  // ═══════════════════════════════════════════════════════════════════════════
  await shot(page, '/admin/users', 'users-overview.png', { fullPage: true });
  await shot(page, '/admin/courses', 'courses-overview.png', { fullPage: true });
  await shot(page, '/admin/courses', 'courses-livelli.png', {
    beforeShot: (p) => clickTab(p, /livelli|levels/i),
  });
  await shot(page, '/admin/structure', 'structure-sedi.png', { fullPage: true });
  await shot(page, '/admin/structure', 'structure-dotazioni.png', {
    beforeShot: (p) => clickTab(p, /dotazioni|equipment/i),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §7 Approvals · §7.5 Registro attività
  // ═══════════════════════════════════════════════════════════════════════════
  await shot(page, '/admin/approvals', 'approvals-overview.png', { fullPage: true });
  await shot(page, '/admin/activity-log', 'activity-log-overview.png', { fullPage: true });
  await shot(page, '/admin/bookings', 'bookings-overview.png', { fullPage: true });

  // ═══════════════════════════════════════════════════════════════════════════
  // §9 Inventario strumenti (5 tab)
  // ═══════════════════════════════════════════════════════════════════════════
  await shot(page, '/admin/instruments', 'instruments-overview.png', { fullPage: true });
  await shot(page, '/admin/instruments', 'instruments-loans-all.png', {
    beforeShot: (p) => clickTab(p, /tutti i prestiti|all loans/i),
  });
  await shot(page, '/admin/instruments', 'instruments-overdue.png', {
    beforeShot: (p) => clickTab(p, /scaduti|overdue/i),
  });
  await shot(page, '/admin/instruments', 'instruments-loan-rules.png', {
    beforeShot: (p) => clickTab(p, /regole prestito|loan rules/i),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §10 Analytics · §11 Annunci
  // ═══════════════════════════════════════════════════════════════════════════
  await shot(page, '/admin/analytics', 'analytics-overview.png', { fullPage: true });
  await shot(page, '/admin/announcements', 'announcements-overview.png', { fullPage: true });

  // ═══════════════════════════════════════════════════════════════════════════
  // §12 Impostazioni server — usa ?tab=<macro>&sub=<sub> (URL effettivo dell'hub)
  // ═══════════════════════════════════════════════════════════════════════════
  await shot(page, '/admin/server-settings?tab=aspetto', 'server-settings-aspetto.png', {
    fullPage: true,
  });
  await shot(
    page,
    '/admin/server-settings?tab=servizi&sub=mail',
    'server-settings-servizi-mail.png',
    { fullPage: true },
  );
  await shot(
    page,
    '/admin/server-settings?tab=servizi&sub=messaging',
    'server-settings-servizi-messaging.png',
    { fullPage: true },
  );
  await shot(
    page,
    '/admin/server-settings?tab=servizi&sub=mail-outbox',
    'mail-outbox-overview.png',
    { fullPage: true },
  );
  await shot(
    page,
    '/admin/server-settings?tab=servizi&sub=backups',
    'server-settings-backups.png',
    { fullPage: true },
  );
  await shot(page, '/admin/server-settings?tab=qrcodes', 'server-settings-qrcodes.png');
  await shot(page, '/admin/server-settings?tab=display', 'server-settings-display.png');
  await shot(page, '/admin/server-settings?tab=audit-log', 'server-settings-audit-log.png');
  await shot(page, '/admin/server-settings?tab=moduli', 'server-settings-moduli.png', {
    fullPage: true,
  });

  // §6 Tab "Quote prestiti" (mancante nelle versioni precedenti)
  await shot(page, '/admin/rules', 'rules-quote-prestiti.png', {
    beforeShot: (p) => clickTab(p, /quote prestiti|loan quotas/i),
  });

  // §6.3 Dialog "Nuova eccezione" aperto con Select Aula visibile (v1.5)
  await page.goto(`${BASE_URL}/admin/rules`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await clickTab(page, /eccezioni|exceptions/i);
  await page.waitForTimeout(400);
  // Cerca il bottone "Nuova eccezione" (PlusCircle + label) e clicca
  const newExceptBtn = page
    .getByRole('button', { name: /nuova eccezione|aggiungi eccezione|new exception/i })
    .first();
  if (await newExceptBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await newExceptBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: resolve(OUT_DIR, 'rules-eccezione-dialog.png'),
      fullPage: false,
    });
    console.log('  ✓ rules-eccezione-dialog.png');
    // Chiudi il dialog (ESC) per non sporcare gli screenshot successivi
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    console.log('  ⚠ Bottone "Nuova eccezione" non trovato');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VISTA UTENTE — Dashboard, calendario, prenotazione, profilo
  // ═══════════════════════════════════════════════════════════════════════════

  // Dashboard utente — vista 1 giorno (default)
  await shot(page, '/dashboard', 'dashboard-overview.png', { fullPage: true });

  // Dashboard utente — toggle "3 giorni" (clicca il bottone)
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const threeDaysBtn = page.getByRole('button', { name: /^3 giorni|^3 days|^3 días/i }).first();
  if (await threeDaysBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await threeDaysBtn.click();
    await page.waitForTimeout(900);
    await page.screenshot({
      path: resolve(OUT_DIR, 'dashboard-calendario-3giorni.png'),
      fullPage: false,
    });
    console.log('  ✓ dashboard-calendario-3giorni.png');
  } else {
    console.log('  ⚠ Bottone toggle "3 giorni" non trovato');
  }

  // Pagina prenotazione (selezione aula + slot)
  await shot(page, '/booking', 'booking-page.png', { fullPage: true });

  // Le mie prenotazioni
  await shot(page, '/my-bookings', 'my-bookings.png', { fullPage: true });

  // Vista pubblica /rooms (raggruppata per edificio)
  await shot(page, '/rooms', 'rooms-grouped.png', { fullPage: true });

  // Profilo utente
  await shot(page, '/profile', 'profile-page.png', { fullPage: true });

  // §3.4 OAuth providers form (sezione bassa di /admin/users)
  await page.goto(`${BASE_URL}/admin/users`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => {
    const node = Array.from(document.querySelectorAll('h2,h3,p,div')).find((n) =>
      /provider oauth|oauth google/i.test(n.textContent || ''),
    );
    if (node) node.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: resolve(OUT_DIR, 'users-oauth-providers.png'),
    fullPage: false,
  });
  console.log('  ✓ users-oauth-providers.png');

  // Vista docente con banner deroga
  if (DOC_EMAIL_HINT) {
    console.log(`▶ Emetto JWT docente per "${DOC_EMAIL_HINT}"…`);
    try {
      const ISSUE_DOC_SCRIPT = resolve(
        __dirname,
        '..',
        'backend',
        'scripts',
        '_issue-docente-token.cjs',
      );
      const docOut = execFileSync('node', [ISSUE_DOC_SCRIPT, DOC_EMAIL_HINT], {
        encoding: 'utf-8',
        env: process.env,
      });
      const lines2 = docOut.trim().split('\n');
      const docInfo = JSON.parse(lines2[lines2.length - 1]);
      console.log(`  ✓ docente: ${docInfo.user.email} (id=${docInfo.user.id})`);
      const ctxDoc = await authenticatedContext(browser, docInfo.token, docInfo.user);
      const docPage = await ctxDoc.newPage();
      await docPage.goto(`${BASE_URL}/monte-ore`);
      await docPage.waitForLoadState('networkidle').catch(() => {});
      await docPage.waitForTimeout(1200);
      await docPage.screenshot({
        path: resolve(OUT_DIR, 'monteore-docente-banner.png'),
        fullPage: false,
      });
      console.log('  ✓ monteore-docente-banner.png');
      await ctxDoc.close();
    } catch (err) {
      console.log(`  ⚠ Skip banner docente: ${err.message}`);
    }
  } else {
    console.log('  ⓘ DOC_EMAIL_HINT non fornito → salto monteore-docente-banner.png');
  }

  await browser.close();
  console.log('\n✅ Screenshot generati in', OUT_DIR);
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
