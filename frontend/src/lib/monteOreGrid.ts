import type { MonteOreSlot } from '@/api/monteOre';

export type HoursMode = 'minimum' | 'exact' | 'maximum';

/** Raggruppa gli slot per data (`YYYY-MM-DD`), mantenendo l'ordine di arrivo. */
export function groupSlotsByDate(slots: readonly MonteOreSlot[]): Map<string, MonteOreSlot[]> {
  const map = new Map<string, MonteOreSlot[]>();
  for (const s of slots) {
    const arr = map.get(s.date) ?? [];
    arr.push(s);
    map.set(s.date, arr);
  }
  return map;
}

/** Percentuale (0-100) di avanzamento verso la soglia ore. */
export function progressPercent(active: number, required: number): number {
  return Math.min(100, (active / required) * 100);
}

/** True se il totale ore attive soddisfa l'obiettivo secondo la modalità. */
export function isHoursTargetMet(mode: HoursMode, active: number, required: number): boolean {
  if (mode === 'maximum') return active > 0 && active <= required;
  if (mode === 'exact') return Math.round(active * 60) === Math.round(required * 60);
  return active >= required;
}

/** Celle libere (inattive, non bloccate) su cui spostare `slotId`, ordinate per data/ora. */
export function pickMoveTargets(allSlots: readonly MonteOreSlot[], slotId: number): MonteOreSlot[] {
  return allSlots
    .filter((s) => s.id !== slotId && !s.isLocked && !s.isActive)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

/** Intervallo orario `HH:MM` valido (formato corretto e inizio < fine). */
export function isValidTimeRange(start: string, end: string): boolean {
  return /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end;
}
