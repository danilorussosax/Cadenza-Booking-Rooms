'use strict';
/**
 * Read-only: per ogni snapshot SQLite (data/conservatory.sqlite*) conta
 * le righe nelle tabelle "interessanti" e mostra il file con più dati.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TABLES = [
  'users',
  'institutes',
  'buildings',
  'rooms',
  'courses',
  'bookings',
  'instruments',
  'instrument_loans',
  'monte_ore_proposals',
  'monte_ore_schedules',
  'audit_log',
];

const files = fs
  .readdirSync(DATA_DIR)
  .filter((f) => f.startsWith('conservatory.sqlite'))
  .map((f) => ({ f, full: path.join(DATA_DIR, f), st: fs.statSync(path.join(DATA_DIR, f)) }))
  .sort((a, b) => a.st.mtimeMs - b.st.mtimeMs);

console.log(`# ${files.length} snapshot trovati\n`);
const rows = [];
for (const it of files) {
  try {
    const db = new Database(it.full, { readonly: true, fileMustExist: true });
    const counts = {};
    let total = 0;
    for (const t of TABLES) {
      try {
        const r = db.prepare(`SELECT count(*) AS c FROM ${t}`).get();
        counts[t] = r.c;
        total += r.c;
      } catch {
        counts[t] = '-';
      }
    }
    db.close();
    rows.push({ name: it.f, mtime: it.st.mtime.toISOString(), size: it.st.size, total, counts });
  } catch (e) {
    rows.push({
      name: it.f,
      mtime: it.st.mtime.toISOString(),
      size: it.st.size,
      error: e.message.slice(0, 60),
    });
  }
}

const head = [
  'file',
  'mtime',
  'size',
  'tot',
  ...TABLES.map((t) => t.replace('monte_ore_', 'mo_').slice(0, 9)),
];
console.log(head.join('\t'));
for (const r of rows) {
  if (r.error) {
    console.log(`${r.name}\t${r.mtime}\t${r.size}\tERR: ${r.error}`);
    continue;
  }
  const row = [
    r.name.slice(-26),
    r.mtime.slice(11, 19),
    String(r.size),
    String(r.total),
    ...TABLES.map((t) => String(r.counts[t])),
  ];
  console.log(row.join('\t'));
}

// Top 3 per total
const top = rows
  .filter((r) => r.total)
  .sort((a, b) => b.total - a.total)
  .slice(0, 3);
console.log('\n# Top 3 per righe totali:');
for (const r of top) console.log(`  ${r.name}  (${r.mtime}, total=${r.total})`);
