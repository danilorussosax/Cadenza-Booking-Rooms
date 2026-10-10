import type { AmendmentOperation, MonteOreSlot } from '@/api/monteOre';

/** Estimate a compound request in minutes; the API remains authoritative. */
export function projectMonteOreHours(
  slots: MonteOreSlot[],
  operations: AmendmentOperation[],
): number | null {
  type ProjectionSlot = Pick<MonteOreSlot, 'startTime' | 'endTime' | 'isActive' | 'isLocked'>;
  const rows = new Map<number, ProjectionSlot>(slots.map((slot) => [slot.id, { ...slot }]));
  for (const [index, op] of operations.entries()) {
    if (op.kind === 'add_new_day') {
      if (!op.payload.startTime || !op.payload.endTime) return null;
      rows.set(-(index + 1), {
        startTime: op.payload.startTime,
        endTime: op.payload.endTime,
        isActive: true,
        isLocked: false,
      });
      continue;
    }
    const row = rows.get(op.slotId ?? 0);
    if (!row) return null;
    if (op.kind === 'toggle_off') row.isActive = false;
    if (op.kind === 'toggle_on') row.isActive = true;
    if (op.kind === 'change_time') {
      row.startTime = op.payload.startTime ?? row.startTime;
      row.endTime = op.payload.endTime ?? row.endTime;
    }
    if (op.kind === 'move_to') {
      const target = rows.get(op.payload.targetSlotId ?? 0);
      if (!target) return null;
      row.isActive = false;
      target.isActive = true;
    }
  }
  let minutes = 0;
  for (const row of rows.values()) {
    if (!row.isActive || row.isLocked) continue;
    const parse = (time: string) => {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    };
    const duration = parse(row.endTime) - parse(row.startTime);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    minutes += duration;
  }
  return minutes / 60;
}
