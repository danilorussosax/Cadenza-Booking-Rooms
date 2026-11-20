import { apiDownload, api } from '@/lib/api';
import { saveBlob } from '@/lib/download';

export type ConsentType = 'privacy_policy' | 'terms' | 'marketing';

export interface ConsentRecord {
  consentType: ConsentType;
  granted: boolean;
  policyVersion: string;
  decidedAt: string;
}

export const gdprApi = {
  // Stato dei consensi attivi (ultimo record per tipo).
  getConsents: () =>
    api<{ consents: Partial<Record<ConsentType, ConsentRecord>> }>('/api/users/me/gdpr/consent'),

  // Registra/aggiorna un consenso. Crea sempre un nuovo record (append-only).
  setConsent: (payload: { consentType: ConsentType; granted: boolean; policyVersion: string }) =>
    api<{ consent: ConsentRecord }>('/api/users/me/gdpr/consent', {
      method: 'POST',
      body: payload,
    }),

  // Richiede al server l'export e fa scaricare il file JSON al browser.
  // Non passa per `api()` perché serve come binary download (Blob).
  exportData: async () => {
    const { blob, filename: headerName } = await apiDownload('/api/users/me/gdpr/export');
    const filename = headerName ?? `dati-personali-${Date.now()}.json`;
    saveBlob(blob, filename);
    return { filename, size: blob.size };
  },

  deleteAccount: () =>
    api<{
      message: string;
      cancelledFutureBookings: number;
    }>('/api/users/me/gdpr/delete-request', { method: 'POST' }),
};
