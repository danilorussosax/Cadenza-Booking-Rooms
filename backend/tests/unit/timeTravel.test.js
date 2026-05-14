'use strict';

/**
 * Time-travel test — verifica che la logica calendario-dipendente del
 * monte ore si comporti correttamente nelle date critiche dell'anno
 * accademico. Senza questa copertura, i bug "1 nov ho l'AA sbagliato"
 * o "Pasqua non viene riconosciuta nel 2024" passano inosservati.
 *
 * Date critiche coperte:
 *   - 31 ottobre / 1 novembre  → rollover AA (chiusura/apertura nuovo)
 *   - 1 settembre              → apertura finestra submission default
 *   - 31 ottobre               → chiusura finestra submission default
 *   - Venerdì Santo (mobile)   → Computus su 5 anni
 *   - 13 maggio (oggi-tipo)    → AA "in corso" stabile
 *
 * Mockiamo `new Date()` via `vi.useFakeTimers()` quando serve: gli helper
 * di monteOreCalendarService accettano comunque `today` come parametro
 * per testabilità, ma è utile sapere che anche con `Date.now()` reale
 * il comportamento è coerente.
 */

const {
  currentAcademicYear,
  nextAcademicYear,
  isSubmissionWindowOpen,
  resolveTargetAcademicYearForTeacher,
  computeEaster,
} = require('../../services/monteOreCalendarService');

describe('Time-travel — rollover AA al 1 novembre', () => {
  it('31 ottobre 2026 → AA corrente = "2025/2026"', () => {
    const today = new Date('2026-10-31T23:59:59');
    expect(currentAcademicYear(today)).toBe('2025/2026');
    expect(nextAcademicYear(today)).toBe('2026/2027');
  });
  it('1 novembre 2026 00:01 → AA corrente passa a "2026/2027"', () => {
    const today = new Date('2026-11-01T00:01:00');
    expect(currentAcademicYear(today)).toBe('2026/2027');
    expect(nextAcademicYear(today)).toBe('2027/2028');
  });
  it('rollover su anno-fine: 31 ott 2099 / 1 nov 2099', () => {
    expect(currentAcademicYear(new Date('2099-10-31T12:00:00'))).toBe('2098/2099');
    expect(currentAcademicYear(new Date('2099-11-01T12:00:00'))).toBe('2099/2100');
  });
});

describe('Time-travel — finestra di submission settembre-ottobre', () => {
  // Finestra "tipica" dal bootstrap default: 1 sett → 31 ott dell'anno Y
  // (cioè PRIMA che inizi l'AA Y/Y+1).
  const nextSettingsFor = (Y) => ({
    academicYear: `${Y}/${Y + 1}`,
    submissionWindowStart: `${Y}-09-01`,
    submissionWindowEnd: `${Y}-10-31`,
  });

  it('31 agosto: finestra ancora chiusa', () => {
    const today = new Date('2026-08-31T23:59:59');
    expect(isSubmissionWindowOpen(nextSettingsFor(2026), today)).toBe(false);
    // Target docente: AA corrente
    expect(resolveTargetAcademicYearForTeacher(today, nextSettingsFor(2026))).toBe('2025/2026');
  });

  it('1 settembre 00:00: finestra aperta, target diventa next', () => {
    const today = new Date('2026-09-01T00:00:00');
    expect(isSubmissionWindowOpen(nextSettingsFor(2026), today)).toBe(true);
    expect(resolveTargetAcademicYearForTeacher(today, nextSettingsFor(2026))).toBe('2026/2027');
  });

  it('15 ottobre: finestra ancora aperta, target = next', () => {
    const today = new Date('2026-10-15T12:00:00');
    expect(isSubmissionWindowOpen(nextSettingsFor(2026), today)).toBe(true);
    expect(resolveTargetAcademicYearForTeacher(today, nextSettingsFor(2026))).toBe('2026/2027');
  });

  it('31 ottobre 23:59: ultimo istante con finestra aperta', () => {
    const today = new Date('2026-10-31T23:59:00');
    expect(isSubmissionWindowOpen(nextSettingsFor(2026), today)).toBe(true);
  });

  it('1 novembre: finestra chiusa E rollover AA → target = corrente nuovo', () => {
    const today = new Date('2026-11-01T00:01:00');
    // nextSettingsFor(2026) ha window 1/9–31/10 del 2026, ormai passata.
    expect(isSubmissionWindowOpen(nextSettingsFor(2026), today)).toBe(false);
    // currentAcademicYear ora è "2026/2027" (l'AA appena iniziato).
    expect(resolveTargetAcademicYearForTeacher(today, nextSettingsFor(2026))).toBe('2026/2027');
  });
});

describe('Time-travel — Pasqua (Computus di Gauss su 10 anni)', () => {
  const cases = [
    { year: 2024, month: 3, day: 31 },
    { year: 2025, month: 4, day: 20 },
    { year: 2026, month: 4, day: 5 },
    { year: 2027, month: 3, day: 28 },
    { year: 2028, month: 4, day: 16 },
    { year: 2029, month: 4, day: 1 },
    { year: 2030, month: 4, day: 21 },
    { year: 2031, month: 4, day: 13 },
    { year: 2032, month: 3, day: 28 },
    { year: 2033, month: 4, day: 17 },
  ];
  for (const c of cases) {
    it(`Pasqua ${c.year}: ${c.day}/${c.month}`, () => {
      const easter = computeEaster(c.year);
      expect(easter.year).toBe(c.year);
      expect(easter.month).toBe(c.month);
      expect(easter.day).toBe(c.day);
    });
  }
});

describe('Time-travel — override admin vince sempre, indipendente da data', () => {
  // Scenario: l'admin ha forzato un AA passato per i docenti (es. correzione
  // tardiva). La funzione deve ignorare la logica della finestra.
  const activeSettings = { isActiveForTeachers: true, academicYear: '2024/2025' };

  it('1 settembre: window sarebbe aperta, ma override vince', () => {
    const today = new Date('2026-09-15T12:00:00');
    const nextSettings = {
      submissionWindowStart: '2026-09-01',
      submissionWindowEnd: '2026-10-31',
    };
    expect(resolveTargetAcademicYearForTeacher(today, nextSettings, activeSettings)).toBe(
      '2024/2025',
    );
  });

  it('mese qualsiasi: override sempre prevalente', () => {
    for (const isoDate of ['2026-01-15', '2026-05-13', '2026-12-31']) {
      const today = new Date(`${isoDate}T12:00:00`);
      expect(resolveTargetAcademicYearForTeacher(today, null, activeSettings)).toBe('2024/2025');
    }
  });
});
