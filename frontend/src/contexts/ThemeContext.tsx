import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeContext, type ResolvedTheme, type Theme } from '@/contexts/theme';

const STORAGE_KEY = 'conservatory_theme';

function readStored(): Theme {
  if (typeof window === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

// matchMedia può mancare (SSR, jsdom, browser molto vecchi): TS lo dà per sempre presente.
function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function systemPrefers(): ResolvedTheme {
  if (!hasMatchMedia()) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyClass(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => systemPrefers());
  // Override non-persistente: quando valorizzato vince su `theme` e
  // `systemTheme`. Usato da /display per forzare la palette del kiosk.
  const [forceTheme, setForceTheme] = useState<ResolvedTheme | null>(null);

  // Watch system preference changes
  useEffect(() => {
    if (!hasMatchMedia()) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => {
      mq.removeEventListener('change', handler);
    };
  }, []);

  const resolved: ResolvedTheme = forceTheme ?? (theme === 'system' ? systemTheme : theme);

  // Apply class
  useEffect(() => {
    applyClass(resolved);
  }, [resolved]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    if (t === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, t);
  }, []);

  const toggle = useCallback(() => {
    // Cycle: light → dark → system → light
    setThemeState((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light';
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ theme, resolved, setTheme, toggle, setForceTheme }),
    [theme, resolved, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
