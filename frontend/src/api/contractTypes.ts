import { api } from '@/lib/api';
import type { ContractTypeRow } from '@/types';

export interface ImpactReport {
  contractType: { id: number; code: string; label: string; defaultHours: number | null };
  usersAffectedCount: number;
  usersAffected: { id: number; firstName: string; lastName: string; email: string }[];
  usersWithOverrideCount: number;
  draftProposalsCount: number;
}

export interface ContractTypeUpsertPayload {
  label?: string;
  code?: string; // solo in CREATE; ignorato in UPDATE
  defaultHours?: number | null;
  bypassDayConstraintDefault?: boolean;
  sortOrder?: number;
  isActive?: boolean;
  notes?: string | null;
  /** flag che il client setta dopo aver mostrato il dialog di impatto. */
  confirmedImpact?: boolean;
}

export const contractTypesApi = {
  list: (opts?: { includeInactive?: boolean }) =>
    api<{ contractTypes: ContractTypeRow[] }>(
      `/api/contract-types${opts?.includeInactive ? '?includeInactive=true' : ''}`,
    ),

  impact: (id: number) => api<ImpactReport>(`/api/contract-types/${id}/impact`),

  create: (payload: ContractTypeUpsertPayload) =>
    api<{ contractType: ContractTypeRow }>('/api/contract-types', {
      method: 'POST',
      body: payload,
    }),

  update: (id: number, payload: ContractTypeUpsertPayload) =>
    api<{ contractType: ContractTypeRow }>(`/api/contract-types/${id}`, {
      method: 'PUT',
      body: payload,
    }),

  remove: (id: number) =>
    api<{ deleted: boolean }>(`/api/contract-types/${id}`, { method: 'DELETE' }),
};
