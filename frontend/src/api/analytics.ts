import { api, tokenStore } from '@/lib/api';

export interface AnalyticsHeatmapCell {
  count: number;
  hours: number;
}

export interface AnalyticsTopRoom {
  roomId: number;
  name: string;
  building: string;
  floor: string;
  hours: number;
  count: number;
}

export interface AnalyticsTopUser {
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  matricola: string | null;
  hours: number;
  count: number;
}

export interface AnalyticsTrendPoint {
  weekStart: string; // ISO timestamp
  count: number;
  hours: number;
}

export interface AnalyticsResponse {
  range: { from: string; to: string };
  summary: {
    confirmedBookings: number;
    ghostedBookings: number;
    totalCreated: number;
    noShowRatePct: number;
  };
  /** 7 righe (lun→dom) × 24 colonne (0..23). */
  heatmap: AnalyticsHeatmapCell[][];
  topRooms: AnalyticsTopRoom[];
  topUsers: AnalyticsTopUser[];
  trend: AnalyticsTrendPoint[];
}

export const analyticsApi = {
  get: (dateFrom?: string, dateTo?: string) =>
    api<AnalyticsResponse>('/api/admin/analytics', {
      query: { dateFrom, dateTo },
    }),

  /** Download CSV via fetch+Blob (Bearer richiesto, non passabile via <a href>). */
  async downloadCsv(dateFrom?: string, dateTo?: string): Promise<Blob> {
    const token = tokenStore.get();
    if (!token) throw new Error('Sessione scaduta');
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const res = await fetch(`/api/admin/analytics/export.csv?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Errore ${res.status}`);
    return res.blob();
  },

  async downloadPdf(dateFrom?: string, dateTo?: string): Promise<Blob> {
    const token = tokenStore.get();
    if (!token) throw new Error('Sessione scaduta');
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const res = await fetch(`/api/admin/analytics/export.pdf?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Errore ${res.status}`);
    return res.blob();
  },
};
