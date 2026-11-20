import { useMemo, useState } from 'react';
import type { FullInstitute } from '@/api/institutes';
import { toggleSetItem, toggleSetItems } from '@/lib/setToggle';

/** Stato di selezione multipla (aule/edifici) per le azioni bulk della pagina Struttura. */
export function useStructureSelection(institutes: FullInstitute[] | undefined) {
  const [selectedRooms, setSelectedRooms] = useState<Set<number>>(new Set());
  const [selectedBuildings, setSelectedBuildings] = useState<Set<number>>(new Set());

  const toggleBuildingSelected = (id: number) => {
    setSelectedBuildings((prev) => toggleSetItem(prev, id));
  };
  const clearBuildingSelection = () => {
    setSelectedBuildings(new Set());
  };

  // Riepilogo per il dialog di conferma: aule contenute negli edifici selezionati.
  // Le prenotazioni non sono caricate in questa view, quindi non possiamo
  // anticiparne il count: l'API risponde con il totale rimosso.
  const buildingsSelectionSummary = useMemo(() => {
    let rooms = 0;
    for (const inst of institutes ?? []) {
      for (const b of inst.buildings) {
        if (selectedBuildings.has(b.id)) rooms += b.rooms.length;
      }
    }
    return { rooms };
  }, [institutes, selectedBuildings]);

  const toggleRoomSelected = (id: number) => {
    setSelectedRooms((prev) => toggleSetItem(prev, id));
  };

  const toggleSelectAllRoomsInBuilding = (roomIds: number[]) => {
    setSelectedRooms((prev) => toggleSetItems(prev, roomIds));
  };

  const clearSelection = () => {
    setSelectedRooms(new Set());
  };

  return {
    selectedRooms,
    toggleRoomSelected,
    toggleSelectAllRoomsInBuilding,
    clearSelection,
    selectedBuildings,
    toggleBuildingSelected,
    clearBuildingSelection,
    buildingsSelectionSummary,
  };
}
