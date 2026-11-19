'use strict';

/**
 * Catalogo codici errore (ratchet).
 *
 * Ogni `code` letterale emesso dal backend deve avere `errors.code.<CODE>` in
 * tutte e 5 le lingue, oppure stare in `INTERNAL_ONLY_CODES` (con motivo) o nel
 * file di baseline dei codici storici ancora da tradurre. Fallisce se:
 *  - un codice NUOVO non è tradotto né in allowlist;
 *  - un codice in baseline è stato nel frattempo tradotto (va tolto dal file);
 *  - le allowlist crescono oltre il cap.
 */
const fs = require('fs');
const path = require('path');
const { scanEmittedCodes } = require('../helpers/scanErrorCodes');
const { INTERNAL_ONLY_CODES } = require('../../lib/errorCodes');
const baseline = require('../fixtures/errorCodesUntranslatedBaseline.json');

const LANGS = ['it', 'en', 'es', 'de', 'fr'];
const LOCALES_DIR = path.resolve(__dirname, '../../../frontend/src/i18n/locales');
const MAX_INTERNAL_ONLY = 20;

const locales = Object.fromEntries(
  LANGS.map((l) => [
    l,
    JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${l}.json`), 'utf8')).errors.code,
  ]),
);
const isTranslatedEverywhere = (code) => LANGS.every((l) => typeof locales[l][code] === 'string');
const emitted = scanEmittedCodes();

describe('catalogo codici errore', () => {
  it('lo scanner trova i codici emessi (sanity)', () => {
    expect(emitted).toContain('BOOKING_CONFLICT');
    expect(emitted.length).toBeGreaterThan(100);
  });

  it('le 5 lingue hanno le stesse chiavi errors.code', () => {
    const ref = Object.keys(locales.it).sort();
    for (const l of LANGS) expect(Object.keys(locales[l]).sort()).toEqual(ref);
  });

  it('ogni codice emesso è tradotto in 5 lingue, in allowlist o in baseline', () => {
    const unknown = emitted.filter(
      (c) =>
        !isTranslatedEverywhere(c) &&
        !(c in INTERNAL_ONLY_CODES) &&
        !baseline.untranslated.includes(c),
    );
    expect(
      unknown,
      `Codici nuovi senza traduzione: aggiungi errors.code.<CODE> in it/en/es/de/fr.json ` +
        `(o INTERNAL_ONLY_CODES in lib/errorCodes.js con motivo): ${unknown.join(', ')}`,
    ).toEqual([]);
  });

  it('la baseline non contiene codici ormai tradotti', () => {
    const translated = baseline.untranslated.filter(isTranslatedEverywhere);
    expect(translated, `Ora tradotti: rimuovili dalla baseline: ${translated.join(', ')}`).toEqual(
      [],
    );
  });

  it('l’allowlist tecnica ha motivazioni, non contiene codici tradotti e non cresce', () => {
    const entries = Object.entries(INTERNAL_ONLY_CODES);
    expect(entries.length).toBeLessThanOrEqual(MAX_INTERNAL_ONLY);
    for (const [code, reason] of entries) {
      expect(reason.length, code).toBeGreaterThan(10);
      expect(isTranslatedEverywhere(code), `${code} è tradotto: toglilo dall'allowlist`).toBe(
        false,
      );
    }
  });
});
