// Analisi delle chiavi i18n non riferite dal codice (src + tests del frontend).
//
// Criterio CONSERVATIVO: una chiave e' "morta" solo se
//   1. non compare (a confine di segmento) come testo nel codice ne' la chiave
//      completa, ne' alcun suo prefisso di >= 2 segmenti (suffissi plurali
//      _one/_other/... ignorati);
//   2. nessun template dinamico (`a.${x}.b`) o concatenazione ('a.' + x) del
//      codice potrebbe produrla;
//   3. non e' riferita da un annidamento `$t(...)` in un altro valore;
//   4. non appartiene ai sottoalberi protetti (errors, error, roles, enum).
//
// Uso: `node scripts/i18nKeys.mjs [--json]` stampa le chiavi morte.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const LANGS = ['it', 'en', 'es', 'de', 'fr'];
export const PROTECTED_ROOTS = ['errors', 'error', 'roles', 'enum'];
const PLURAL = /_(zero|one|two|few|many|other)$/;

export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

export function loadLocale(lang) {
  return JSON.parse(readFileSync(join(root, 'src/i18n/locales', `${lang}.json`), 'utf8'));
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'locales') continue;
    const f = join(dir, name);
    if (statSync(f).isDirectory()) walk(f, files);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) files.push(f);
  }
  return files;
}

/** Testo concatenato di src e tests (escluso il test ratchet stesso). */
export function readSources() {
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'tests'))].filter(
    (f) => !f.endsWith('i18nKeys.test.ts'),
  );
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Estrae prefissi e pattern dinamici dal codice. */
export function dynamicPatterns(src) {
  const prefixes = new Set();
  const regexes = [];
  // Template con interpolazione: `a.b.${x}`, `a.${x}.title`.
  for (const m of src.matchAll(/`([^`]*\$\{[^`]*)`/g)) {
    const parts = m[1].split(/\$\{[^}]*\}/);
    if (!parts.join('').includes('.')) continue;
    if (parts[0].includes('.')) prefixes.add(parts[0]);
    else regexes.push(new RegExp('^' + parts.map(esc).join('.*') + '(_[a-z]+)?$'));
  }
  // Concatenazioni: 'a.b.' + x   /   x + '.title'
  for (const m of src.matchAll(/(['"])([\w]+(?:\.[\w]*)+)\1\s*\+/g)) prefixes.add(m[2]);
  for (const m of src.matchAll(/\+\s*(['"])(\.[\w.]+)\1/g)) {
    regexes.push(new RegExp(esc(m[2]) + '(_[a-z]+)?$'));
  }
  return { prefixes: [...prefixes], regexes };
}

function hasToken(src, token) {
  let i = src.indexOf(token);
  while (i !== -1) {
    const before = src[i - 1];
    const after = src[i + token.length];
    if (!(before && /[\w.]/.test(before)) && !(after && /\w/.test(after))) return true;
    i = src.indexOf(token, i + 1);
  }
  return false;
}

/** Restituisce le chiavi (tra `keys`) non riferite secondo il criterio sopra. */
export function findUnreferenced(src, keys, minDepth = 3) {
  const { prefixes, regexes } = dynamicPatterns(src);
  const nested = new Set();
  for (const lang of LANGS) {
    for (const v of Object.values(flatten(loadLocale(lang)))) {
      for (const m of String(v).matchAll(/\$t\(([^),]+)/g)) nested.add(m[1].trim());
    }
  }
  const dead = [];
  for (const key of keys) {
    const segs = key.split('.');
    if (PROTECTED_ROOTS.includes(segs[0])) continue;
    // Solo chiavi con gruppo-padre di >= 2 segmenti (profondita' >= 3): le chiavi
    // a 2 segmenti (common.*, theme.*, ...) restano per prudenza.
    if (segs.length < minDepth) continue;
    const base = key.replace(PLURAL, '');
    const baseSegs = base.split('.');
    let ref = nested.has(key) || nested.has(base);
    if (!ref && baseSegs.length === 1) ref = hasToken(src, base);
    for (let n = 2; !ref && n <= baseSegs.length; n++) {
      if (hasToken(src, baseSegs.slice(0, n).join('.'))) ref = true;
    }
    if (!ref) ref = prefixes.some((p) => key.startsWith(p));
    if (!ref) ref = regexes.some((r) => r.test(key));
    if (!ref) dead.push(key);
  }
  return dead;
}

/** Unione delle chiavi foglia delle 5 lingue. */
export function allKeys() {
  const set = new Set();
  for (const lang of LANGS) for (const k of Object.keys(flatten(loadLocale(lang)))) set.add(k);
  return [...set];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dead = findUnreferenced(readSources(), allKeys());
  if (process.argv.includes('--json')) console.log(JSON.stringify(dead, null, 2));
  else {
    const tally = {};
    for (const k of dead) {
      const g = k.split('.').slice(0, 2).join('.');
      tally[g] = (tally[g] ?? 0) + 1;
    }
    console.log(dead.length, 'chiavi non riferite');
    console.log(tally);
  }
}
