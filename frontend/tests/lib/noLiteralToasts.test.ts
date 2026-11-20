import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guardia anti-regressione i18n: nel codice sorgente non devono comparire
 * notifiche (`toast.*`) o dialog nativi (`confirm`/`alert`) con testo
 * letterale. Ogni testo visibile all'utente passa da `t('…')` / `i18n.t('…')`.
 *
 * Regole:
 *  (a) il primo argomento di `toast.*(…)`, `confirm(…)`, `alert(…)` non puo'
 *      essere una stringa/template letterale;
 *  (b) nel resto della chiamata (fallback `?? '…'`, `description: '…'`,
 *      `label: '…'`) non sono ammessi letterali che sembrano testo umano
 *      (contengono spazi, iniziano con maiuscola o hanno lettere accentate).
 *      Sono invece ammessi i letterali di confronto (`=== 'auto_approved'`) e
 *      quelli dentro `t(…)`.
 */

const SRC = resolve(__dirname, '../../src');

/**
 * Allowlist esplicita (file relativo a src/ -> letterali tollerati).
 * Solo casi inevitabili: qui un acronimo internazionale usato come fallback
 * di `err.message`, identico in tutte le lingue.
 */
const ALLOWLIST: Record<string, string[]> = {
  'pages/admin/instruments/LoansTab.tsx': ['PDF'],
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const CALL_RE = /(?<![\w$.])(?:window\.)?(?:confirm|alert)\(|\btoast(?:\.\w+)?\(/g;
const LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function callAt(src: string, start: number, openLen: number): string {
  let i = start + openLen;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  return src.slice(start, i);
}

function looksHuman(text: string): boolean {
  return /\s/.test(text) || /^[A-ZÀ-Ý]/.test(text) || /[À-ÿ]/.test(text);
}

function violations(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const rel = relative(SRC, file).split('\\').join('/');
  const allowed = new Set(ALLOWLIST[rel] ?? []);
  const found: string[] = [];
  for (const m of src.matchAll(CALL_RE)) {
    const call = callAt(src, m.index, m[0].length);
    const line = src.slice(0, m.index).split('\n').length;
    const args = call.slice(m[0].length);
    // (a) primo argomento letterale non vuoto
    const first = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(args);
    if (first && first[2].trim() !== '' && !allowed.has(first[2])) {
      found.push(`${rel}:${line}  ${call.replace(/\s+/g, ' ').slice(0, 90)}`);
      continue;
    }
    // (b) letterali "umani" residui (esclusi t(...) e confronti)
    const stripped = args
      .replace(/\bt\(\s*(['"`])(?:\\.|(?!\1)[^\\])*\1[^)]*\)/g, '')
      .replace(/[=!]==\s*(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '');
    for (const lit of stripped.matchAll(LITERAL_RE)) {
      if (lit[2].trim() !== '' && looksHuman(lit[2]) && !allowed.has(lit[2])) {
        found.push(`${rel}:${line}  ${call.replace(/\s+/g, ' ').slice(0, 90)}`);
        break;
      }
    }
  }
  return found;
}

describe('testi utente non letterali', () => {
  it('toast / confirm / alert non contengono testo letterale (usa t(...))', () => {
    const all = walk(SRC).flatMap(violations);
    expect(all).toEqual([]);
  });

  it("l'allowlist non contiene voci obsolete", () => {
    for (const [rel, lits] of Object.entries(ALLOWLIST)) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      for (const l of lits) expect(src).toContain(`'${l}'`);
    }
  });
});
