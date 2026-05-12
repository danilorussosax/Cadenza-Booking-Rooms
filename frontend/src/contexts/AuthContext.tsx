import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi } from '@/api/auth';
import { tokenStore, userCache } from '@/lib/api';
import type { Role, User } from '@/types';

interface AuthState {
  user: User | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
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
// eslint-disable-next-line react-refresh/only-export-components -- context colocato col provider
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function profileComplete(user: User | null) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.courseId) return false;
  if (user.role === 'studente' && !user.matricola) return false;
  return true;
}

function isUserApproved(user: User | null) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.status === 'approved';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({
    user: userCache.get<User>(),
    loading: Boolean(tokenStore.get()),
  }));

  const refreshUser = useCallback(async () => {
    if (!tokenStore.get()) {
      setState({ user: null, loading: false });
      return null;
    }
    try {
      const { user } = await authApi.me();
      userCache.set(user);
      setState({ user, loading: false });
      return user;
    } catch {
      tokenStore.clear();
      setState({ user: null, loading: false });
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const loginWithCredentials = useCallback<AuthContextValue['loginWithCredentials']>(
    async (email, password) => {
      const res = await authApi.login(email, password);
      // Backend ritorna { needsTwoFa, tempToken } se l'utente ha il 2FA
      // attivo: NON popoliamo lo stato finché non completiamo lo step 2.
      if ('needsTwoFa' in res) {
        return {
          kind: 'twofa',
          tempToken: res.tempToken,
          sentTo: res.sentTo,
          expiresInMinutes: res.expiresInMinutes,
        };
      }
      tokenStore.set(res.token);
      userCache.set(res.user);
      setState({ user: res.user, loading: false });
      return { kind: 'ok', user: res.user };
    },
    [],
  );

  const completeTwoFaLogin = useCallback<AuthContextValue['completeTwoFaLogin']>(
    async (tempToken, payload) => {
      const { token, user } = await authApi.twoFaLoginVerify(tempToken, payload);
      tokenStore.set(token);
      userCache.set(user);
      setState({ user, loading: false });
      return user;
    },
    [],
  );

  const registerAccount = useCallback<AuthContextValue['registerAccount']>(async (payload) => {
    const { token, user } = await authApi.register(payload);
    tokenStore.set(token);
    userCache.set(user);
    setState({ user, loading: false });
    return user;
  }, []);

  const setSessionToken = useCallback(async (token: string) => {
    tokenStore.set(token);
    setState((s) => ({ ...s, loading: true }));
    const { user } = await authApi.me();
    userCache.set(user);
    setState({ user, loading: false });
    return user;
  }, []);

  const updateUser = useCallback((updates: Partial<User>) => {
    setState((s) => {
      if (!s.user) return s;
      const merged = { ...s.user, ...updates };
      userCache.set(merged);
      return { ...s, user: merged };
    });
  }, []);

  const logout = useCallback(() => {
    // Best-effort POST /api/auth/logout: bumpa tokenVersion lato server
    // così altri device dell'utente vengono kickati. Non aspettiamo:
    // l'effetto locale (clear + setState null) deve essere immediato anche
    // se il server è offline.
    authApi.logout().catch(() => {
      /* ignora — pulizia locale comunque */
    });
    tokenStore.clear();
    setState({ user: null, loading: false });
  }, []);

  // Listener globale per eventi 'auth:expired' emessi da lib/api.ts su 401:
  // forza il logout locale (no API call: il token è già invalido lato server)
  // così l'utente viene rediretto al /login senza dover attendere
  // un'interazione esplicita con il bottone "Esci".
  useEffect(() => {
    const handler = () => {
      tokenStore.clear();
      setState({ user: null, loading: false });
    };
    window.addEventListener('auth:expired', handler);
    return () => {
      window.removeEventListener('auth:expired', handler);
    };
  }, []);

  // Sincronizza Sentry user scope quando cambia l'utente loggato. L'id reale
  // viene anonimizzato via SHA-256 dentro setSentryUser. No-op senza DSN.
  useEffect(() => {
    void import('@/lib/sentry').then(({ setSentryUser }) => {
      setSentryUser(state.user ? { id: state.user.id, role: state.user.role } : null);
    });
  }, [state.user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isAuthenticated: Boolean(state.user),
      isProfileComplete: profileComplete(state.user),
      isApproved: isUserApproved(state.user),
      isPendingApproval:
        Boolean(state.user) &&
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state.user!.role !== 'admin' &&
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state.user!.status === 'pending' &&
        profileComplete(state.user),
      hasRole: (...roles) => Boolean(state.user && roles.includes(state.user.role)),
      loginWithCredentials,
      completeTwoFaLogin,
      registerAccount,
      setSessionToken,
      refreshUser,
      updateUser,
      logout,
    }),
    [
      state,
      loginWithCredentials,
      completeTwoFaLogin,
      registerAccount,
      setSessionToken,
      refreshUser,
      updateUser,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook colocato col provider
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
