import { dayjs } from '@/lib/date';
import {
  CHECKIN_HEADSUP_MINUTES,
  DEFAULT_CHECKIN_CONFIG,
  isCheckInRequired,
  windowFor,
  type CheckInConfig,
} from '@/lib/checkInPolicy';
import { sortRoomsForBuilding } from '@/lib/sortRooms';
import type { Booking, Room } from '@/types';

export interface BuildingGroup {
  id: number;
  name: string;
  rooms: Room[];
}

export interface RoomDayBookings {
  room: Room;
  bookings: Booking[];
}

export interface BuildingDayBookings {
  building: BuildingGroup;
  rooms: RoomDayBookings[];
  totalBookings: number;
}

/** Chiave i18n del saluto in base all'ora (0-23). */
export function greetingKeyForHour(hour: number): string {
  if (hour < 6) return 'dashboard.greeting_night';
  if (hour < 12) return 'dashboard.greeting_morning';
  if (hour < 18) return 'dashboard.greeting_afternoon';
  return 'dashboard.greeting_evening';
}

/**
 * Raggruppa le aule per edificio (le aule senza edificio sono scartate).
 * Le aule di ogni edificio sono ordinate per piano → nome (numeric-aware).
 */
export function groupRoomsByBuilding(rooms: Room[]): Map<number, BuildingGroup> {
  const map = new Map<number, BuildingGroup>();
  for (const r of rooms) {
    const b = r.building;
    if (!b) continue;
    let group = map.get(b.id);
    if (!group) {
      group = { id: b.id, name: b.name, rooms: [] };
      map.set(b.id, group);
    }
    group.rooms.push(r);
  }
  for (const b of map.values()) {
    const floorsRef = b.rooms[0]?.building ?? null;
    b.rooms = sortRoomsForBuilding(b.rooms, floorsRef);
  }
  return map;
}

/**
 * Per ogni edificio, le aule prenotabili con le prenotazioni (ordinate per
 * inizio) che intersecano il giorno `dayStart` (YYYY-MM-DD).
 */
export function buildBuildingsWithDayBookings(
  buildings: BuildingGroup[],
  allBookings: Booking[],
  dayStart: string,
): BuildingDayBookings[] {
  const dayBegin = dayjs(dayStart).startOf('day');
  const dayEnd = dayBegin.add(1, 'day');
  const dayBookings = allBookings.filter(
    (b) => dayjs(b.startTime).isBefore(dayEnd) && dayjs(b.endTime).isAfter(dayBegin),
  );
  return buildings.map((building) => {
    const bookableRooms = building.rooms.filter((r) => r.isBookable);
    const roomsWithBookings = bookableRooms.map((room) => ({
      room,
      bookings: dayBookings
        .filter((b) => b.roomId === room.id)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    }));
    const totalBookings = roomsWithBookings.reduce((sum, r) => sum + r.bookings.length, 0);
    return { building, rooms: roomsWithBookings, totalBookings };
  });
}

/**
 * Booking imminenti che richiedono check-in: confermate, senza checkedInAt,
 * con finestra di check-in non ancora chiusa (soglie dall'API, vedi
 * lib/checkInPolicy) e inizio entro CHECKIN_HEADSUP_MINUTES.
 */
export function selectCheckinNeeded(
  bookings: Booking[],
  config: CheckInConfig | undefined,
  nowMs: number,
): Booking[] {
  const cfg = config ?? DEFAULT_CHECKIN_CONFIG;
  const latest = nowMs + CHECKIN_HEADSUP_MINUTES * 60_000;
  return bookings.filter(
    (b) =>
      b.status === 'confirmed' &&
      !!b.room &&
      isCheckInRequired(b.room) &&
      !b.checkedInAt &&
      windowFor(b, cfg).closesAt.getTime() > nowMs &&
      new Date(b.startTime).getTime() < latest,
  );
}

/** Il piano Monte Ore e' conforme alla soglia in base alla modalita'. */
export function monteOreMeetsThreshold(
  mode: string | undefined,
  planned: number,
  minHours: number,
): boolean {
  if (mode === 'maximum') return planned > 0 && planned <= minHours;
  if (mode === 'exact') return Math.round(planned * 60) === Math.round(minHours * 60);
  return planned >= minHours;
}
