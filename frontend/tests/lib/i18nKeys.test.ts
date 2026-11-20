import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
// @ts-expect-error modulo .mjs condiviso con lo script CLI (nessun tipo)
import * as analysis from '../../scripts/i18nKeys.mjs';

interface Analysis {
  LANGS: string[];
  flatten: (o: object) => Record<string, unknown>;
  loadLocale: (lang: string) => object;
  allKeys: () => string[];
  readSources: () => string;
  findUnreferenced: (src: string, keys: string[], minDepth?: number) => string[];
}
const { LANGS, flatten, loadLocale, allKeys, readSources, findUnreferenced } =
  analysis as unknown as Analysis;

describe('chiavi i18n', () => {
  it('le 5 lingue hanno lo stesso insieme di chiavi', () => {
    const reference = new Set(Object.keys(flatten(loadLocale('it'))));
    for (const lang of LANGS) {
      const keys = new Set(Object.keys(flatten(loadLocale(lang))));
      expect({ lang, missing: [...reference].filter((k) => !keys.has(k)) }).toEqual({
        lang,
        missing: [],
      });
      expect({ lang, extra: [...keys].filter((k) => !reference.has(k)) }).toEqual({
        lang,
        extra: [],
      });
    }
  });

  it('il numero di chiavi non riferite non cresce (ratchet)', () => {
    const baseline = new Set(
      JSON.parse(
        readFileSync(resolve(__dirname, '../fixtures/i18nUnreferencedBaseline.json'), 'utf8'),
      ) as string[],
    );
    const unreferenced = findUnreferenced(readSources(), allKeys(), 1);
    const added = unreferenced.filter((k) => !baseline.has(k));
    // Nuove chiavi non riferite: usale nel codice, rimuovile, oppure (solo se
    // dinamiche) rigenera la baseline con `node scripts/writeI18nBaseline.mjs`.
    expect(added).toEqual([]);
  });
});
