import { createContext, useContext } from 'react';
import type { authApi } from '@/api/auth';
import type { Role, User } from '@/types';

/**
 * Contesto di autenticazione e hook `useAuth`, separati dal provider
 * (`AuthContext.tsx`) perché Vite/React Fast Refresh richiede che un file
 * con componenti esporti solo componenti.
 */
export interface AuthState {
  user: User | null;
  loading: boolean;
}

export interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  hasRole: (...roles: Role[]) => boolean;
  isProfileComplete: boolean;
  isApproved: boolean;
  isPendingApproval: boolean;
  /** Restituisce l'utente loggato, oppure il tempToken pre-2FA + info su dove
   *  è stato inviato il codice email (sentTo mascherato, expiresInMinutes). */
  loginWithCredentials: (
    email: string,
    password: string,
  ) => Promise<
    | { kind: 'ok'; user: User }
    | { kind: 'twofa'; tempToken: string; sentTo: string; expiresInMinutes: number }
  >;
  /** Step 2 del login: scambia tempToken + codice TOTP/recovery con il JWT
   *  finale e popola lo stato utente. */
  completeTwoFaLogin: (
    tempToken: string,
    payload: { code?: string; recoveryCode?: string },
  ) => Promise<User>;
  registerAccount: (payload: Parameters<typeof authApi.register>[0]) => Promise<User>;
  setSessionToken: (token: string) => Promise<User>;
  refreshUser: () => Promise<User | null>;
  updateUser: (updates: Partial<User>) => void;
  logout: () => void;
}

// Esportato per consentire un consumo "soft" (es. CookieBanner via
// useConsentGate): hook che vogliono operare sia dentro l'app autentica
// sia in test/contesti senza AuthProvider possono fare useContext(AuthContext)
// e gestire `undefined` invece di chiamare useAuth() che throwa.
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
