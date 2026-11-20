import { describe, expect, it } from 'vitest';
import type { MonteOreSlot } from '@/api/monteOre';
import {
  groupSlotsByDate,
  isHoursTargetMet,
  isValidTimeRange,
  pickMoveTargets,
  progressPercent,
} from '@/lib/monteOreGrid';

function slot(over: Partial<MonteOreSlot>): MonteOreSlot {
  return {
    id: 1,
    proposalId: 1,
    scheduleId: 1,
    date: '2026-01-05',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:00',
    isActive: false,
    isLocked: false,
    lockReason: null,
    originalActive: false,
    bookingId: null,
    roomId: null,
    bookingType: null,
    purpose: null,
    ...over,
  };
}

describe('monteOreGrid', () => {
  it('groupSlotsByDate raggruppa per data', () => {
    const m = groupSlotsByDate([
      slot({ id: 1 }),
      slot({ id: 2, date: '2026-01-06' }),
      slot({ id: 3 }),
    ]);
    expect(m.get('2026-01-05')?.map((s) => s.id)).toEqual([1, 3]);
    expect(m.get('2026-01-06')?.map((s) => s.id)).toEqual([2]);
    expect(groupSlotsByDate([]).size).toBe(0);
  });

  it('progressPercent satura a 100', () => {
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(150, 100)).toBe(100);
  });

  it('isHoursTargetMet rispetta la modalità', () => {
    expect(isHoursTargetMet('minimum', 10, 10)).toBe(true);
    expect(isHoursTargetMet('minimum', 9.9, 10)).toBe(false);
    expect(isHoursTargetMet('exact', 10, 10)).toBe(true);
    expect(isHoursTargetMet('exact', 11, 10)).toBe(false);
    expect(isHoursTargetMet('maximum', 0, 10)).toBe(false);
    expect(isHoursTargetMet('maximum', 10, 10)).toBe(true);
    expect(isHoursTargetMet('maximum', 10.5, 10)).toBe(false);
  });

  it('pickMoveTargets filtra e ordina', () => {
    const res = pickMoveTargets(
      [
        slot({ id: 1 }),
        slot({ id: 2, date: '2026-01-07' }),
        slot({ id: 3, date: '2026-01-06', startTime: '11:00' }),
        slot({ id: 4, date: '2026-01-06', startTime: '08:00' }),
        slot({ id: 5, isActive: true }),
        slot({ id: 6, isLocked: true }),
      ],
      1,
    );
    expect(res.map((s) => s.id)).toEqual([4, 3, 2]);
  });

  it('isValidTimeRange', () => {
    expect(isValidTimeRange('09:00', '10:00')).toBe(true);
    expect(isValidTimeRange('10:00', '09:00')).toBe(false);
    expect(isValidTimeRange('', '10:00')).toBe(false);
  });
});
