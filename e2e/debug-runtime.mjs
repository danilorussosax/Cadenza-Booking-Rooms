/**
 * Debug runtime: visita tutte le pagine principali con admin auth e raccoglie
 * errori console, page errors, network 4xx/5xx.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3000';

const out = execFileSync(
  'node',
  [resolve(__dirname, '..', 'backend', 'scripts', '_issue-admin-token.cjs'), 'danilorusso'],
  { encoding: 'utf-8' },
);
const lines = out.trim().split('\n');
const { token, user } = JSON.parse(lines[lines.length - 1]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'it-IT' });
await ctx.addInitScript(
  ({ tk, usr }) => {
    localStorage.setItem('conservatory_token', tk);
    localStorage.setItem('conservatory_user', JSON.stringify(usr));
  },
  { tk: token, usr: user },
);
const page = await ctx.newPage();

const PAGES = [
  '/dashboard',
  '/booking',
  '/my-bookings',
  '/rooms',
  '/instruments',
  '/my-loans',
  '/monte-ore',
  '/profile',
  // Admin
  '/admin/users',
  '/admin/courses',
  '/admin/monte-ore',
  '/admin/monte-ore/settings',
  '/admin/rules',
  '/admin/booking-types',
  '/admin/approvals',
  '/admin/activity-log',
  '/admin/structure',
  '/admin/instruments',
  '/admin/analytics',
  '/admin/announcements',
  '/admin/server-settings',
  '/admin/audit-log',
];

const issues = {};
for (const p of PAGES) issues[p] = { console: [], pageErr: [], net: [] };

let currentPath = '';
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    issues[currentPath]?.console.push(msg.text().slice(0, 300));
  }
});
page.on('pageerror', (err) => {
  issues[currentPath]?.pageErr.push(`${err.name}: ${err.message.slice(0, 300)}`);
});
page.on('response', (res) => {
  const url = res.url();
  const status = res.status();
  if (status >= 400 && (url.includes('/api/') || url.startsWith(BASE_URL))) {
    issues[currentPath]?.net.push(`${status} ${res.request().method()} ${url.replace(BASE_URL, '')}`);
  }
});

for (const path of PAGES) {
  currentPath = path;
  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(800);
  } catch (err) {
    issues[path].pageErr.push(`navigation failed: ${err.message.slice(0, 200)}`);
  }
}

// Report
console.log('\n=== RUNTIME DEBUG REPORT ===\n');
let totalIssues = 0;
for (const path of PAGES) {
  const i = issues[path];
  const count = i.console.length + i.pageErr.length + i.net.length;
  if (count === 0) {
    console.log(`✓ ${path}`);
  } else {
    totalIssues += count;
    console.log(`\n✗ ${path}  (${count} issue${count !== 1 ? 's' : ''})`);
    for (const e of i.pageErr) console.log(`    [page error] ${e}`);
    for (const e of i.console) console.log(`    [console err] ${e}`);
    for (const e of i.net) console.log(`    [net ${e.startsWith('5') ? '5xx' : '4xx'}] ${e}`);
  }
}
console.log(`\n--- ${totalIssues} totale issues ---\n`);

await browser.close();
