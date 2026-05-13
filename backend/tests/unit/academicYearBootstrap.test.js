'use strict';

/**
 * Unit: Academic Year Bootstrap.
 *
 * - Computus (algoritmo di Gauss) su valori noti.
 * - `nextAcademicYear` su varie date.
 * - `isSubmissionWindowOpen` su confini inclusivi.
 * - `bootstrapAcademicYear` (mode='default'):
 *     • 8 festività deterministiche + 1 Pasqua = 9 entry totali
 *     • idempotente su re-run (no duplicati)
 */

const {
  computeEaster,
  currentAcademicYear,
  nextAcademicYear,
  isSubmissionWindowOpen,
  resolveTargetAcademicYearForTeacher,
} = require('../../services/monteOreCalendarService');
const {
  bootstrapAcademicYear,
  defaultHolidaysFor,
  defaultSettingsFor,
  firstMondayFrom,
} = require('../../services/academicYearBootstrap');
const { MonteOreSettings, MonteOreSuspension, Institute } = require('../../models');

describe('Computus (computeEaster) — valori noti', () => {
  const cases = [
    { y: 2024, m: 3, d: 31 },
    { y: 2025, m: 4, d: 20 },
    { y: 2026, m: 4, d: 5 },
    { y: 2027, m: 3, d: 28 },
    { y: 2030, m: 4, d: 21 },
  ];
  for (const c of cases) {
    it(`Pasqua ${c.y} = ${c.d}/${c.m}`, () => {
      const e = computeEaster(c.y);
      expect(e).toEqual({ year: c.y, month: c.m, day: c.d });
    });
  }
});

describe('nextAcademicYear', () => {
  it('13 maggio 2026 → 2026/2027', () => {
    expect(nextAcademicYear(new Date('2026-05-13T12:00:00Z'))).toBe('2026/2027');
  });
  it('15 nov 2026 → 2027/2028', () => {
    expect(nextAcademicYear(new Date('2026-11-15T12:00:00Z'))).toBe('2027/2028');
  });
  it('1 nov 2026 → 2027/2028 (AA "2026/2027" già iniziato)', () => {
    expect(nextAcademicYear(new Date('2026-11-01T12:00:00Z'))).toBe('2027/2028');
  });
  it('31 ott 2026 → 2026/2027 (AA "2025/2026" ancora in corso)', () => {
    expect(nextAcademicYear(new Date('2026-10-31T12:00:00Z'))).toBe('2026/2027');
  });
});

describe('isSubmissionWindowOpen', () => {
  const settings = {
    submissionWindowStart: '2026-09-01',
    submissionWindowEnd: '2026-10-31',
  };
  it('dentro la finestra → true', () => {
    expect(isSubmissionWindowOpen(settings, new Date('2026-09-15T12:00:00'))).toBe(true);
  });
  it('estremo iniziale incluso', () => {
    expect(isSubmissionWindowOpen(settings, new Date('2026-09-01T12:00:00'))).toBe(true);
  });
  it('estremo finale incluso', () => {
    // Usiamo un orario "metà giornata" per evitare ambiguità di timezone:
    // dayjs(today).format('YYYY-MM-DD') usa il TZ locale del runner.
    expect(isSubmissionWindowOpen(settings, new Date('2026-10-31T12:00:00'))).toBe(true);
  });
  it('fuori finestra (prima) → false', () => {
    expect(isSubmissionWindowOpen(settings, new Date('2026-08-31T12:00:00'))).toBe(false);
  });
  it('fuori finestra (dopo) → false', () => {
    expect(isSubmissionWindowOpen(settings, new Date('2026-11-01T12:00:00'))).toBe(false);
  });
  it('settings null → false', () => {
    expect(isSubmissionWindowOpen(null)).toBe(false);
  });
});

describe('resolveTargetAcademicYearForTeacher', () => {
  it('finestra next aperta → AA next', () => {
    const today = new Date('2026-09-15T12:00:00Z');
    const nextSettings = {
      submissionWindowStart: '2026-09-01',
      submissionWindowEnd: '2026-10-31',
    };
    expect(resolveTargetAcademicYearForTeacher(today, nextSettings)).toBe('2026/2027');
  });
  it('finestra next chiusa → AA corrente', () => {
    const today = new Date('2026-05-13T12:00:00Z');
    const nextSettings = {
      submissionWindowStart: '2026-09-01',
      submissionWindowEnd: '2026-10-31',
    };
    expect(resolveTargetAcademicYearForTeacher(today, nextSettings)).toBe(
      currentAcademicYear(today),
    );
  });
  it('nessun nextSettings → AA corrente', () => {
    const today = new Date('2026-09-15T12:00:00Z');
    expect(resolveTargetAcademicYearForTeacher(today, null)).toBe(currentAcademicYear(today));
  });
});

describe('defaultSettingsFor / firstMondayFrom', () => {
  it('settings AA "2025/2026" coerenti', () => {
    const s = defaultSettingsFor('2025/2026');
    expect(s.academicYearStart).toBe('2025-11-01');
    expect(s.academicYearEnd).toBe('2026-10-31');
    // 1 nov 2025 = sabato → primo lunedì utile = 3 nov 2025
    expect(s.lessonsStartDate).toBe('2025-11-03');
    expect(s.lessonsEndDate).toBe('2026-10-31');
    expect(s.submissionWindowStart).toBe('2025-09-01');
    expect(s.submissionWindowEnd).toBe('2025-10-31');
    expect(s.minRequiredHours).toBe(324);
    expect(s.maxAmendmentsPerYear).toBe(3);
  });
  it('AA "2026/2027" → primo lunedì utile = 2 nov 2026', () => {
    const s = defaultSettingsFor('2026/2027');
    // 1 nov 2026 = domenica → lunedì = 2 nov 2026
    expect(s.lessonsStartDate).toBe('2026-11-02');
  });
  it('firstMondayFrom su una data che è già lunedì', () => {
    // 2 nov 2026 è lunedì
    expect(firstMondayFrom('2026-11-02')).toBe('2026-11-02');
  });
});

describe('defaultHolidaysFor — AA "2026/2027"', () => {
  const list = defaultHolidaysFor('2026/2027');
  it('produce 8 festività deterministiche', () => {
    expect(list).toHaveLength(8);
  });
  it('include Vacanze di Pasqua basate su Computus', () => {
    // Pasqua 2027 = 28 marzo (cattolica)
    const easter = list.find((h) => h.name === 'Vacanze di Pasqua');
    expect(easter).toBeTruthy();
    expect(easter.dateFrom).toBe('2027-03-26'); // venerdì santo
    expect(easter.dateTo).toBe('2027-03-30'); // martedì dopo Pasqua
    expect(easter.kind).toBe('full_week');
  });
  it('Vacanze di Natale = 24/12 → 6/1', () => {
    const nat = list.find((h) => h.name === 'Vacanze di Natale');
    expect(nat.dateFrom).toBe('2026-12-24');
    expect(nat.dateTo).toBe('2027-01-06');
    expect(nat.kind).toBe('full_week');
  });
  it('Tutti i Santi/Immacolata sono partial', () => {
    const ts = list.find((h) => h.name === 'Tutti i Santi');
    const imm = list.find((h) => h.name === 'Immacolata');
    expect(ts.kind).toBe('partial');
    expect(imm.kind).toBe('partial');
  });
  it('tutte le entries hanno category="holiday"', () => {
    for (const h of list) expect(h.category).toBe('holiday');
  });
});

describe('bootstrapAcademicYear (mode=default) — integrazione DB', () => {
  let instituteId;
  beforeEach(async () => {
    await globalThis.resetDatabase();
    const inst = await Institute.create({
      name: 'Conservatorio Test',
      code: 'TEST',
      city: 'Roma',
      country: 'Italia',
    });
    instituteId = inst.id;
  });

  it('crea settings + 8 festività (= 1 Pasqua inclusa)', async () => {
    const res = await bootstrapAcademicYear({
      academicYear: '2026/2027',
      instituteId,
    });
    expect(res.suspensionsCreated).toBe(8);
    expect(res.suspensionsSkipped).toBe(0);
    expect(res.settings.academicYear).toBe('2026/2027');

    const sus = await MonteOreSuspension.findAll({
      where: { instituteId, academicYear: '2026/2027' },
    });
    expect(sus).toHaveLength(8);
    // Tutte category=holiday
    for (const s of sus) expect(s.category).toBe('holiday');
  });

  it('idempotente: secondo run non duplica', async () => {
    await bootstrapAcademicYear({ academicYear: '2026/2027', instituteId });
    const second = await bootstrapAcademicYear({ academicYear: '2026/2027', instituteId });
    expect(second.suspensionsCreated).toBe(0);
    expect(second.suspensionsSkipped).toBe(8);
    const count = await MonteOreSuspension.count({
      where: { instituteId, academicYear: '2026/2027' },
    });
    expect(count).toBe(8);
  });

  it('overwrite=true ricrea i settings se esistenti', async () => {
    const first = await MonteOreSettings.create({
      instituteId,
      academicYear: '2026/2027',
      academicYearStart: '2026-11-01',
      academicYearEnd: '2027-10-31',
      lessonsStartDate: '2026-11-15', // valore "anomalo"
      lessonsEndDate: '2027-06-30',
      submissionWindowStart: '2026-09-01',
      submissionWindowEnd: '2026-10-31',
      minRequiredHours: 300,
      maxAmendmentsPerYear: 5,
    });
    await bootstrapAcademicYear({
      academicYear: '2026/2027',
      instituteId,
      overwrite: true,
    });
    await first.reload();
    expect(first.lessonsStartDate).toBe('2026-11-02');
    expect(first.minRequiredHours).toBe(324);
    expect(first.maxAmendmentsPerYear).toBe(3);
  });

  it('rifiuta academicYear non valido', async () => {
    await expect(bootstrapAcademicYear({ academicYear: '2026-2027', instituteId })).rejects.toThrow(
      /non valido/,
    );
    await expect(bootstrapAcademicYear({ academicYear: '2026/2028', instituteId })).rejects.toThrow(
      /coerente/,
    );
  });
});
