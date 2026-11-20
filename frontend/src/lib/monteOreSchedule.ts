import type { MonteOreSchedule, SchedulePayload } from '@/api/monteOre';

/** Valori iniziali del form "fascia" a partire da una riga esistente (o dai default). */
export function scheduleToForm(existing: MonteOreSchedule | null): SchedulePayload {
  return {
    roomId: existing?.roomId ?? null,
    dayOfWeek: existing?.dayOfWeek ?? 1,
    startTime: existing?.startTime ?? '14:00',
    endTime: existing?.endTime ?? '16:00',
    bookingType: existing?.bookingType ?? 'lezione',
    purpose: existing?.purpose ?? '',
    notes: existing?.notes ?? '',
  };
}
