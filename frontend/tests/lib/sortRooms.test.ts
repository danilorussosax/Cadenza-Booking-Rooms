import { describe, it, expect } from 'vitest';
import { groupRoomsByFloor, sortRoomsCrossBuilding, sortRoomsForBuilding } from '@/lib/sortRooms';

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

  it('groupRoomsByFloor: raggruppa per piano nell’ordine di building.floors', () => {
    const rooms = [
      { name: 'Aula 10', floor: 'Primo' },
      { name: 'Aula 1', floor: 'Terra' },
      { name: 'Aula 2', floor: 'Primo' },
      { name: 'Aula 9', floor: 'Terra' },
    ];
    const grouped = groupRoomsByFloor(rooms, { floors: ['Terra', 'Primo'] });
    expect(grouped).toHaveLength(2);
    // Sezione Terra prima di Primo
    expect(grouped[0].floor).toBe('Terra');
    expect(grouped[0].rooms.map((r) => r.name)).toEqual(['Aula 1', 'Aula 9']);
    // Sezione Primo poi, con sort numeric-aware (2 prima di 10)
    expect(grouped[1].floor).toBe('Primo');
    expect(grouped[1].rooms.map((r) => r.name)).toEqual(['Aula 2', 'Aula 10']);
  });

  it('groupRoomsByFloor: piani assenti da building.floors finiscono in fondo', () => {
    const rooms = [
      { name: 'X1', floor: 'Sotterraneo' }, // non in floors
      { name: 'A1', floor: 'Terra' },
      { name: 'A2', floor: 'Terra' },
    ];
    const grouped = groupRoomsByFloor(rooms, { floors: ['Terra'] });
    expect(grouped).toHaveLength(2);
    expect(grouped[0].floor).toBe('Terra');
    expect(grouped[1].floor).toBe('Sotterraneo');
  });

  it('groupRoomsByFloor: input vuoto', () => {
    expect(groupRoomsByFloor([], { floors: ['Terra'] })).toEqual([]);
  });

  it('groupRoomsByFloor: edificio senza floors → un’unica sezione per piano in ordine alfabetico', () => {
    const rooms = [
      { name: 'B', floor: 'Primo' },
      { name: 'A', floor: 'Terra' },
    ];
    const grouped = groupRoomsByFloor(rooms, null);
    // Senza floors di riferimento, fall-back a confronto naturale dei nomi piano
    expect(grouped.map((g) => g.floor)).toEqual(['Primo', 'Terra']);
  });
});
