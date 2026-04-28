import { api, tokenStore } from '@/lib/api';

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
    const token = tokenStore.get();
    const res = await fetch('/api/users/me/gdpr/export', {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let payload: { error?: string } = {};
      try {
        payload = (await res.json()) as { error?: string };
      } catch {
        // ignore
      }
      throw new Error(payload.error ?? `Errore HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const m = /filename="([^"]+)"/.exec(cd);
    const filename = m ? m[1] : `dati-personali-${Date.now()}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { filename, size: blob.size };
  },

  deleteAccount: () =>
    api<{
      message: string;
      cancelledFutureBookings: number;
    }>('/api/users/me/gdpr/delete-request', { method: 'POST' }),
};
