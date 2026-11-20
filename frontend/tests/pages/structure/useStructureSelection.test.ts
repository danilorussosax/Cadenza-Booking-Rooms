import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStructureSelection } from '@/pages/admin/structure/useStructureSelection';
import type { FullInstitute } from '@/api/institutes';

const institutes = [
  {
    id: 1,
    buildings: [
      { id: 10, rooms: [{ id: 100 }, { id: 101 }] },
      { id: 11, rooms: [{ id: 102 }] },
    ],
  },
] as unknown as FullInstitute[];

describe('useStructureSelection', () => {
  it('seleziona aule e le deseleziona in blocco', () => {
    const { result } = renderHook(() => useStructureSelection(institutes));
    act(() => {
      result.current.toggleRoomSelected(100);
    });
    expect([...result.current.selectedRooms]).toEqual([100]);
    act(() => {
      result.current.toggleSelectAllRoomsInBuilding([100, 101]);
    });
    expect([...result.current.selectedRooms].sort()).toEqual([100, 101]);
    act(() => {
      result.current.toggleSelectAllRoomsInBuilding([100, 101]);
    });
    expect(result.current.selectedRooms.size).toBe(0);
  });

  it('riepilogo aule per edifici selezionati e clear', () => {
    const { result } = renderHook(() => useStructureSelection(institutes));
    act(() => {
      result.current.toggleBuildingSelected(10);
      result.current.toggleBuildingSelected(11);
    });
    expect(result.current.buildingsSelectionSummary).toEqual({ rooms: 3 });
    act(() => {
      result.current.clearBuildingSelection();
    });
    expect(result.current.buildingsSelectionSummary).toEqual({ rooms: 0 });
  });

  it('senza dati il riepilogo è 0', () => {
    const { result } = renderHook(() => useStructureSelection(undefined));
    expect(result.current.buildingsSelectionSummary.rooms).toBe(0);
  });
});
