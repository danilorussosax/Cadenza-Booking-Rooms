import { api } from '@/lib/api';

export interface SheetsMirrorStatus {
  enabled: boolean;
  spreadsheetId: string | null;
  lookaheadDays: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastSyncRowCount: number;
  lastSyncDurationMs: number;
}

export interface SheetsProbeResult {
  ok: boolean;
  title?: string;
  tabs?: string[];
  spreadsheetId?: string;
  error?: string;
}

export interface SheetsSyncResult {
  ok: boolean;
  rowCount?: number;
  durationMs?: number;
  reason?: string;
}

export const googleSheetsApi = {
  status: () => api<SheetsMirrorStatus>('/api/admin/google-sheets/status'),
  probe: () =>
    api<SheetsProbeResult>('/api/admin/google-sheets/probe', { method: 'POST', body: {} }),
  sync: () => api<SheetsSyncResult>('/api/admin/google-sheets/sync', { method: 'POST', body: {} }),
};
