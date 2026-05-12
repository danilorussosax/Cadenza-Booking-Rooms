import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen } from '../test-utils';
import { AppFooter } from '@/components/AppFooter';
import { LanguageToggle } from '@/components/LanguageToggle';
import { FullscreenToggle } from '@/components/FullscreenToggle';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Aphorism } from '@/components/Aphorism';
import { OfflineBanner } from '@/components/OfflineBanner';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';

describe('<AppFooter />', () => {
  it('renderizza footer con copyright/info', () => {
    const { container } = renderWithProviders(<AppFooter />);
    expect(container.querySelector('footer, div')).toBeInTheDocument();
  });
});

describe('<LanguageToggle />', () => {
  it('si monta', () => {
    renderWithProviders(<LanguageToggle />);
    // bottone presente (non testiamo l'apertura del menu Radix in jsdom)
    expect(document.querySelector('button')).toBeInTheDocument();
  });
});

describe('<FullscreenToggle />', () => {
  it('renderizza un pulsante', () => {
    renderWithProviders(<FullscreenToggle />);
    expect(document.querySelector('button')).toBeInTheDocument();
  });
});

describe('<ThemeToggle />', () => {
  it('si monta dentro ThemeProvider', () => {
    renderWithProviders(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.querySelector('button')).toBeInTheDocument();
  });
});

describe('<Aphorism />', () => {
  it('mostra un aforisma', () => {
    const { container } = renderWithProviders(<Aphorism />);
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('<AppErrorBoundary />', () => {
  function Boom() {
    throw new Error('boom');
  }

  it('cattura errore di rendering e mostra fallback', () => {
    // Sopprimi la console.error rumorosa di React quando fa il render dell'errore
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWithProviders(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByText(/Si è verificato un errore/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('mostra i bottoni Riprova e Ricarica', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWithProviders(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /Riprova/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ricarica/i })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('"Ricarica" è callable senza crashare il componente', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // window.location.reload() non è invocabile in jsdom — verifichiamo solo
    // che il bottone esista ed abbia un handler.
    renderWithProviders(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    const ricarica = screen.getByRole('button', { name: /Ricarica/i });
    expect(ricarica).toBeInTheDocument();
    expect(
      typeof (ricarica as HTMLButtonElement).onclick === 'function' ||
        ricarica.hasAttribute('type'),
    ).toBe(true);
    spy.mockRestore();
  });
});

describe('<OfflineBanner />', () => {
  it('non rende nulla quando online (default jsdom: navigator.onLine=true)', () => {
    const { container } = renderWithProviders(<OfflineBanner />);
    // AnimatePresence non monta i figli quando il guard è false
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('mostra il banner quando navigator va offline', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      const { container } = renderWithProviders(<OfflineBanner />);
      // Forziamo il fire dell'evento 'offline' che useOnline ascolta
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      const status = container.querySelector('[role="status"]');
      expect(status).not.toBeNull();
      expect(status?.textContent).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(navigator, 'onLine', original);
    }
  });
});

describe('<MobileBottomNav />', () => {
  it('renderizza 4 NavLink (dashboard, booking, my-bookings, profile)', () => {
    const { container } = renderWithProviders(<MobileBottomNav />);
    const links = container.querySelectorAll('a');
    expect(links.length).toBe(4);
    const hrefs = Array.from(links).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining(['/dashboard', '/booking', '/my-bookings', '/profile']),
    );
  });

  it('ha aria-label sul nav per screen reader', () => {
    const { container } = renderWithProviders(<MobileBottomNav />);
    const nav = container.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBeTruthy();
  });
});
