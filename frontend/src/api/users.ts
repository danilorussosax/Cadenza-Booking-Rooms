import { api, tokenStore } from '@/lib/api';
import type { ContractType, Role, User, UserStatus } from '@/types';

export interface MonteOreOverridePayload {
  contractType?: ContractType | null;
  monteOreAnnualHoursOverride?: number | null;
  monteOreBypassDayConstraint?: boolean;
  monteOreOverrideReason?: string | null;
}

export interface UsersListParams {
  role?: Role;
  active?: boolean;
  status?: UserStatus;
}

export interface UpsertUserPayload {
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
  newPassword?: string;
  role: Role;
  matricola?: string | null;
  courseId?: number | null;
  isActive: boolean;
}

export const usersApi = {
  list: (params: UsersListParams = {}) =>
    api<{ users: User[] }>('/api/users', { query: { ...params } }),

  get: (id: number) => api<{ user: User }>(`/api/users/${id}`),

  create: (payload: UpsertUserPayload) =>
    api<{ user: User }>('/api/users', { method: 'POST', body: payload }),

  update: (id: number, payload: Partial<UpsertUserPayload>) =>
    api<{ user: User }>(`/api/users/${id}`, { method: 'PUT', body: payload }),

  remove: (id: number) => api<{ message: string }>(`/api/users/${id}`, { method: 'DELETE' }),

  approve: (id: number) => api<{ user: User }>(`/api/users/${id}/approve`, { method: 'POST' }),

  reject: (id: number) => api<{ user: User }>(`/api/users/${id}/reject`, { method: 'POST' }),

  /** Reset hard-bounce dell'email: l'utente torna a ricevere notifiche. */
  resetBounce: (id: number) =>
    api<{ user: User }>(`/api/users/${id}/reset-bounce`, { method: 'POST' }),

  pendingCount: () => api<{ count: number }>('/api/users/pending/count'),

  bulkDelete: (ids: number[]) =>
    api<{ deleted: number; removedBookings: number }>('/api/users/bulk-delete', {
      method: 'POST',
      body: { ids },
    }),

  bulkApprove: (ids: number[], action: 'approve' | 'reject') =>
    api<{ changed: number; skipped: number }>('/api/users/bulk-approve', {
      method: 'POST',
      body: { ids, action },
    }),

  /** Imposta o rimuove la deroga Monte Ore individuale (admin). */
  setMonteOreOverride: (id: number, payload: MonteOreOverridePayload) =>
    api<{ user: User }>(`/api/users/${id}/monte-ore-override`, {
      method: 'PUT',
      body: payload,
    }),

  /** Esporta gli utenti in CSV. NON include password/2FA — solo email,
   *  anagrafica, ruolo, matricola, codice corso, stato e flag attivo.
   *  Bearer richiesto: scarica via fetch+blob (un <a href> non manda l'header). */
  async downloadCsv(): Promise<Blob> {
    const token = tokenStore.get();
    if (!token) throw new Error('Sessione scaduta');
    const res = await fetch('/api/users/export.csv', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Sessione scaduta' : `Errore ${res.status}`);
    }
    return res.blob();
  },

  /** Importa utenti da CSV. Per nuovi utenti viene generata una password
   *  temporanea casuale (l'admin invita poi al reset). Idempotente su email. */
  importCsv: (csv: string) =>
    api<{
      parsed: number;
      created: number;
      updated: number;
      skipped: number;
      errors: { line: number; msg: string }[];
    }>('/api/users/import', {
      method: 'POST',
      body: { csv },
    }),
};
