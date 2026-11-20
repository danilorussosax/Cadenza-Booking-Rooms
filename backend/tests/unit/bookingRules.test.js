'use strict';

const rules = require('../../services/bookingRules');
const institutionTime = require('../../lib/institutionTime');

afterEach(() => institutionTime.resetClock());

const baseRule = {
  minBookingDurationMinutes: 30,
  maxBookingDurationMinutes: 120,
  maxAdvanceDays: 14,
  minAdvanceHours: 2,
  allowedStartTime: '08:00',
  allowedEndTime: '22:00',
};
const msgs = (list) => list.map((i) => i.message);

describe('bookingRules — ordine date e passato', () => {
  it('fine <= inizio produce un problema', () => {
    const a = new Date('2026-11-20T10:00:00Z');
    expect(rules.endAfterStartIssues(a, a)).toHaveLength(1);
    expect(rules.endAfterStartIssues(a, new Date('2026-11-20T11:00:00Z'))).toEqual([]);
  });

  it('passato rifiutato salvo bypass', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const past = new Date('2026-11-20T09:00:00Z');
    expect(msgs(rules.notInPastIssues(past, now))).toEqual(['Non puoi prenotare nel passato']);
    expect(rules.notInPastIssues(past, now, { bypassPastDates: true })).toEqual([]);
  });
});

describe('bookingRules — durata', () => {
  it('min e max per ruolo', () => {
    expect(msgs(rules.durationIssues({ durationMin: 15, rule: baseRule }))).toEqual([
      'Durata minima prenotazione: 30 minuti',
    ]);
    expect(msgs(rules.durationIssues({ durationMin: 150, rule: baseRule }))).toEqual([
      'Durata massima prenotazione: 120 minuti',
    ]);
    expect(rules.durationIssues({ durationMin: 60, rule: baseRule })).toEqual([]);
  });

  it('floor aggiuntivo per studio individuale', () => {
    const rule = { ...baseRule, minBookingDurationMinutes: 15 };
    expect(rules.durationIssues({ durationMin: 30, rule, type: 'studio_individuale' })).toEqual([
      { message: 'Durata minima per lo studio individuale: 60 minuti', code: null },
    ]);
    expect(rules.durationIssues({ durationMin: 30, rule, type: 'lezione' })).toEqual([]);
  });

  it('bypassDuration salta tutto', () => {
    expect(rules.durationIssues({ durationMin: 1, rule: baseRule, bypassDuration: true })).toEqual(
      [],
    );
  });
});

describe('bookingRules — anticipo', () => {
  const now = new Date('2026-11-20T10:00:00Z');

  it('minimo in ore', () => {
    const start = new Date('2026-11-20T11:00:00Z');
    expect(msgs(rules.advanceIssues({ start, now, rule: baseRule }))).toEqual([
      "Devi prenotare almeno 2 ore prima dell'inizio",
    ]);
  });

  it('massimo in giorni di calendario istituzionali', () => {
    const ok = new Date('2026-12-04T10:00:00Z'); // +14 giorni
    const tooFar = new Date('2026-12-05T10:00:00Z'); // +15
    expect(rules.advanceIssues({ start: ok, now, rule: baseRule })).toEqual([]);
    expect(msgs(rules.advanceIssues({ start: tooFar, now, rule: baseRule }))).toEqual([
      'Puoi prenotare al massimo con 14 giorni di anticipo',
    ]);
  });

  it('il giorno è quello di Roma, non quello del processo', () => {
    // now = 20/11 23:30 Roma (22:30Z). start = 21/11 00:30 Roma (23:30Z): 1 giorno di calendario.
    const n = new Date('2026-11-20T22:30:00Z');
    const rule = { ...baseRule, maxAdvanceDays: 0, minAdvanceHours: 0 };
    expect(
      msgs(rules.advanceIssues({ start: new Date('2026-11-20T23:30:00Z'), now: n, rule })),
    ).toEqual(['Puoi prenotare al massimo con 0 giorni di anticipo']);
    expect(rules.advanceIssues({ start: new Date('2026-11-20T22:45:00Z'), now: n, rule })).toEqual(
      [],
    );
  });

  it('bypassAdvance salta tutto', () => {
    const start = new Date('2027-06-01T10:00:00Z');
    expect(rules.advanceIssues({ start, now, rule: baseRule, bypassAdvance: true })).toEqual([]);
  });
});

describe('bookingRules — fascia oraria consentita (ora di Roma)', () => {
  it('09:00 Roma estate (07:00Z) è dentro 08-22', () => {
    const start = new Date('2026-07-10T07:00:00Z');
    const end = new Date('2026-07-10T08:00:00Z');
    expect(rules.allowedWindowIssues({ start, end, rule: baseRule })).toEqual([]);
  });

  it('07:30 Roma inverno (06:30Z) è fuori', () => {
    const start = new Date('2026-11-20T06:30:00Z');
    const end = new Date('2026-11-20T07:30:00Z');
    expect(msgs(rules.allowedWindowIssues({ start, end, rule: baseRule }))).toEqual([
      'Le prenotazioni sono consentite solo dalle 08:00 alle 22:00',
    ]);
  });

  it('fine dopo le 22 rifiutata, fine a mezzanotte accettata', () => {
    const start = new Date('2026-11-20T20:00:00Z'); // 21:00 Roma
    expect(
      rules.allowedWindowIssues({ start, end: new Date('2026-11-20T21:30:00Z'), rule: baseRule }),
    ).toHaveLength(1);
    expect(
      rules.allowedWindowIssues({ start, end: new Date('2026-11-20T23:00:00Z'), rule: baseRule }),
    ).toEqual([]);
  });

  it('senza fascia configurata non produce problemi', () => {
    const rule = { ...baseRule, allowedStartTime: null };
    const s = new Date('2026-11-20T01:00:00Z');
    expect(rules.allowedWindowIssues({ start: s, end: s, rule })).toEqual([]);
  });
});

describe('bookingRules — eccezioni e finestre HH:mm', () => {
  it('exceptionAppliesToDate usa giorno e data di Roma', () => {
    // 23:30Z del 20/11 (venerdì) = sabato 21/11 00:30 Roma
    const at = new Date('2026-11-20T23:30:00Z');
    expect(rules.exceptionAppliesToDate({ daysOfWeek: [6] }, at)).toBe(true);
    expect(rules.exceptionAppliesToDate({ daysOfWeek: [5] }, at)).toBe(false);
    expect(rules.exceptionAppliesToDate({ dateFrom: '2026-11-21' }, at)).toBe(true);
    expect(rules.exceptionAppliesToDate({ dateTo: '2026-11-20' }, at)).toBe(false);
    expect(rules.exceptionAppliesToDate({ daysOfWeek: [], dateFrom: null }, at)).toBe(true);
  });

  it('overlapsWindow / minutesInsideWindow', () => {
    const s = new Date('2026-11-20T13:00:00Z'); // 14:00 Roma
    const e = new Date('2026-11-20T15:00:00Z'); // 16:00 Roma
    expect(rules.overlapsWindow(s, e, '15:00', '18:00')).toBe(true);
    expect(rules.overlapsWindow(s, e, '16:00', '18:00')).toBe(false);
    expect(rules.overlapsWindow(s, e, null, null)).toBe(true);
    expect(rules.minutesInsideWindow(s, e, '15:00', '18:00')).toBe(60);
    expect(rules.minutesInsideWindow(s, e, '17:00', '18:00')).toBe(0);
    expect(rules.minutesInsideWindow(s, e, null, null)).toBe(120);
  });
});
