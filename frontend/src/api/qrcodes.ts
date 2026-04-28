import { api } from '@/lib/api';

export interface QrRoomEntry {
  id: number;
  name: string;
  code: string | null;
  building: { id: number; name: string } | null;
  requireCheckIn: boolean;
  hasQrToken: boolean;
  qrTokenUpdatedAt: string | null;
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
};
