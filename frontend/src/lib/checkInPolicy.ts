import type { Building, Room } from '@/types';

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
