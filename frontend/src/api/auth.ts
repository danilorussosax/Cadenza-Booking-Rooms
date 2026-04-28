import { api } from '@/lib/api';
import type {
  AuthResponse,
  LoginNeedsTwoFa,
  Role,
  TwoFaSendResponse,
  TwoFaStatus,
  User,
} from '@/types';

/** Risposta /login: o l'auth è completa, o serve lo step 2FA. */
export type LoginResponse = AuthResponse | LoginNeedsTwoFa;

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  matricola?: string;
  courseId?: number;
  role?: Role;
}

export const authApi = {
  register: (payload: RegisterPayload) =>
    api<AuthResponse>('/api/auth/register', { method: 'POST', body: payload, auth: false }),

  login: (email: string, password: string) =>
    api<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),

  // ───── 2FA via codice EMAIL ─────
  twoFaStatus: () => api<TwoFaStatus>('/api/auth/2fa/status'),
  /** Avvia il setup: il backend manda un codice 6 cifre all'email dell'utente. */
  twoFaSetup: () => api<TwoFaSendResponse>('/api/auth/2fa/setup', { method: 'POST' }),
  /** Resend del codice (enrollment se Bearer, login se tempToken). */
  twoFaResend: (tempToken?: string) =>
    api<TwoFaSendResponse>('/api/auth/2fa/resend', {
      method: 'POST',
      body: tempToken ? { tempToken } : undefined,
      auth: !tempToken,
    }),
  twoFaConfirmSetup: (code: string) =>
    api<{ enabled: boolean; recoveryCodes: string[]; message: string }>('/api/auth/2fa/verify', {
      method: 'POST',
      body: { code },
    }),
  /** Step 2 del login: scambia il tempToken + codice email (o recovery) per il
   *  JWT finale. Senza Bearer (il tempToken è nel body). */
  twoFaLoginVerify: (tempToken: string, payload: { code?: string; recoveryCode?: string }) =>
    api<AuthResponse>('/api/auth/2fa/verify', {
      method: 'POST',
      body: { tempToken, ...payload },
      auth: false,
    }),
  twoFaRegenerateRecovery: (code: string) =>
    api<{ recoveryCodes: string[] }>('/api/auth/2fa/recovery', {
      method: 'POST',
      body: { code },
    }),
  twoFaDisable: (code?: string, recoveryCode?: string) =>
    api<{ enabled: boolean }>('/api/auth/2fa/disable', {
      method: 'POST',
      body: { code, recoveryCode },
    }),

  me: () => api<{ user: User }>('/api/auth/me'),

  updateMe: (
    payload: Partial<
      Pick<
        User,
        | 'firstName'
        | 'lastName'
        | 'matricola'
        | 'courseId'
        | 'emailNotifications'
        | 'notifyOnConfirmation'
        | 'notifyOnReminder'
        | 'notifyOnCancellation'
        | 'role'
      >
    >,
  ) => api<{ user: User }>('/api/auth/me', { method: 'PATCH', body: payload }),

  changePassword: (currentPassword: string | undefined, newPassword: string) =>
    // Il backend bumpa tokenVersion al cambio password e restituisce un
    // nuovo JWT: il chiamante deve aggiornare tokenStore col nuovo `token`,
    // altrimenti la richiesta successiva fallirà con TOKEN_REVOKED.
    api<{ message: string; token: string }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),

  // Logout server-side: invalida tutte le sessioni dell'utente bumpando
  // tokenVersion. È volutamente "fire-and-forget" — l'AuthProvider chiama
  // `tokenStore.clear()` localmente subito dopo, senza attendere la risposta.
  logout: () => api<{ message: string }>('/api/auth/logout', { method: 'POST' }),

  uploadPhoto: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<{ user: User; profilePhotoUrl: string }>('/api/auth/me/photo', {
      method: 'POST',
      body: fd,
    });
  },

  deletePhoto: () => api<{ user: User }>('/api/auth/me/photo', { method: 'DELETE' }),

  // Sottoscrizione iCal — token a sola lettura
  getIcalToken: () => api<{ token: string }>('/api/auth/ical-token'),
  regenerateIcalToken: () => api<{ token: string }>('/api/auth/ical-token', { method: 'POST' }),
};
