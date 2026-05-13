import { api, tokenStore } from '@/lib/api';

export interface ExcelExportStatus {
  enabled: boolean;
  path: string;
  lookaheadDays: number;
  lastExportAt: string | null;
  lastExportError: string | null;
  lastExportRowCount: number;
  lastExportDurationMs: number;
  lastExportSizeBytes: number;
  fileExists: boolean;
  fileMtime: string | null;
}

export interface ExcelExportResult {
  ok: boolean;
  rowCount?: number;
  lookaheadDays?: number;
  durationMs?: number;
  sizeBytes?: number;
  path?: string;
  reason?: string;
}

export const excelExportApi = {
  status: () => api<ExcelExportStatus>('/api/admin/excel-export/status'),
  exportNow: () =>
    api<ExcelExportResult>('/api/admin/excel-export/export-now', { method: 'POST', body: {} }),
  /**
   * Scarica il file .xlsx con auth Bearer (un semplice <a href> non manderebbe
   * il token). Triggera il download del browser con il nome file dal backend.
   */
  download: async (): Promise<void> => {
    const token = tokenStore.get();
    const res = await fetch('/api/admin/excel-export/download', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
        error?: string;
      };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cadenza-prenotazioni.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
