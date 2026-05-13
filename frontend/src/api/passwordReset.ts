import { api } from '@/lib/api';

export interface ValidateTokenResponse {
  valid: boolean;
  reason?: 'format' | 'not_found' | 'expired' | 'used';
  expiresAt?: string;
}

export const passwordResetApi = {
  /**
   * Richiede l'invio di un link di reset all'email indicata.
   * Sempre 200 generico (anti-enumeration): UX → toast neutro.
   */
  forgot: (email: string) =>
    api<{ ok: boolean }>('/api/auth/forgot-password', {
      method: 'POST',
      body: { email },
    }),

  /**
   * Verifica preventiva del token prima di mostrare il form. UX: se invalido
   * mostriamo subito un messaggio + CTA "richiedi nuovo link".
   */
  validateToken: (token: string) =>
    api<ValidateTokenResponse>(`/api/auth/reset-password/${token}/validate`),

  /**
   * Conferma del reset: cambia password e invalida tutte le sessioni esistenti.
   */
  reset: (token: string, newPassword: string) =>
    api<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword },
    }),
};
