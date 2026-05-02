import { api } from '@/lib/api';

export type MailOutboxStatus = 'pending' | 'sent' | 'dead';

export interface MailOutboxItem {
  id: string;
  kind: string;
  to: string;
  subject: string;
  replyTo: string | null;
  priority: number;
  idempotencyKey: string | null;
  status: MailOutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailOutboxListResponse {
  items: MailOutboxItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface MailOutboxCounts {
  pending: number;
  sent: number;
  dead: number;
  total: number;
}

export interface MailOutboxHealth {
  smtpConfigured: boolean;
  verifyOk: boolean;
  verifyError: string | null;
  pending: number;
  dead: number;
  healthy: boolean;
}

export interface MailOutboxListParams {
  status?: MailOutboxStatus;
  kind?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
}

function qs(params: MailOutboxListParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const mailOutboxApi = {
  list: (params: MailOutboxListParams = {}) =>
    api<MailOutboxListResponse>(`/api/admin/mail-outbox${qs(params)}`),
  counts: () => api<MailOutboxCounts>('/api/admin/mail-outbox/counts'),
  health: () => api<MailOutboxHealth>('/api/admin/mail-outbox/health'),
  retry: (id: string) =>
    api<{ ok: boolean; item: MailOutboxItem }>(`/api/admin/mail-outbox/${id}/retry`, {
      method: 'POST',
    }),
  remove: (id: string) =>
    api<{ ok: boolean }>(`/api/admin/mail-outbox/${id}`, {
      method: 'DELETE',
    }),
};
