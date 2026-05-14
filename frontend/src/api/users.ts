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

  /** Invia un magic-link "imposta password" a un singolo utente che non ha
   *  ancora una password (tipicamente importato da Isidata). Invalida i
   *  token precedenti dello stesso utente e ne emette uno nuovo. */
  sendSetupLink: (id: number, ttlDays?: number) =>
    api<{ sent: true; expiresAt: string }>(`/api/users/${id}/send-setup-link`, {
      method: 'POST',
      body: ttlDays != null ? { ttlDays } : {},
    }),

  /** Bulk-invio del magic-link a N utenti (post-import Isidata o azione
   *  manuale dalla pagina Utenti). `onlyMissingPassword` default true
   *  salta automaticamente gli utenti che hanno già una password. */
  sendSetupLinksBulk: (params: {
    userIds: number[];
    ttlDays?: number;
    onlyMissingPassword?: boolean;
  }) =>
    api<{
      sent: number;
      skipped: number;
      skippedReasons: Record<string, number>;
    }>('/api/users/send-setup-links-bulk', {
      method: 'POST',
      body: params,
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

  /** Importa utenti da CSV o XLSX. Per nuovi utenti viene generata una
   *  password temporanea casuale (l'admin invita poi al reset). Idempotente
   *  su email. Multipart upload: file con header standard (Email, Cognome,
   *  Nome, Ruolo, Matricola, CodiceCorso, Stato, Attivo). */
  importCsv: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<{
      parsed: number;
      created: number;
      updated: number;
      skipped: number;
      errors: { line: number; msg: string }[];
      warnings?: { row?: number; msg: string }[];
    }>('/api/users/import', {
      method: 'POST',
      body: fd,
    });
  },
};
