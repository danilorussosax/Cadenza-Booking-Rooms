/**
 * Replica TypeScript di backend/services/monteOreDailyValidator.js.
 *
 * Permette di mostrare warning inline al docente durante l'editing del
 * pattern settimanale, prima del submit. Il backend resta l'autorità: in
 * caso di drift, la verità è quello che il server accetta.
 *
 *  - Z2: max ore di lezione nello stesso giorno
 *  - Z3: pausa min dopo N ore consecutive (gap insufficiente NON spezza il blocco)
 */

export interface DailySchedule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface DailyConstraints {
  maxHoursPerDay: number | null;
  dailyBreakAfterHours: number | null;
  dailyBreakMinutes: number | null;
}

export type DailyViolation =
  | {
      code: 'DAILY_HOURS_EXCEEDED';
      dayOfWeek: number;
      totalHours: number;
      limit: number;
    }
  | {
      code: 'BREAK_REQUIRED';
      dayOfWeek: number;
      consecutiveHours: number;
      threshold: number;
      breakNeeded: number;
    };

export function validateDailyConstraints(
  schedules: DailySchedule[],
  settings: DailyConstraints,
): { ok: boolean; violations: DailyViolation[] } {
  const violations: DailyViolation[] = [];
  if (!Array.isArray(schedules) || schedules.length === 0 || !settings) {
    return { ok: true, violations };
  }
  const { maxHoursPerDay, dailyBreakAfterHours, dailyBreakMinutes } = settings;
  const z2Active = maxHoursPerDay != null;
  const z3Active = dailyBreakAfterHours != null && dailyBreakMinutes != null;
  if (!z2Active && !z3Active) return { ok: true, violations };

  const byDay = new Map<number, DailySchedule[]>();
  for (const s of schedules) {
    const arr = byDay.get(s.dayOfWeek) ?? [];
    arr.push(s);
    byDay.set(s.dayOfWeek, arr);
  }

  for (const [dayOfWeek, daySchedules] of byDay) {
    if (z2Active) {
      let total = 0;
      for (const s of daySchedules) total += hoursBetween(s.startTime, s.endTime);
      if (total > (maxHoursPerDay) + 1e-6) {
        violations.push({
          code: 'DAILY_HOURS_EXCEEDED',
          dayOfWeek,
          totalHours: round1(total),
          limit: maxHoursPerDay,
        });
      }
    }

    if (z3Active) {
      const sorted = [...daySchedules].sort(
        (a, b) => minutesOf(a.startTime) - minutesOf(b.startTime),
      );
      let blockStart = minutesOf(sorted[0].startTime);
      let blockEnd = minutesOf(sorted[0].endTime);
      for (let i = 1; i < sorted.length; i++) {
        const gap = minutesOf(sorted[i].startTime) - blockEnd;
        if (gap >= (dailyBreakMinutes)) {
          flushBlock(
            blockStart,
            blockEnd,
            dayOfWeek,
            dailyBreakAfterHours,
            dailyBreakMinutes,
            violations,
          );
          blockStart = minutesOf(sorted[i].startTime);
          blockEnd = minutesOf(sorted[i].endTime);
        } else {
          blockEnd = Math.max(blockEnd, minutesOf(sorted[i].endTime));
        }
      }
      flushBlock(
        blockStart,
        blockEnd,
        dayOfWeek,
        dailyBreakAfterHours,
        dailyBreakMinutes,
        violations,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

function flushBlock(
  startMin: number,
  endMin: number,
  dayOfWeek: number,
  threshold: number,
  breakNeeded: number,
  violations: DailyViolation[],
) {
  const hours = (endMin - startMin) / 60;
  if (hours > threshold + 1e-6) {
    violations.push({
      code: 'BREAK_REQUIRED',
      dayOfWeek,
      consecutiveHours: round1(hours),
      threshold,
      breakNeeded,
    });
  }
}

function minutesOf(hhmm: string): number {
  if (typeof hhmm !== 'string') return 0;
  const [h, m] = hhmm.split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function hoursBetween(start: string, end: string): number {
  return Math.max(0, (minutesOf(end) - minutesOf(start)) / 60);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const DAY_LABELS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

/** Messaggio Italian human-readable di una singola violazione. */
export function describeDailyViolation(v: DailyViolation): string {
  const day = DAY_LABELS[v.dayOfWeek] ?? `Giorno ${v.dayOfWeek}`;
  if (v.code === 'DAILY_HOURS_EXCEEDED') {
    return `${day}: ${v.totalHours}h totali (massimo: ${v.limit}h)`;
  }
  return `${day}: ${v.consecutiveHours}h consecutive senza pausa di almeno ${v.breakNeeded} min`;
}
