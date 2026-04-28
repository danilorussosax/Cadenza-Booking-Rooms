import { api } from '@/lib/api';
import type { BookingQuota, QuotaScopeKind, Role } from '@/types';

export interface UpsertQuotaPayload {
  role: Role;
  scopeKind: QuotaScopeKind;
  /** room.type / equipment.type / id numerico (room/building) / '*' per global. */
  scopeValue?: string;
  maxHoursPerWeek?: number;
  maxHoursPerDay?: number;
  maxHoursPerMonth?: number;
  maxBookings?: number;
  daysOfWeek?: number[];
  timeFrom?: string | null;
  timeTo?: string | null;
  isActive?: boolean;
}

export const quotasApi = {
  list: (filters: { role?: Role; scopeKind?: QuotaScopeKind; isActive?: boolean } = {}) =>
    api<{ quotas: BookingQuota[] }>('/api/admin/quotas', { query: filters }),
  create: (payload: UpsertQuotaPayload) =>
    api<{ quota: BookingQuota }>('/api/admin/quotas', { method: 'POST', body: payload }),
  update: (id: number, payload: Partial<UpsertQuotaPayload>) =>
    api<{ quota: BookingQuota }>(`/api/admin/quotas/${id}`, { method: 'PUT', body: payload }),
  remove: (id: number, force = false) =>
    api<{ message: string }>(`/api/admin/quotas/${id}`, {
      method: 'DELETE',
      query: force ? { force: 'true' } : undefined,
    }),
};
