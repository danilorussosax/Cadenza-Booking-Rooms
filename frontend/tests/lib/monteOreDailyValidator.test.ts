import { describe, it, expect } from 'vitest';
import { validateDailyConstraints, describeDailyViolation } from '@/lib/monteOreDailyValidator';

describe('validateDailyConstraints (client replica)', () => {
  it('schedules vuoti → ok', () => {
    expect(
      validateDailyConstraints([], {
        maxHoursPerDay: 9,
        dailyBreakAfterHours: null,
        dailyBreakMinutes: null,
      }),
    ).toEqual({ ok: true, violations: [] });
  });

  it('settings tutti null → ok anche con pattern violento', () => {
    const out = validateDailyConstraints([{ dayOfWeek: 1, startTime: '08:00', endTime: '20:00' }], {
      maxHoursPerDay: null,
      dailyBreakAfterHours: null,
      dailyBreakMinutes: null,
    });
    expect(out.ok).toBe(true);
  });

  it('DAILY_HOURS_EXCEEDED su lun 10h con maxHoursPerDay=9', () => {
    const out = validateDailyConstraints(
      [
        { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' },
        { dayOfWeek: 1, startTime: '14:00', endTime: '20:00' },
      ],
      { maxHoursPerDay: 9, dailyBreakAfterHours: null, dailyBreakMinutes: null },
    );
    expect(out.ok).toBe(false);
    expect(out.violations[0]).toMatchObject({
      code: 'DAILY_HOURS_EXCEEDED',
      dayOfWeek: 1,
      totalHours: 10,
      limit: 9,
    });
  });

  it('BREAK_REQUIRED con gap insufficiente', () => {
    const out = validateDailyConstraints(
      [
        { dayOfWeek: 2, startTime: '09:00', endTime: '13:00' },
        { dayOfWeek: 2, startTime: '13:15', endTime: '17:15' },
      ],
      { maxHoursPerDay: null, dailyBreakAfterHours: 7, dailyBreakMinutes: 30 },
    );
    expect(out.ok).toBe(false);
    expect(out.violations[0].code).toBe('BREAK_REQUIRED');
  });

  it('OK con gap esattamente uguale a dailyBreakMinutes', () => {
    const out = validateDailyConstraints(
      [
        { dayOfWeek: 3, startTime: '09:00', endTime: '13:00' },
        { dayOfWeek: 3, startTime: '13:30', endTime: '17:30' },
      ],
      { maxHoursPerDay: null, dailyBreakAfterHours: 7, dailyBreakMinutes: 30 },
    );
    expect(out.ok).toBe(true);
  });

  it('describeDailyViolation italiano leggibile', () => {
    const msg = describeDailyViolation({
      code: 'DAILY_HOURS_EXCEEDED',
      dayOfWeek: 1,
      totalHours: 10,
      limit: 9,
    });
    expect(msg).toMatch(/Lunedì.*10h.*9h/);
  });
});
