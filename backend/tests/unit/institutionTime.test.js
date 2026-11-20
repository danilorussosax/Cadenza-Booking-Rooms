'use strict';

const it_ = require('../../lib/institutionTime');
const {
  currentAcademicYear,
  isSubmissionWindowOpen,
} = require('../../services/monteOreCalendarService');

afterEach(() => it_.resetClock());

describe('institutionTime — fuso e orologio', () => {
  it('default Europe/Rome', () => {
    expect(it_.getTimezone()).toBe('Europe/Rome');
  });

  it('orologio fisso e reset', () => {
    it_.setClock(new Date('2026-05-13T10:00:00Z'));
    expect(it_.now().toISOString()).toBe('2026-05-13T10:00:00.000Z');
    it_.resetClock();
    expect(Math.abs(it_.now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('configure ignora fusi non validi', () => {
    expect(it_.configure({ timezone: 'Non/Existe' })).toBe('Europe/Rome');
  });
});

describe('institutionTime — mezzanotte', () => {
  it('23:30 UTC del 18 nov è già il 19 a Roma (CET)', () => {
    expect(it_.todayIso(new Date('2026-11-18T23:30:00Z'))).toBe('2026-11-19');
  });
  it('22:30 UTC estate (CEST) è già il giorno dopo; 21:30 UTC no', () => {
    expect(it_.todayIso(new Date('2026-07-10T22:30:00Z'))).toBe('2026-07-11');
    expect(it_.todayIso(new Date('2026-07-10T21:30:00Z'))).toBe('2026-07-10');
  });
  it('startOfDay / endOfDay sono i confini del giorno di Roma', () => {
    const at = new Date('2026-11-18T23:30:00Z');
    expect(it_.startOfDay(at).toISOString()).toBe('2026-11-18T23:00:00.000Z');
    expect(it_.endOfDay(at).toISOString()).toBe('2026-11-19T22:59:59.999Z');
  });
  it('usa l’orologio sostituibile per "oggi"', () => {
    it_.setClock(new Date('2026-11-18T23:30:00Z'));
    expect(it_.todayIso()).toBe('2026-11-19');
    expect(it_.startOfDay(undefined, 1).toISOString()).toBe('2026-11-19T23:00:00.000Z');
  });
});

describe('institutionTime — settimana ISO', () => {
  it('lunedì 00:30 Roma appartiene alla settimana che inizia quel giorno', () => {
    const at = new Date('2026-11-22T23:30:00Z'); // lunedì 23 nov 00:30 Roma
    expect(it_.startOfIsoWeek(at).toISOString()).toBe('2026-11-22T23:00:00.000Z');
    expect(it_.endOfIsoWeek(at).toISOString()).toBe('2026-11-29T22:59:59.999Z');
  });
});

describe('institutionTime — cambio ora legale', () => {
  it('ultima domenica di marzo (29/03/2026): 03:30 CEST = 01:30Z', () => {
    expect(it_.atLocal('2026-03-29', '03:30').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(it_.atLocal('2026-03-28', '12:00').toISOString()).toBe('2026-03-28T11:00:00.000Z');
    expect(it_.atLocal('2026-03-30', '12:00').toISOString()).toBe('2026-03-30T10:00:00.000Z');
  });
  it('ultima domenica di ottobre (25/10/2026): 12:00 è CET = 11:00Z, il giorno dura 25h', () => {
    expect(it_.atLocal('2026-10-25', '12:00').toISOString()).toBe('2026-10-25T11:00:00.000Z');
    const s = it_.startOfDay(new Date('2026-10-25T12:00:00Z'));
    const e = it_.endOfDay(new Date('2026-10-25T12:00:00Z'));
    expect(s.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(e.toISOString()).toBe('2026-10-25T22:59:59.999Z');
  });
  it('hhmmOf è l’inverso di atLocal attraverso i cambi', () => {
    for (const [d, h] of [
      ['2026-03-29', '03:30'],
      ['2026-10-25', '12:00'],
      ['2026-10-25', '01:15'],
      ['2026-07-01', '08:00'],
    ]) {
      expect(it_.hhmmOf(it_.atLocal(d, h))).toBe(h);
    }
  });
});

describe('institutionTime — anno accademico', () => {
  it('31 ottobre 23:59 Roma → 2025/2026; 1 novembre 00:00 Roma → 2026/2027', () => {
    expect(it_.academicYearOf(it_.atLocal('2026-10-31', '23:59'))).toBe('2025/2026');
    expect(it_.academicYearOf(it_.atLocal('2026-11-01', '00:00'))).toBe('2026/2027');
  });
  it('31/10 alle 23:30 UTC è già 1 novembre a Roma, a prescindere dal TZ del processo', () => {
    expect(currentAcademicYear(new Date('2026-10-31T23:30:00Z'))).toBe('2026/2027');
    expect(currentAcademicYear(new Date('2026-10-31T22:30:00Z'))).toBe('2025/2026');
  });
  it('capodanno: 31/12 23:30 UTC è già il 1 gennaio a Roma', () => {
    expect(it_.academicYearOf(new Date('2026-12-31T23:30:00Z'))).toBe('2026/2027');
  });
  it('currentAcademicYear senza argomento segue l’orologio', () => {
    it_.setClock(new Date('2026-10-31T23:30:00Z'));
    expect(currentAcademicYear()).toBe('2026/2027');
  });
});

describe('regressione finestre su server UTC', () => {
  const settings = {
    status: 'published',
    submissionWindowStart: '2026-09-01',
    submissionWindowEnd: '2026-10-31',
  };
  it('31/10 23:30 UTC è già 1/11 a Roma → finestra chiusa', () => {
    expect(isSubmissionWindowOpen(settings, new Date('2026-10-31T23:30:00Z'))).toBe(false);
    expect(isSubmissionWindowOpen(settings, new Date('2026-10-31T22:30:00Z'))).toBe(true);
  });
  it('31/8 22:30 UTC è già 1/9 a Roma → finestra aperta', () => {
    expect(isSubmissionWindowOpen(settings, new Date('2026-08-31T22:30:00Z'))).toBe(true);
    expect(isSubmissionWindowOpen(settings, new Date('2026-08-31T21:30:00Z'))).toBe(false);
  });
  it('senza argomento usa l’orologio istituzionale', () => {
    it_.setClock(new Date('2026-08-31T22:30:00Z'));
    expect(isSubmissionWindowOpen(settings)).toBe(true);
  });
});

describe('institutionTime — helper di ora/giorno/mese', () => {
  it('hourOf / minutesOfDay / dayOfWeek in ora di Roma', () => {
    const at = new Date('2026-07-10T22:30:00Z'); // sab 11/07 00:30 CEST
    expect(it_.hourOf(at)).toBe(0);
    expect(it_.minutesOfDay(at)).toBe(30);
    expect(it_.dayOfWeek(at)).toBe(6);
    expect(it_.minutesOfDay(new Date('2026-07-10T07:00:00Z'))).toBe(9 * 60);
  });

  it('startOfMonth / endOfMonth sono i confini del mese di Roma', () => {
    const at = new Date('2026-10-31T23:30:00Z'); // 1/11 00:30 CET
    expect(it_.startOfMonth(at).toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(it_.endOfMonth(at).toISOString()).toBe('2026-11-30T22:59:59.999Z');
  });

  it('calendarDaysBetween conta giorni di calendario, non ore', () => {
    const a = new Date('2026-11-20T22:30:00Z'); // 20/11 23:30
    const b = new Date('2026-11-20T23:30:00Z'); // 21/11 00:30
    expect(it_.calendarDaysBetween(b, a)).toBe(1);
    expect(it_.calendarDaysBetween(a, a)).toBe(0);
    expect(
      it_.calendarDaysBetween(new Date('2026-03-30T10:00:00Z'), new Date('2026-03-28T10:00:00Z')),
    ).toBe(2);
  });

  it('sqlTimezoneLiteral quota il fuso configurato', () => {
    expect(it_.sqlTimezoneLiteral()).toBe("'Europe/Rome'");
  });

  it('setClock con fixedClock governa now() e gli helper senza argomento', () => {
    it_.setClock(it_.fixedClock('2026-11-20T23:30:00Z'));
    expect(it_.todayIso()).toBe('2026-11-21');
    expect(it_.dayOfWeek()).toBe(6);
  });
});
