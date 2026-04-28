import { api } from '@/lib/api';

export interface MailSettingsView {
  isEnabled: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  username: string | null;
  passwordSet: boolean;
  fromAddress: string | null;
  fromName: string | null;
  replyTo: string | null;
  source: 'database' | 'database-disabled' | 'env-fallback';
  updatedAt?: string;
}

export interface MailSettingsResponse {
  settings: MailSettingsView;
  envFallback: { hasEnvHost: boolean };
}

export interface MailSettingsPayload {
  isEnabled?: boolean;
  host?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
  /** Lascia undefined per non modificare; "" per cancellare; valore per impostare */
  password?: string;
  fromAddress?: string | null;
  fromName?: string | null;
  replyTo?: string | null;
}

export const mailSettingsApi = {
  get: () => api<MailSettingsResponse>('/api/admin/mail-settings'),
  update: (payload: MailSettingsPayload) =>
    api<{ settings: MailSettingsView }>('/api/admin/mail-settings', {
      method: 'PUT',
      body: payload,
    }),
  test: (to?: string, message?: string) =>
    api<{ ok: boolean; sentTo?: string; error?: string; raw?: string }>(
      '/api/admin/mail-settings/test',
      { method: 'POST', body: { to, message } },
    ),
};
