import { api } from '@/lib/api';
import type { AuditLogEntry } from '@/types';

export interface AuditLogListParams {
  page?: number;
  pageSize?: number;
  actorId?: number;
  action?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  targetType?: string;
  targetId?: number;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

export interface AuditLogListResponse {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const auditLogApi = {
  list: (params: AuditLogListParams = {}) =>
    api<AuditLogListResponse>('/api/admin/audit-log', {
      query: params as Record<string, unknown>,
    }),
  targetTypes: () => api<{ targetTypes: string[] }>('/api/admin/audit-log/target-types'),
};
