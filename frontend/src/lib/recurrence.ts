/**
 * Helper condivisi per il form di ricorrenza prenotazioni (F2 MRBS-style).
 *
 * `expandPreviewDates` replica `backend/services/recurrenceExpander.js`
 * per dare un preview live nel form senza round-trip al server.
 * Allineato a:
 *   - cap MAX_OCCURRENCES = 52
 *   - default byWeekday = giorno della settimana di startDate
 *   - excludeDates skip-per-data
 */

export type WeekdayCode = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export interface RecurrenceState {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  interval: number; // 1..12
  byWeekday: WeekdayCode[]; // significativo solo se weekly
  endDate: string; // YYYY-MM-DD
  excludeDates: string[];
  skipConflicts: boolean;
}

export const WEEKDAYS: { code: WeekdayCode; jsDay: number }[] = [
  { code: 'MO', jsDay: 1 },
  { code: 'TU', jsDay: 2 },
  { code: 'WE', jsDay: 3 },
  { code: 'TH', jsDay: 4 },
  { code: 'FR', jsDay: 5 },
  { code: 'SA', jsDay: 6 },
  { code: 'SU', jsDay: 0 },
];

export const MAX_OCCURRENCES = 52;

export function emptyRecurrence(): RecurrenceState {
  return {
    enabled: false,
    frequency: 'weekly',
    interval: 1,
    byWeekday: [],
    endDate: '',
    excludeDates: [],
    skipConflicts: true,
  };
}

export function expandPreviewDates(
  rule: Omit<RecurrenceState, 'enabled' | 'skipConflicts'>,
  startDate: string,
): string[] {
  if (!startDate || !rule.endDate) return [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(rule.endDate + 'T23:59:59');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (end < start) return [];

  const excluded = new Set(rule.excludeDates);
  const out: string[] = [];
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  if (rule.frequency === 'daily') {
    const cur = new Date(start);
    while (cur <= end && out.length < MAX_OCCURRENCES) {
      const iso = fmt(cur);
      if (!excluded.has(iso)) out.push(iso);
      cur.setDate(cur.getDate() + rule.interval);
    }
    return out;
  }

  // weekly
  const defaultDay: WeekdayCode = WEEKDAYS.find((w) => w.jsDay === start.getDay())?.code ?? 'MO';
  const activeDays = new Set(
    (rule.byWeekday.length > 0 ? rule.byWeekday : [defaultDay]).map(
      (code) => WEEKDAYS.find((w) => w.code === code)?.jsDay ?? -1,
    ),
  );
  const weekCursor = new Date(start);
  weekCursor.setDate(weekCursor.getDate() - weekCursor.getDay()); // domenica della settimana di start
  while (weekCursor <= end && out.length < MAX_OCCURRENCES) {
    for (let d = 0; d < 7 && out.length < MAX_OCCURRENCES; d++) {
      const day = new Date(weekCursor);
      day.setDate(day.getDate() + d);
      if (day < start) continue;
      if (day > end) break;
      if (!activeDays.has(day.getDay())) continue;
      const iso = fmt(day);
      if (!excluded.has(iso)) out.push(iso);
    }
    weekCursor.setDate(weekCursor.getDate() + 7 * rule.interval);
  }
  return out;
}
