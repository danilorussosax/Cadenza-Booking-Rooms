import { api } from '@/lib/api';
import type { Role } from '@/types';

// Forma canonica restituita dal parser+mapping backend (services/integrations/
// isidata/fieldMapping.js → applyMapping). Mantenuta in sync con il modulo.
export interface ExternalUser {
  externalId: string | null;
  email: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  matricola: string | null;
  courseCode: string | null;
  courseName: string | null;
  status: 'active' | 'inactive';
  raw?: Record<string, string>;
}

export interface DiffSummary {
  fetched: number;
  warnings: { row?: number; msg: string }[];
  toCreate: number;
  toUpdate: number;
  toOrphan: number;
}

export interface ToUpdateItem {
  local: {
    id: number;
    email: string | null;
    firstName: string;
    lastName: string;
    role: Role;
    matricola: string | null;
    externalSource: string | null;
    externalId: string | null;
    isActive: boolean;
    status: string;
  };
  external: ExternalUser;
  fieldsChanged: string[];
  linkChanged: boolean;
}

export interface ToOrphanItem {
  id: number;
  email: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  matricola: string | null;
  isActive: boolean;
}

export interface PreviewResponse {
  token: string;
  hash: string;
  headers: string[];
  headerMap: Record<string, string>;
  summary: DiffSummary;
  diff: {
    toCreate: ExternalUser[];
    toUpdate: ToUpdateItem[];
    toOrphan: ToOrphanItem[];
  };
}

export interface ApplyResponse {
  runId: number;
  status: 'success' | 'partial' | 'failed';
  summary: {
    fetched: number;
    created: number;
    updated: number;
    orphaned: number;
    errors: number;
    warnings: { row?: number; msg: string }[];
  };
}

export interface SyncRun {
  id: number;
  configId: number | null;
  instituteId: number | null;
  provider: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string;
  status: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  orphaned: number;
  errors: number;
  errorPayload: unknown;
  diffSnapshot: unknown;
  createdAt: string;
  actor?: { id: number; firstName: string; lastName: string; email: string } | null;
}

export const integrationsApi = {
  /** Carica un file XLSX/CSV di Isidata e ottiene il diff senza modificare il DB. */
  preview: (file: File, mappingOverrides?: Record<string, string>) => {
    const fd = new FormData();
    fd.append('file', file);
    if (mappingOverrides) fd.append('mappingOverrides', JSON.stringify(mappingOverrides));
    return api<PreviewResponse>('/api/admin/integrations/isidata-csv/preview', {
      method: 'POST',
      body: fd,
    });
  },

  /** Conferma e applica il diff. Usa il token+hash ottenuti dalla preview. */
  apply: (payload: {
    token: string;
    confirmedDiffHash: string;
    mappingOverrides?: Record<string, string>;
  }) =>
    api<ApplyResponse>('/api/admin/integrations/isidata-csv/apply', {
      method: 'POST',
      body: payload,
    }),

  /** Storia degli ultimi run (default: tutti i provider). */
  runs: (params: { provider?: string; limit?: number } = {}) =>
    api<{ runs: SyncRun[] }>('/api/admin/integrations/runs', { query: { ...params } }),
};
