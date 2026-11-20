import { createContext, useContext } from 'react';

/** Contesto del tema e hook `useTheme`, separati dal provider (`ThemeContext.tsx`) per React Fast Refresh. */
export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  /** Forza un tema specifico senza scrivere in localStorage. Utile per
   *  pagine kiosk (`/display`) che devono avere palette consistente
   *  indipendentemente dalle preferenze OS del dispositivo. Passare `null`
   *  per rimuovere la forzatura e tornare al tema utente/sistema. */
  setForceTheme: (theme: ResolvedTheme | null) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
