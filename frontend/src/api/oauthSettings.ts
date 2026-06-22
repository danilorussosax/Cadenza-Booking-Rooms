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
  /** CSV o array; backend normalizza (lowercase, trim, dedup). Stringa vuota = rimuovi restrizione. */
  allowedEmailDomains?: string | string[];
  /** Gate gruppi M365 (cambio → restartRequired, cambia lo scope OAuth al boot). */
  groupGateEnabled?: boolean;
  groupStudenti?: string;
  groupDocenti?: string;
  groupAmministrazione?: string;
  groupDirezione?: string;
}

export const oauthSettingsApi = {
  get: () => api<{ settings: OAuthSettings }>('/api/admin/oauth-settings'),
  update: (payload: UpsertOAuthSettings) =>
    api<{ settings: OAuthSettings; restartRequired: boolean }>('/api/admin/oauth-settings', {
      method: 'PUT',
      body: payload,
    }),
};
