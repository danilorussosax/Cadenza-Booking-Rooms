import { api, tokenStore } from '@/lib/api';

export interface BackupItem {
  file: string;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
}

export interface SchedulerConfig {
  backupDir: string;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  autoRestartEnabled: boolean;
  source: 'db' | 'env';
}

export interface UpdateSchedulerSettingsPayload {
  autoEnabled?: boolean;
  scheduledHour?: number;
  scheduledMinute?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  autoRestartEnabled?: boolean;
}

export interface SchedulerStatus {
  enabled: boolean;
  autoEnabledEnv: boolean;
  nextRunAt: string | null;
  scheduledHour: number;
  scheduledMinute: number;
  inProgress: boolean;
  lastRun: {
    status: 'ok' | 'error';
    file?: string;
    sizeBytes?: number;
    deleted?: string[];
    durationMs: number;
    finishedAt: string;
    error?: string;
  } | null;
  config: SchedulerConfig;
}

export interface BackupsListResponse {
  backups: BackupItem[];
  backupDir: string;
  scheduler: SchedulerStatus;
}

export interface BackupCreatedResponse {
  file: string;
  path?: string;
  sizeBytes: number;
  dialect: string;
  kept: number;
  deleted: string[];
}

export interface RestoreResponse {
  ok: true;
  restoredFile: string;
  preRestoreSnapshot: string;
  manifest: {
    version: number;
    createdAt: string;
    dialect: string;
    appVersion?: string;
  };
  restored: {
    db: boolean;
    uploads: boolean;
    savedDbBackup: string | null;
    savedUploadsBackup: string | null;
  };
  durationMs: number;
  message: string;
}

export const backupsApi = {
  list: () => api<BackupsListResponse>('/api/admin/backups'),

  schedulerStatus: () => api<SchedulerStatus>('/api/admin/backups/scheduler-status'),

  updateSettings: (payload: UpdateSchedulerSettingsPayload) =>
    api<{ ok: true; scheduler: SchedulerStatus }>('/api/admin/backups/settings', {
      method: 'PUT',
      body: payload,
    }),

  createNow: () => api<BackupCreatedResponse>('/api/admin/backups/now', { method: 'POST' }),

  remove: (file: string) => api<{ ok: true }>(`/api/admin/backups/${file}`, { method: 'DELETE' }),

  restore: (file: string) =>
    api<RestoreResponse>(`/api/admin/backups/${file}/restore`, {
      method: 'POST',
      body: { confirm: 'RESTORE' },
    }),

  restart: () => api<{ message: string }>('/api/admin/backups/restart', { method: 'POST' }),

  /** Download autenticato via Bearer (Bearer non passabile via <a href>). */
  async download(file: string): Promise<Blob> {
    const token = tokenStore.get();
    if (!token) throw new Error('Sessione scaduta');
    const res = await fetch(`/api/admin/backups/${file}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Sessione scaduta' : `Errore ${res.status}`);
    }
    return res.blob();
  },

  async upload(file: File): Promise<{ file: string; sizeBytes: number; message: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return api('/api/admin/backups/upload', { method: 'POST', body: fd });
  },
};
