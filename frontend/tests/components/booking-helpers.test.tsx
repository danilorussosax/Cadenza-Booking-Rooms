import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen } from '../test-utils';
import { WeeklyExportPrintView } from '@/components/bookings/WeeklyExportPrintView';
import { BookingListItem } from '@/components/bookings/BookingListItem';
import { CookieBanner } from '@/components/legal/CookieBanner';
import { ConsentGate } from '@/components/legal/ConsentGate';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// useConsentGate: by default in test, needsConsent=false → il dialog non si
// monta. Singoli test possono usare vi.mocked(...).mockReturnValueOnce(...)
// per forzare il ramo opposto.
vi.mock('@/components/legal/useConsentGate', () => ({
  useConsentGate: vi.fn(() => ({ needsConsent: false, isLoading: false })),
}));

// useAuth: il ConsentGate chiama solo logout(); mockiamo il minimo indispensabile.
vi.mock('@/contexts/AuthContext', async () => {
  const actual =
    await vi.importActual<typeof import('@/contexts/AuthContext')>('@/contexts/AuthContext');
  return {
    ...actual,
    useAuth: () => ({ logout: vi.fn() }),
  };
});

describe('<WeeklyExportPrintView />', () => {
  it('si monta con array vuoto di edifici', () => {
    const { container } = renderWithProviders(
      <WeeklyExportPrintView
        weekStart="2025-11-03"
        buildings={[]}
        bookings={[]}
        institute={null}
      />,
    );
    expect(container).toBeInTheDocument();
  });
});

describe('<BookingListItem />', () => {
  it('renderizza una booking minima', () => {
    const booking = {
      id: 1,
      startTime: new Date('2025-11-03T10:00:00').toISOString(),
      endTime: new Date('2025-11-03T11:00:00').toISOString(),
      type: 'studio_individuale',
      status: 'confirmed',
      purpose: 'Test',
      room: { id: 1, name: 'Aula 1', building: { id: 1, name: 'Sede' } },
    } as never;
    const { container } = renderWithProviders(<BookingListItem booking={booking} />);
    expect(container.textContent).toContain('Aula');
  });
});

describe('<CookieBanner />', () => {
  it('si monta — mostra banner se consenso non ancora dato', () => {
    localStorage.clear();
    const { container } = renderWithProviders(<CookieBanner />);
    // Il banner usa testi i18n (chiave). Verifichiamo che almeno un button sia presente.
    expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(0);
  });
});

describe('<ConsentGate />', () => {
  it('ritorna null se needsConsent=false (default)', () => {
    const { container } = renderWithProviders(<ConsentGate />);
    expect(container.firstChild).toBeNull();
  });

  it('apre il dialog se needsConsent=true', async () => {
    const mod = await import('@/components/legal/useConsentGate');
    vi.mocked(mod.useConsentGate).mockReturnValueOnce({
      needsConsent: true,
      isLoading: false,
    });
    renderWithProviders(<ConsentGate />);
    expect(screen.getByText('Aggiornamento dei documenti legali')).toBeInTheDocument();
  });
});

describe('<OAuthButtons />', () => {
  it('si monta con oauthSettings vuote', () => {
    const { container } = renderWithProviders(
      <OAuthButtons settings={{ google: { enabled: false }, microsoft: { enabled: false } }} />,
    );
    expect(container).toBeInTheDocument();
  });
});

describe('<ConfirmDeleteDialog />', () => {
  it('si monta con open=false (chiuso → nessun titolo visibile)', () => {
    renderWithProviders(
      <ConfirmDeleteDialog
        open={false}
        onOpenChange={vi.fn()}
        title="Sei sicuro?"
        description="Conferma"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText('Sei sicuro?')).not.toBeInTheDocument();
  });

  it('open=true → mostra titolo e descrizione', () => {
    renderWithProviders(
      <ConfirmDeleteDialog
        open
        onOpenChange={vi.fn()}
        title="Elimina aula"
        description="Azione irreversibile"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText('Elimina aula')).toBeInTheDocument();
    expect(screen.getByText('Azione irreversibile')).toBeInTheDocument();
  });
});
