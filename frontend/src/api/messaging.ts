import { api } from '@/lib/api';

export type MessagingChannel = 'telegram' | 'whatsapp_cloud' | 'signal_cli' | 'email_imap';

export interface BotBinding {
  id: number;
  channel: MessagingChannel;
  externalIdMasked: string;
  boundAt: string;
  lastSeenAt: string | null;
}

export interface BotBindingInitResponse {
  otp: string;
  expiresInMinutes: number;
}

export interface ChannelSettingsRow {
  channel: MessagingChannel;
  isEnabled: boolean;
  settings: Record<string, unknown>;
  /** Mappa "secret-key" → true (solo flag, mai il valore in chiaro).
   *  `Partial` perché le chiavi non configurate sono assenti, non `false`. */
  credentialsSet: Partial<Record<string, true>>;
}

export interface ChannelSettingsUpdate {
  isEnabled?: boolean;
  settings?: Record<string, unknown>;
  /** Per ogni secret: stringa nuova oppure '__KEEP__' per mantenere il valore precedente. */
  credentials?: Record<string, string>;
}

export const SECRET_PLACEHOLDER = '__KEEP__';

export const botBindingsApi = {
  list: () => api<{ bindings: BotBinding[] }>('/api/users/me/bot-bindings'),
  init: () => api<BotBindingInitResponse>('/api/users/me/bot-bindings/init', { method: 'POST' }),
  revoke: (id: number) =>
    api<{ message: string }>(`/api/users/me/bot-bindings/${id}`, { method: 'DELETE' }),
};

export interface TelegramAutoConfigureResult {
  ok: true;
  channel: 'telegram';
  isEnabled: boolean;
  secretGenerated: boolean;
  webhookUrl: string;
  bot: {
    id: number;
    username: string;
    firstName?: string;
    canJoinGroups?: boolean | null;
  } | null;
  steps: {
    getMe?: { ok: boolean };
    setWebhook?: { ok: boolean };
    setMyCommands?: { ok: boolean; count?: number };
    setMyDescription?: { ok: boolean; error?: string };
    setMyShortDescription?: { ok: boolean; error?: string };
    setMyName?: { ok: boolean; name?: string; error?: string };
    getWebhookInfo?: {
      ok: boolean;
      url?: string;
      pendingUpdateCount?: number;
      lastErrorMessage?: string | null;
      lastErrorDate?: number | null;
      expectedUrl?: string;
    };
  };
  warnings?: string[];
}

export const messagingSettingsApi = {
  list: () => api<{ settings: ChannelSettingsRow[] }>('/api/admin/messaging-settings'),
  update: (channel: MessagingChannel, payload: ChannelSettingsUpdate) =>
    api<ChannelSettingsRow>(`/api/admin/messaging-settings/${channel}`, {
      method: 'PUT',
      body: payload,
    }),
  test: (channel: MessagingChannel) =>
    api<{ ok: boolean; error?: string; info?: Record<string, unknown> }>(
      `/api/admin/messaging-settings/${channel}/test`,
      { method: 'POST' },
    ),
  autoConfigureTelegram: (payload?: { frontendUrl?: string; botName?: string }) =>
    api<TelegramAutoConfigureResult>('/api/admin/messaging-settings/telegram/auto-configure', {
      method: 'POST',
      body: payload ?? {},
    }),
};
