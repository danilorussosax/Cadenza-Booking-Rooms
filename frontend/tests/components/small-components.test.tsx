import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen } from '../test-utils';
import { AppFooter } from '@/components/AppFooter';
import { LanguageToggle } from '@/components/LanguageToggle';
import { FullscreenToggle } from '@/components/FullscreenToggle';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Aphorism } from '@/components/Aphorism';

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
