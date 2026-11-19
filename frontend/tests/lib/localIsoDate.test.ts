import { afterEach, describe, expect, it, vi } from 'vitest';
import { toLocalIsoDate, todayLocalIso } from '@/lib/date';
import { expandPreviewDates, emptyRecurrence } from '@/lib/recurrence';

// Le date sono costruite con componenti LOCALI espliciti, quindi i test sono
// validi in qualunque fuso (UTC, Europe/Rome, Pacific/Auckland, America/Los_Angeles).
const legacy = (d: Date) => d.toISOString().slice(0, 10);

describe('toLocalIsoDate', () => {
  it('mezzanotte locale: stessa data del calendario locale in ogni fuso', () => {
    expect(toLocalIsoDate(new Date(2026, 2, 29, 0, 0, 0))).toBe('2026-03-29');
  });

  it('23:30 locale: resta nello stesso giorno (il vecchio codice no a ovest di UTC)', () => {
    const d = new Date(2026, 2, 29, 23, 30, 0);
    expect(toLocalIsoDate(d)).toBe('2026-03-29');
    // Dimostrazione del bug: con offset negativo (es. Los Angeles) la data UTC è il giorno dopo.
    if (d.getTimezoneOffset() > 0) expect(legacy(d)).not.toBe('2026-03-29');
  });

  it('00:30 locale: il vecchio codice sbagliava a est di UTC', () => {
    const d = new Date(2026, 9, 25, 0, 30, 0);
    expect(toLocalIsoDate(d)).toBe('2026-10-25');
    if (d.getTimezoneOffset() < 0) expect(legacy(d)).toBe('2026-10-24');
  });

  it('cambio ora legale 29/03/2026 e 25/10/2026', () => {
    for (const [y, m, day] of [
      [2026, 2, 28],
      [2026, 2, 29],
      [2026, 2, 30],
      [2026, 9, 24],
      [2026, 9, 25],
      [2026, 9, 26],
    ] as const) {
      const expected = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      expect(toLocalIsoDate(new Date(y, m, day, 0, 0))).toBe(expected);
      expect(toLocalIsoDate(new Date(y, m, day, 12, 0))).toBe(expected);
      expect(toLocalIsoDate(new Date(y, m, day, 23, 59))).toBe(expected);
    }
  });

  it('fine mese, fine anno, bisestile', () => {
    expect(toLocalIsoDate(new Date(2026, 0, 31, 23, 59))).toBe('2026-01-31');
    expect(toLocalIsoDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
    expect(toLocalIsoDate(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01');
    expect(toLocalIsoDate(new Date(2028, 1, 29, 12, 0))).toBe('2028-02-29');
  });
});

describe('todayLocalIso', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('usa il giorno locale del «now» corrente', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 23, 30, 0));
    expect(todayLocalIso()).toBe('2026-03-29');
    vi.setSystemTime(new Date(2026, 11, 31, 0, 15, 0));
    expect(todayLocalIso()).toBe('2026-12-31');
  });
});

describe('expandPreviewDates (date locali)', () => {
  const rule = { ...emptyRecurrence(), frequency: 'daily' as const, endDate: '2026-04-02' };

  it('attraversa il cambio ora legale senza saltare/duplicare giorni', () => {
    expect(expandPreviewDates(rule, '2026-03-28')).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
    ]);
  });

  it('settimanale a cavallo del 25/10/2026', () => {
    const weekly = { ...emptyRecurrence(), endDate: '2026-11-08' };
    expect(expandPreviewDates(weekly, '2026-10-18')).toEqual([
      '2026-10-18',
      '2026-10-25',
      '2026-11-01',
      '2026-11-08',
    ]);
  });
});
