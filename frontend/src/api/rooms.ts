import { api } from '@/lib/api';
import type { Building, Equipment, EquipmentType, Room, RoomType } from '@/types';

export interface RoomSearchParams {
  /** Tipi di equipment richiesti tutti contemporaneamente nell'aula. */
  equipmentType?: EquipmentType[];
  /** Capacità minima posti. */
  minCapacity?: number;
  /** Filtra per id edificio. */
  building?: number;
  /** Filtra per tipo aula (studio, sala_prove, aula_concerti, ...). */
  type?: RoomType;
  /** Range di disponibilità: esclude aule occupate da Booking confermato. */
  from?: string; // ISO datetime
  to?: string; // ISO datetime
}

export interface RoomSearchResult {
  rooms: Room[];
  total: number;
  filters: {
    equipmentTypes: string[];
    minCapacity: number;
    buildingId: number | null;
    type: string | null;
    from: string | null;
    to: string | null;
  };
}

export const roomsApi = {
  list: (opts: { buildingId?: number; bookable?: boolean } = {}) =>
    api<{ rooms: Room[] }>('/api/structure/rooms', { query: opts }),

  get: (id: number) => api<{ room: Room }>(`/api/structure/rooms/${id}`),

  /**
   * Ricerca aule con filtri combinati. equipmentType è un array → l'helper
   * `api()` non gestisce array nativamente, quindi serializziamo CSV.
   * Backend supporta entrambi i formati (CSV e multi-param).
   */
  search: (params: RoomSearchParams = {}) => {
    const query: Record<string, unknown> = {};
    if (params.equipmentType?.length) query.equipmentType = params.equipmentType.join(',');
    if (params.minCapacity) query.minCapacity = params.minCapacity;
    if (params.building) query.building = params.building;
    if (params.type) query.type = params.type;
    if (params.from) query.from = params.from;
    if (params.to) query.to = params.to;
    return api<RoomSearchResult>('/api/structure/rooms/search', { query });
  },

  buildings: (instituteId?: number) =>
    api<{ buildings: Building[] }>('/api/structure/buildings', { query: { instituteId } }),

  equipment: (roomId?: number) =>
    api<{ equipment: Equipment[] }>('/api/structure/equipment', { query: { roomId } }),
};
