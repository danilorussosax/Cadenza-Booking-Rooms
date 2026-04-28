import { api } from '@/lib/api';
import type { OAuthSettings } from '@/types';

export const SECRET_PLACEHOLDER = '__unchanged__';

export interface UpsertOAuthSettings {
  googleEnabled?: boolean;
  googleClientId?: string;
  googleClientSecret?: string; // SECRET_PLACEHOLDER per non modificare
  googleCallbackUrl?: string;
  microsoftEnabled?: boolean;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  microsoftCallbackUrl?: string;
  microsoftTenant?: string;
}

export const oauthSettingsApi = {
  get: () => api<{ settings: OAuthSettings }>('/api/admin/oauth-settings'),
  update: (payload: UpsertOAuthSettings) =>
    api<{ settings: OAuthSettings; restartRequired: boolean }>('/api/admin/oauth-settings', {
      method: 'PUT',
      body: payload,
    }),
};
