import type { Building, Room } from '@/types';

/** Soglie di check-in, come esposte dall'API (`checkInConfig` / `config`). */
export interface CheckInConfig {
  earlyMinutes: number;
  graceMinutes: number;
}

/** Default allineati a backend/lib/config.js (usati solo finche' l'API non risponde). */
export const DEFAULT_CHECKIN_CONFIG: CheckInConfig = { earlyMinutes: 5, graceMinutes: 15 };

/** Anticipo (min) con cui la Dashboard segnala un check-in imminente. */
export const CHECKIN_HEADSUP_MINUTES = 30;

const MIN_MS = 60_000;

/** Mirror di backend/lib/checkInPolicy.js `windowFor`. */
export function windowFor(
  booking: { startTime: string | Date },
  config: CheckInConfig = DEFAULT_CHECKIN_CONFIG,
): { opensAt: Date; closesAt: Date } {
  const start = new Date(booking.startTime).getTime();
  return {
    opensAt: new Date(start - config.earlyMinutes * MIN_MS),
    closesAt: new Date(start + config.graceMinutes * MIN_MS),
  };
}

/** Mirror di backend/lib/checkInPolicy.js `phaseFor`. */
export function phaseFor(
  booking: { startTime: string | Date },
  config: CheckInConfig = DEFAULT_CHECKIN_CONFIG,
  now: Date | number = Date.now(),
): 'too_early' | 'open' | 'too_late' {
  const t = typeof now === 'number' ? now : now.getTime();
  const { opensAt, closesAt } = windowFor(booking, config);
  if (t < opensAt.getTime()) return 'too_early';
  if (t > closesAt.getTime()) return 'too_late';
  return 'open';
}

/**
 * Risolve se un'aula richiede effettivamente il check-in QR.
 *
 * Cascata (mirror dell'helper backend lib/checkInPolicy.js):
 *   1. room.requireCheckIn esplicito (true/false) → vince
 *   2. fallback: building.checkInDefault
 *   3. fallback ultimo: false (safer default)
 *
 * Accetta un room "lite" (anche solo i campi necessari) per ridurre la
 * coupling con il tipo completo Room.
 */
export function isCheckInRequired(
  room: Pick<Room, 'requireCheckIn'> & { building?: Pick<Building, 'checkInDefault'> | null },
  building: Pick<Building, 'checkInDefault'> | null = null,
): boolean {
  if (room.requireCheckIn === true) return true;
  if (room.requireCheckIn === false) return false;
  // null/undefined → eredita
  const b = building ?? room.building ?? null;
  return !!b?.checkInDefault;
}
