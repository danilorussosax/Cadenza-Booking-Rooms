import { describe, expect, it } from 'vitest';
import {
  buildBuildingsWithDayBookings,
  greetingKeyForHour,
  groupRoomsByBuilding,
  monteOreMeetsThreshold,
  selectCheckinNeeded,
} from '@/lib/dashboardData';
import type { Booking, Room } from '@/types';

const room = (over: Record<string, unknown>) => over as unknown as Room;
const booking = (over: Record<string, unknown>) => over as unknown as Booking;

describe('lib/dashboardData', () => {
  it('greetingKeyForHour: fasce orarie', () => {
    expect(greetingKeyForHour(3)).toBe('dashboard.greeting_night');
    expect(greetingKeyForHour(6)).toBe('dashboard.greeting_morning');
    expect(greetingKeyForHour(12)).toBe('dashboard.greeting_afternoon');
    expect(greetingKeyForHour(18)).toBe('dashboard.greeting_evening');
  });

  it('groupRoomsByBuilding: raggruppa, scarta aule senza edificio e ordina i nomi', () => {
    const b1 = { id: 1, name: 'Sede A', floors: ['PT'] };
    const b2 = { id: 2, name: 'Sede B', floors: ['PT'] };
    const map = groupRoomsByBuilding([
      room({ id: 1, name: 'Aula 10', floor: 'PT', building: b1 }),
      room({ id: 2, name: 'Aula 2', floor: 'PT', building: b1 }),
      room({ id: 3, name: 'Aula 1', floor: 'PT', building: b2 }),
      room({ id: 4, name: 'Orfana', floor: 'PT', building: null }),
    ]);
    expect([...map.keys()]).toEqual([1, 2]);
    expect(map.get(1)?.rooms.map((r) => r.name)).toEqual(['Aula 2', 'Aula 10']);
    expect(map.get(2)?.name).toBe('Sede B');
  });

  it('buildBuildingsWithDayBookings: solo aule prenotabili, prenotazioni del giorno ordinate', () => {
    const rooms = [
      room({ id: 1, name: 'A', isBookable: true }),
      room({ id: 2, name: 'B', isBookable: false }),
    ];
    const result = buildBuildingsWithDayBookings(
      [{ id: 1, name: 'Sede', rooms }],
      [
        booking({
          id: 2,
          roomId: 1,
          startTime: '2026-11-16T11:00:00',
          endTime: '2026-11-16T12:00:00',
        }),
        booking({
          id: 1,
          roomId: 1,
          startTime: '2026-11-16T09:00:00',
          endTime: '2026-11-16T10:00:00',
        }),
        booking({
          id: 3,
          roomId: 1,
          startTime: '2026-11-17T09:00:00',
          endTime: '2026-11-17T10:00:00',
        }),
      ],
      '2026-11-16',
    );
    expect(result).toHaveLength(1);
    expect(result[0].rooms.map((r) => r.room.id)).toEqual([1]);
    expect(result[0].rooms[0].bookings.map((b) => b.id)).toEqual([1, 2]);
    expect(result[0].totalBookings).toBe(2);
  });

  describe('selectCheckinNeeded', () => {
    const now = new Date('2026-11-16T10:00:00Z').getTime();
    const base = {
      status: 'confirmed',
      checkedInAt: null,
      room: { requireCheckIn: true },
    };
    const at = (min: number) => new Date(now + min * 60_000).toISOString();

    it('include le prenotazioni imminenti senza check-in', () => {
      const r = selectCheckinNeeded(
        [booking({ ...base, id: 1, startTime: at(10) })],
        undefined,
        now,
      );
      expect(r.map((b) => b.id)).toEqual([1]);
    });

    it('esclude: troppo lontane, finestra chiusa, gia fatte, check-in non richiesto, non confermate', () => {
      const r = selectCheckinNeeded(
        [
          booking({ ...base, id: 1, startTime: at(31) }),
          booking({ ...base, id: 2, startTime: at(-16) }),
          booking({ ...base, id: 3, startTime: at(5), checkedInAt: at(0) }),
          booking({ ...base, id: 4, startTime: at(5), room: { requireCheckIn: false } }),
          booking({ ...base, id: 5, startTime: at(5), status: 'pending_approval' }),
          booking({ ...base, id: 6, startTime: at(5), room: undefined }),
        ],
        undefined,
        now,
      );
      expect(r).toEqual([]);
    });

    it('usa le soglie dall API: grace piu lunga mantiene aperta la finestra', () => {
      const b = booking({ ...base, id: 1, startTime: at(-16) });
      expect(selectCheckinNeeded([b], undefined, now)).toEqual([]);
      expect(selectCheckinNeeded([b], { earlyMinutes: 5, graceMinutes: 30 }, now)).toHaveLength(1);
    });
  });

  it('monteOreMeetsThreshold: modalita minimum / exact / maximum', () => {
    expect(monteOreMeetsThreshold(undefined, 10, 10)).toBe(true);
    expect(monteOreMeetsThreshold('minimum', 9, 10)).toBe(false);
    expect(monteOreMeetsThreshold('exact', 10.0, 10)).toBe(true);
    expect(monteOreMeetsThreshold('exact', 10.5, 10)).toBe(false);
    expect(monteOreMeetsThreshold('maximum', 0, 10)).toBe(false);
    expect(monteOreMeetsThreshold('maximum', 8, 10)).toBe(true);
    expect(monteOreMeetsThreshold('maximum', 11, 10)).toBe(false);
  });
});
