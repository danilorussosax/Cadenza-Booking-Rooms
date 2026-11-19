'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set([
  'node_modules',
  'tests',
  'data',
  'coverage',
  'scripts',
  'seeders',
  'migrations',
]);

// `code: 'X'`, `.code = 'X'` e il secondo argomento delle factory `fail(msg, 'X')`.
const PATTERNS = [
  /\bcode\s*[:=]\s*'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)'/g,
  /\bdomainError\(\s*'([A-Z][A-Z0-9_]+)'/g,
  /\bfail\(\s*(?:`[^`]*`|'[^']*'|"[^"]*"|[^,]+),\s*'([A-Z][A-Z0-9_]+)'/g,
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Insieme ordinato dei codici letterali emessi dal codice backend di produzione. */
function scanEmittedCodes() {
  const codes = new Set();
  for (const file of walk(BACKEND_ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of PATTERNS) {
      for (const m of text.matchAll(re)) codes.add(m[1]);
    }
  }
  return [...codes].sort();
}

module.exports = { scanEmittedCodes };
