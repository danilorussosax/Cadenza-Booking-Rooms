import { describe, expect, it } from 'vitest';
import { projectMonteOreHours } from '@/lib/monteOreProjection';
import type { MonteOreSlot } from '@/api/monteOre';
const slots = [
  { id: 1, startTime: '09:00', endTime: '10:30', isActive: true, isLocked: false },
  { id: 2, startTime: '10:00', endTime: '11:30', isActive: false, isLocked: false },
] as MonteOreSlot[];
describe('compound Monte Ore projection', () => {
  it('cancellation and recovery preserve the total in one request', () => {
    expect(
      projectMonteOreHours(slots, [
        { kind: 'toggle_off', slotId: 1, payload: {} },
        { kind: 'toggle_on', slotId: 2, payload: {} },
      ]),
    ).toBe(1.5);
  });
  it('calculates additions and changed times with minute precision', () => {
    expect(
      projectMonteOreHours(slots, [
        { kind: 'change_time', slotId: 1, payload: { endTime: '10:00' } },
        { kind: 'add_new_day', payload: { startTime: '12:00', endTime: '12:30' } },
      ]),
    ).toBe(1.5);
  });
  it('does not show a misleading total for incomplete operations', () => {
    expect(projectMonteOreHours(slots, [{ kind: 'move_to', slotId: 1, payload: {} }])).toBeNull();
  });
});
