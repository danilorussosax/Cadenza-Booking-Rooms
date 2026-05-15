import { api } from '@/lib/api';

export interface OpsVps {
  hostname: string;
  platform: string;
  arch: string;
  cpuCount: number;
  loadAvg: [number, number, number];
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number | null;
  };
  uptimeSec: number;
  processUptimeSec: number;
  nodeVersion: string;
  disk: {
    totalBytes: number;
    usedBytes: number;
    availBytes: number;
    usedPercent: number | null;
  } | null;
}

export interface OpsPostgres {
  dialect: string;
  available: boolean;
  connections?: {
    total: number;
    active: number;
    idle: number;
    idle_in_tx: number;
  } | null;
  connectionsError?: string;
  dbSizeBytes?: number;
  dbSizeError?: string;
  topTables?: {
    table: string;
    liveTuples: number;
    lastAutovacuum: string | null;
    lastAutoanalyze: string | null;
  }[];
  topTablesError?: string;
}

export interface OpsMailOutbox {
  pending?: number;
  sent?: number;
  dead?: number;
  total?: number;
  oldestPendingAt?: string | null;
  oldestPendingAgeSec?: number | null;
  error?: string;
}

export interface OpsBackupVerify {
  enabled: boolean;
  lastTickAt: string | null;
  lastOk: boolean | null;
  lastReason: string | null;
  nextTickAt: string | null;
}

export interface OpsBackups {
  count?: number;
  lastBackup: {
    file: string;
    sizeBytes: number;
    createdAt: string;
  } | null;
  lastBackupAgeHours?: number | null;
  totalSizeBytes?: number;
  dir?: string;
  verify?: OpsBackupVerify | null;
  error?: string;
}

export interface OpsScheduler {
  name: string;
  enabled: boolean;
  running?: boolean;
  intervalMs?: number | null;
  lastTickAt?: string | null;
  lastError?: string | null;
  nextTickAt?: string | null;
  error?: string;
}

export interface OpsSnapshot {
  capturedAt: string;
  vps: OpsVps;
  postgres: OpsPostgres;
  mailOutbox: OpsMailOutbox;
  backups: OpsBackups;
  schedulers: OpsScheduler[];
}

export const opsApi = {
  snapshot: () => api<OpsSnapshot>('/api/admin/ops/snapshot'),
  snapshotForce: () => api<OpsSnapshot>('/api/admin/ops/snapshot', { query: { force: '1' } }),
};
