import { api } from '@/lib/api';

export interface QrRoomEntry {
  id: number;
  name: string;
  code: string | null;
  building: { id: number; name: string } | null;
  /** null = eredita Building.checkInDefault. true/false = override esplicito. */
  requireCheckIn: boolean | null;
  /** Valore risolto dalla cascata Room → Building (sempre boolean). */
  effectiveCheckIn: boolean;
  /** true se requireCheckIn è null (l'aula sta ereditando dall'edificio). */
  inheritedFromBuilding: boolean;
  hasQrToken: boolean;
  qrTokenUpdatedAt: string | null;
}

export interface BuildingCheckInEntry {
  id: number;
  name: string;
  code: string | null;
  /** Impostazione generale: se true, tutte le aule senza override richiedono check-in. */
  checkInDefault: boolean;
  /** Numero totale di aule dell'edificio. */
  roomsTotal: number;
  /** Numero di aule che hanno un override esplicito (requireCheckIn !== null). */
  roomsWithOverride: number;
}

export interface CheckInSettings {
  checkInRequireInstituteNetwork: boolean;
  instituteNetworkCidrs: string[];
  callerIp: string | null;
}

export interface CheckInSettingsUpdate {
  checkInRequireInstituteNetwork: boolean;
  instituteNetworkCidrs: string[];
}

export const qrcodesApi = {
  overview: () => api<{ rooms: QrRoomEntry[] }>('/api/structure/rooms/qr-overview'),

  /** PNG URL ready to use in <img src=...>. Includes auth via cookies/JWT. */
  imageUrl: (roomId: number, cacheBuster?: string | null) => {
    const v = cacheBuster ? `?v=${encodeURIComponent(cacheBuster)}` : '';
    return `/api/structure/rooms/${roomId}/qr${v}`;
  },

  regenerate: (roomId: number) =>
    api<{ ok: boolean; roomId: number; qrTokenUpdatedAt: string; url: string }>(
      `/api/structure/rooms/${roomId}/qr/regenerate`,
      { method: 'POST' },
    ),

  bulkRegenerate: () =>
    api<{ ok: boolean; updated: number }>('/api/structure/rooms/qr/bulk-regenerate', {
      method: 'POST',
    }),

  getCheckInSettings: () => api<CheckInSettings>('/api/structure/checkin-settings'),

  saveCheckInSettings: (body: CheckInSettingsUpdate) =>
    api<CheckInSettings & { warnings: string[] }>('/api/structure/checkin-settings', {
      method: 'PUT',
      body,
    }),

  // Toggle check-in per edificio (impostazione generale)
  listBuildingCheckIn: () =>
    api<{ items: BuildingCheckInEntry[] }>('/api/structure/buildings/checkin-defaults'),
  setBuildingCheckIn: (id: number, enabled: boolean) =>
    api<{ building: BuildingCheckInEntry }>(`/api/structure/buildings/${id}/checkin-default`, {
      method: 'PATCH',
      body: { enabled },
    }),
};
