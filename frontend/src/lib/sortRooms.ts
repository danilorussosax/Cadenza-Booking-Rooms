import type { Building, Room } from '@/types';

// Collator riusabile: numeric=true rende "10" > "9" (default lessicografico
// vorrebbe "10" < "9"). Sensitivity 'base' ignora maiuscole/accenti.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Ordina le aule di un singolo edificio:
 *   1. piano seguendo l'ordine in `building.floors` (così "Piano Terra"
 *      precede "Primo Piano" anche se alfabeticamente perderebbe in alcuni
 *      casi extra-italiani)
 *   2. nome aula con confronto numerico-aware ("9" prima di "10")
 *
 * I piani non listati nell'array dell'edificio (incoerenza dati) finiscono
 * in fondo.
 */
export function sortRoomsForBuilding<T extends Pick<Room, 'name' | 'floor'>>(
  rooms: readonly T[],
  building: Pick<Building, 'floors'> | null | undefined,
): T[] {
  const floors = building?.floors ?? [];
  return [...rooms].sort((a, b) => {
    const ai = floors.indexOf(a.floor);
    const bi = floors.indexOf(b.floor);
    const aIdx = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bIdx = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (aIdx !== bIdx) return aIdx - bIdx;
    // Tie-breaker: se entrambi non sono nei floors usiamo confronto naturale
    if (aIdx === Number.MAX_SAFE_INTEGER) {
      const f = collator.compare(a.floor, b.floor);
      if (f !== 0) return f;
    }
    return collator.compare(a.name, b.name);
  });
}

/**
 * Raggruppa le aule di un edificio per piano, restituendo le sezioni
 * nell'ordine logico definito da `building.floors`. Ogni sezione ha le
 * aule già ordinate per nome (numeric-aware), grazie al pre-sort.
 *
 * Output: array di `{ floor, rooms }` dove `floor` è la stringa del piano
 * così come compare in `Building.floors` (es. "Piano Terra", "1º Piano").
 * Eventuali piani non presenti in `Building.floors` (incoerenza dati) vanno
 * in fondo nell'ordine alfabetico naturale.
 */
export function groupRoomsByFloor<T extends Pick<Room, 'name' | 'floor'>>(
  rooms: readonly T[],
  building: Pick<Building, 'floors'> | null | undefined,
): { floor: string; rooms: T[] }[] {
  // Riusa l'ordinamento esistente (piano → nome numeric-aware)
  const sorted = sortRoomsForBuilding(rooms, building);
  // Costruisci sezioni preservando l'ordine d'apparizione (già canonico
  // grazie al sort): la prima volta che incontriamo un nuovo `floor`,
  // creiamo una sezione e ci accodiamo le aule successive.
  const sections: { floor: string; rooms: T[] }[] = [];
  let current: { floor: string; rooms: T[] } | null = null;
  for (const r of sorted) {
    // L'optional-chain qui (`current?.floor !== …`) farebbe perdere il type
    // narrowing nel push() sotto, quindi manteniamo la forma esplicita.
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    if (!current || current.floor !== r.floor) {
      current = { floor: r.floor, rooms: [] };
      sections.push(current);
    }
    current.rooms.push(r);
  }
  return sections;
}

/**
 * Ordina una lista FLAT di aule (cross-edificio): edificio → piano → nome.
 * Richiede `room.building` valorizzato (incluso nelle response API standard).
 *
 * Ideale per dropdown/select che mostrano aule di più edifici insieme.
 */
export function sortRoomsCrossBuilding<
  T extends Pick<Room, 'name' | 'floor'> & { building?: Pick<Building, 'name' | 'floors'> | null },
>(rooms: readonly T[]): T[] {
  return [...rooms].sort((a, b) => {
    const buildingCmp = collator.compare(a.building?.name ?? '', b.building?.name ?? '');
    if (buildingCmp !== 0) return buildingCmp;
    // Stesso edificio: usa l'array floors per l'ordine logico
    const floors = a.building?.floors ?? [];
    const ai = floors.indexOf(a.floor);
    const bi = floors.indexOf(b.floor);
    const aIdx = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bIdx = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (aIdx !== bIdx) return aIdx - bIdx;
    if (aIdx === Number.MAX_SAFE_INTEGER) {
      const f = collator.compare(a.floor, b.floor);
      if (f !== 0) return f;
    }
    return collator.compare(a.name, b.name);
  });
}
