import type { MonteOreAmendment } from './types';

/**
 * Etichetta sintetica "data + orario" di un amendment, leggendo lo slot
 * collegato o, per gli `add_new_day` ancora pending (slot non ancora creato),
 * il payload della richiesta.
 */
export function amendmentSummary(a: MonteOreAmendment): string {
  const base = a.slot ? `${a.slot.date} ${a.slot.startTime}–${a.slot.endTime}` : '';
  if (a.kind === 'change_time') {
    const p = a.payload as { startTime?: string; endTime?: string };
    if (p.startTime || p.endTime) {
      return `${base} → ${p.startTime ?? a.slot?.startTime}–${p.endTime ?? a.slot?.endTime}`;
    }
  }
  if (a.kind === 'change_room') {
    const p = a.payload as { roomId?: number };
    return `${base} → aula #${p.roomId ?? '?'}`;
  }
  if (a.kind === 'move_to') {
    const p = a.payload as { sourceDate?: string; targetDate?: string };
    if (p.sourceDate && p.targetDate) return `${p.sourceDate} → ${p.targetDate}`;
  }
  if (a.kind === 'add_new_day') {
    const p = a.payload as { date?: string; startTime?: string; endTime?: string };
    if (p.date && p.startTime && p.endTime) return `${p.date} ${p.startTime}–${p.endTime}`;
  }
  return base || '—';
}
