import { describe, it, expect } from 'vitest';
import { sortRoomsForBuilding, sortRoomsCrossBuilding } from '@/lib/sortRooms';

describe('lib/sortRooms', () => {
  it('sortRoomsForBuilding: ordine numerico naturale', () => {
    const rooms = [
      { name: 'Aula 10', floor: 'Piano terra' },
      { name: 'Aula 2', floor: 'Piano terra' },
      { name: 'Aula 9', floor: 'Piano terra' },
    ];
    const sorted = sortRoomsForBuilding(rooms, null);
    expect(sorted.map((r) => r.name)).toEqual(['Aula 2', 'Aula 9', 'Aula 10']);
  });

  it('sortRoomsForBuilding: rispetta ordine piani da building.floors', () => {
    const rooms = [
      { name: 'A', floor: 'Primo' },
      { name: 'B', floor: 'Terra' },
      { name: 'C', floor: 'Primo' },
    ];
    const sorted = sortRoomsForBuilding(rooms, { floors: ['Terra', 'Primo'] });
    expect(sorted.map((r) => r.floor)).toEqual(['Terra', 'Primo', 'Primo']);
  });

  it('sortRoomsCrossBuilding: ordina prima per building, poi per piano/nome', () => {
    const rooms = [
      { name: 'A', floor: 'PT', building: { id: 2, name: 'Sede B', floors: ['PT'] } },
      { name: 'A', floor: 'PT', building: { id: 1, name: 'Sede A', floors: ['PT'] } },
    ];
    const sorted = sortRoomsCrossBuilding(rooms);
    expect(sorted[0].building?.name).toBe('Sede A');
  });

  it('sortRoomsForBuilding: input vuoto', () => {
    expect(sortRoomsForBuilding([], null)).toEqual([]);
  });
});
