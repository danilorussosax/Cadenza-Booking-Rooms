/**
 * Cattura screenshot reali della webapp Cadenza.
 *
 * Avvia preventivamente il backend e2e su :3199 (start-e2e.js).
 * Questo script:
 *  1) si autentica via API (admin + studente)
 *  2) crea via API più aule, prenotazioni, annunci, strumenti per popolare le UI
 *  3) apre il browser e cattura le pagine chiave a 1920x1080
 *
 * Output: ./screenshots/{login,dashboard,rooms,booking,my-bookings,profile,announcements,admin-analytics}.png
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(path.join(
  __dirname, '..', 'e2e', 'node_modules', 'playwright'
));

const BASE = process.env.BASE || 'http://localhost:3199';
const OUT_DIR = path.resolve(__dirname, 'screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const ADMIN = { email: 'admin@test.local', password: 'Password1!' };
const STUDENT = { email: 'studente@test.local', password: 'Password1!' };
const PRIVACY_VERSION = '2026-04-29';
const TERMS_VERSION = '2026-04-27';

async function api(method, urlPath, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!res.ok) {
    console.warn(`[api] ${method} ${urlPath} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  return { res, data };
}

async function login(creds) {
  const { data } = await api('POST', '/api/auth/login', creds);
  return data?.token || data?.accessToken;
}

async function safe(fn, label) {
  try { return await fn(); }
  catch (e) { console.warn(`[seed] ${label} failed: ${e.message}`); }
}

async function enrichSeed() {
  const token = await login(ADMIN);
  if (!token) throw new Error('Admin login failed (need rich seed?)');
  console.log('[seed] admin token ok');

  // Get institutes/buildings
  const { data: insts } = await api('GET', '/api/institutes', null, token);
  const inst = insts?.data?.[0] || insts?.[0];
  if (!inst) throw new Error('No institute');
  const { data: bldgs } = await api(
    'GET', `/api/institutes/${inst.id}/buildings`, null, token
  );
  const building = bldgs?.data?.[0] || bldgs?.[0];

  // Create a couple more rooms (best-effort)
  const newRooms = [
    { name: 'A.102 — Pianoforte', floor: 'Piano terra', capacity: 4, type: 'studio' },
    { name: 'A.103 — Violino',    floor: 'Piano terra', capacity: 4, type: 'studio' },
    { name: 'B.201 — Coro',       floor: 'Primo piano', capacity: 25, type: 'aula' },
    { name: 'B.203 — Lezione',    floor: 'Primo piano', capacity: 12, type: 'aula' },
    { name: 'Auditorium',         floor: 'Piano terra', capacity: 250, type: 'concerto' },
  ];
  for (const r of newRooms) {
    await safe(() => api('POST', `/api/buildings/${building.id}/rooms`,
      { ...r, isBookable: true, requireCheckIn: false }, token),
      `room ${r.name}`);
  }

  // Get rooms list
  const { data: rooms } = await api('GET', '/api/rooms', null, token);
  const allRooms = rooms?.data || rooms || [];
  console.log(`[seed] rooms total=${allRooms.length}`);

  // Create some bookings as student for the next 2 days
  const studentTok = await login(STUDENT);
  if (studentTok) {
    const now = new Date();
    const day = (offset, hh, mm = 0) => {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      d.setHours(hh, mm, 0, 0);
      return d.toISOString();
    };
    const bookings = [
      { roomIdx: 0, start: day(0, 9), end: day(0, 10), purpose: 'Studio individuale' },
      { roomIdx: 0, start: day(0, 14, 30), end: day(0, 16), purpose: 'Lezione Pianoforte' },
      { roomIdx: 1, start: day(0, 11), end: day(0, 12), purpose: 'Studio Violino' },
      { roomIdx: 4, start: day(1, 16), end: day(1, 18), purpose: 'Prova Auditorium' },
      { roomIdx: 2, start: day(1, 10, 30), end: day(1, 12), purpose: 'Coro' },
    ];
    for (const b of bookings) {
      const room = allRooms[b.roomIdx];
      if (!room) continue;
      await safe(() => api('POST', '/api/bookings', {
        roomId: room.id,
        startsAt: b.start,
        endsAt: b.end,
        purpose: b.purpose,
      }, studentTok), `booking ${b.purpose}`);
    }
  }

  // Announcements (admin)
  const announcements = [
    { title: 'Concerto · Sala Verdi', body: 'Studenti Triennio · 19 maggio',
      audienceType: 'all', priority: 'normal' },
    { title: 'Esami · sessione estiva', body: 'Iscrizioni aperte fino al 15 giugno',
      audienceType: 'all', priority: 'high' },
    { title: 'Aula 12 · manutenzione', body: 'Edificio B · 21 maggio',
      audienceType: 'all', priority: 'normal' },
  ];
  for (const a of announcements) {
    await safe(() => api('POST', '/api/announcements', a, token),
      `announcement ${a.title}`);
  }

  // Pre-accept legal docs for both users so the modal won't show in screenshots.
  for (const creds of [ADMIN, STUDENT]) {
    const t = await login(creds);
    if (!t) continue;
    await safe(() => api('POST', '/api/users/me/gdpr/consent',
      { consentType: 'privacy_policy', granted: true, policyVersion: PRIVACY_VERSION }, t),
      `consent privacy ${creds.email}`);
    await safe(() => api('POST', '/api/users/me/gdpr/consent',
      { consentType: 'terms', granted: true, policyVersion: TERMS_VERSION }, t),
      `consent terms ${creds.email}`);
  }

  console.log('[seed] enrichment done');
}

async function main() {
  await enrichSeed().catch((e) => console.warn('[seed] partial:', e.message));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  });
  // Pre-populate localStorage to bypass cookie banner before any page load
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('cookie-consent', JSON.stringify({
        accepted: true, functional: true, analytics: true, ts: Date.now(),
      }));
      localStorage.setItem('cookie_consent', 'accepted');
      localStorage.setItem('cadenza:cookieConsent', 'accepted');
    } catch {}
  });
  const page = await ctx.newPage();
  // Inject CSS to hide any leftover overlays (cookie banner, dialogs we don't dismiss)
  const HIDE_OVERLAYS_CSS = `
    [data-cookie-banner], [class*="cookie" i][class*="banner" i],
    [role="dialog"][aria-label*="cookie" i],
    [class*="cookie-consent" i], #cookie-consent { display: none !important; }
  `;
  await page.addStyleTag({ content: HIDE_OVERLAYS_CSS }).catch(() => {});
  // suppress fonts.googleapis loading delays by waiting on networkidle when needed

  async function shoot(name, fn) {
    try {
      await fn(page);
      // small settle
      await page.waitForTimeout(400);
      // Hide cookie banner/dialogs at screenshot time
      await page.addStyleTag({ content: HIDE_OVERLAYS_CSS }).catch(() => {});
      // Also remove any remaining bottom-fixed cookie banners that the
      // selector above didn't catch.
      await page.evaluate(() => {
        document.querySelectorAll('div, section').forEach((el) => {
          const txt = (el.textContent || '').toLowerCase();
          if (txt.includes('cookie tecnici') && el.offsetHeight < 250) {
            el.style.display = 'none';
          }
        });
      }).catch(() => {});
      const out = path.join(OUT_DIR, `${name}.png`);
      await page.screenshot({ path: out, fullPage: false });
      console.log(`  ✓ ${name}.png`);
    } catch (e) {
      console.warn(`  ✗ ${name}: ${e.message.slice(0, 200)}`);
    }
  }

  // 1) Login (anonymous)
  await shoot('login', async (p) => {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  });

  // 2) Login as student & capture dashboard
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  // try to fill email & password (selectors common for shadcn forms)
  async function fillLogin({ email, password }) {
    // Reveal the email login form (it's hidden behind a toggle button)
    const toggle = await page.$('button:has-text("Accedi con email"), button:has-text("Email")');
    if (toggle) {
      await toggle.click().catch(() => {});
      await page.waitForTimeout(300);
    }
    let emailInput = await page.$('input[type=email]');
    if (!emailInput) emailInput = await page.$('input[name="email"]');
    if (!emailInput) emailInput = await page.$('input[autocomplete="email"]');
    if (emailInput) await emailInput.fill(email);
    let passInput = await page.$('input[type=password]');
    if (!passInput) passInput = await page.$('input[name="password"]');
    if (passInput) await passInput.fill(password);
    // Click the submit button (avoid the "Accedi con Google/Microsoft" SSO ones)
    const btns = await page.$$('button[type=submit]');
    if (btns.length) {
      // pick last one (typically the form submit, after SSO buttons)
      await btns[btns.length - 1].click();
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  // Dismiss any blocking modals (cookie banner, legal docs prompt).
  // Run BEFORE login by setting localStorage to skip them on next reload.
  async function dismissOverlays(p) {
    // 1) cookie banner — click "Accetta"
    const cookieBtn = await p.$('button:has-text("Accetta")');
    if (cookieBtn) {
      await cookieBtn.click().catch(() => {});
      await p.waitForTimeout(300);
    }
    // 2) legal docs modal: tick all checkboxes, click "Accetta e continua"
    const checks = await p.$$('[role="dialog"] input[type=checkbox]');
    for (const c of checks) {
      await c.check({ force: true }).catch(() => {});
    }
    const acceptCont = await p.$(
      'button:has-text("Accetta e continua"), [role="dialog"] button:has-text("Continua"), [role="dialog"] button:has-text("Accetta")'
    );
    if (acceptCont) {
      await acceptCont.click().catch(() => {});
      await p.waitForTimeout(500);
    }
  }

  await fillLogin(STUDENT);
  await page.waitForTimeout(1000);
  // Land on dashboard, then dismiss all overlays once.
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(600);
  // Run dismiss several times in case of multiple modals stacked
  for (let i = 0; i < 3; i++) {
    await dismissOverlays(page);
    await page.waitForTimeout(300);
  }

  await shoot('dashboard', async (p) => {
    await p.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await dismissOverlays(p);
    await p.waitForTimeout(800);
  });

  await shoot('rooms', async (p) => {
    await p.goto(`${BASE}/rooms`, { waitUntil: 'networkidle' });
    await dismissOverlays(p);
  });

  await shoot('booking', async (p) => {
    await p.goto(`${BASE}/booking`, { waitUntil: 'networkidle' });
    await dismissOverlays(p);
  });

  await shoot('my-bookings', async (p) => {
    await p.goto(`${BASE}/my-bookings`, { waitUntil: 'networkidle' });
    await dismissOverlays(p);
  });

  await shoot('profile', async (p) => {
    await p.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    await dismissOverlays(p);
  });

  await shoot('instruments', async (p) => {
    await p.goto(`${BASE}/instruments`, { waitUntil: 'networkidle' });
    await dismissOverlays(p);
  });

  // Logout & login admin: il JWT è in localStorage, non solo nei cookie.
  // Pulisce localStorage + sessionStorage (oltre ai cookie) per evitare che
  // resti la sessione studente quando facciamo il login admin.
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
  });
  await page.reload({ waitUntil: 'networkidle' });
  await fillLogin(ADMIN);
  await page.waitForTimeout(1500);
  // Verifica che il login admin sia andato a buon fine: l'URL non deve
  // più essere /login.
  if (page.url().includes('/login')) {
    console.warn('[admin-login] sembra non riuscito, URL =', page.url());
  } else {
    console.log('[admin-login] OK, URL =', page.url());
  }

  await shoot('admin-analytics', async (p) => {
    await p.goto(`${BASE}/admin/analytics`, { waitUntil: 'networkidle' });
    await dismissOverlays(p);
  });

  await shoot('admin-structure', async (p) => {
    await p.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' });
    await dismissOverlays(p);
  });

  await shoot('admin-announcements', async (p) => {
    await p.goto(`${BASE}/admin/announcements`, { waitUntil: 'networkidle' });
    await dismissOverlays(p);
  });

  await shoot('admin-monte-ore', async (p) => {
    await p.goto(`${BASE}/admin/monte-ore`, { waitUntil: 'networkidle' });
    await dismissOverlays(p);
  });

  await browser.close();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
