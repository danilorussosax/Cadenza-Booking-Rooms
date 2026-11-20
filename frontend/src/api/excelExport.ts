import { api, apiBlob } from '@/lib/api';
import { saveBlob } from '@/lib/download';

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
    saveBlob(await apiBlob('/api/admin/excel-export/download'), 'cadenza-prenotazioni.xlsx');
  },
};
