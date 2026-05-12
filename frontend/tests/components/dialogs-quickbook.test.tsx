import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen } from '../test-utils';
import { CancelBookingDialog } from '@/components/bookings/CancelBookingDialog';
import { ImpactConfirmDialog } from '@/components/admin/ImpactConfirmDialog';
import { QuickBookCard } from '@/components/bookings/QuickBookCard';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/contexts/ThemeContext';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/api/bookings', () => ({
  bookingsApi: {
    cancel: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock('@/api/contractTypes', () => ({
  contractTypesApi: {
    impact: vi.fn().mockResolvedValue({
      usersAffectedCount: 0,
      usersWithOverrideCount: 0,
      draftProposalsCount: 0,
      usersAffected: [],
    }),
  },
}));

vi.mock('@/api/bookingTemplates', () => ({
  bookingTemplatesApi: {
    list: vi.fn().mockResolvedValue({ templates: [] }),
    quickBook: vi.fn(),
  },
}));

describe('<CancelBookingDialog />', () => {
  const mkBooking = () =>
    ({
      id: 1,
      type: 'studio_individuale',
      status: 'confirmed',
      startTime: '2026-05-12T10:00:00Z',
      endTime: '2026-05-12T11:00:00Z',
      room: { id: 1, name: 'Aula 1' },
    }) as never;

  it('non renderizza dialog quando booking è null', () => {
    const { container } = renderWithProviders(
      <CancelBookingDialog booking={null} onClose={vi.fn()} />,
    );
    expect(container.textContent ?? '').not.toMatch(/Annullare la prenotazione/i);
  });

  it('renderizza titolo e bottoni quando booking è settato', () => {
    renderWithProviders(<CancelBookingDialog booking={mkBooking()} onClose={vi.fn()} />);
    expect(screen.getByText(/Annullare la prenotazione/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mantieni/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Annulla prenotazione/i })).toBeInTheDocument();
  });

  it('click su Mantieni chiama onClose', async () => {
    const onClose = vi.fn();
    renderWithProviders(<CancelBookingDialog booking={mkBooking()} onClose={onClose} />);
    const btn = screen.getByRole('button', { name: /Mantieni/i });
    btn.click();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('<ImpactConfirmDialog />', () => {
  it('renderizza il titolo + descrizione con vecchia/nuova soglia', async () => {
    renderWithProviders(
      <ImpactConfirmDialog
        contractType={{ id: 1, label: 'Docente', defaultHours: 250 } as never}
        newDefaultHours={300}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        confirming={false}
      />,
    );
    expect(screen.getByText(/Conferma cambio soglia ore/i)).toBeInTheDocument();
    expect(screen.getByText(/Docente/)).toBeInTheDocument();
  });

  it('mostra "non impostata" quando i valori sono null', () => {
    renderWithProviders(
      <ImpactConfirmDialog
        contractType={{ id: 1, label: 'Docente', defaultHours: null } as never}
        newDefaultHours={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        confirming={false}
      />,
    );
    expect(screen.getAllByText(/non impostata/i).length).toBeGreaterThan(0);
  });
});

describe('<QuickBookCard />', () => {
  it("non renderizza nulla se l'utente non ha favoriti (empty-silent)", () => {
    const { container } = renderWithProviders(<QuickBookCard />);
    // Empty silent: il card non appare. Container resta vuoto (a parte
    // eventuali React fragments di QueryClientProvider).
    expect(container.querySelector('h3, [data-slot="card-title"]')).toBeNull();
  });
});

describe('<Toaster /> (sonner wrapper)', () => {
  it('si monta dentro ThemeProvider senza crash', () => {
    const { container } = renderWithProviders(
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>,
    );
    expect(container).toBeInTheDocument();
  });
});

describe('<Sheet /> (ui primitive)', () => {
  it('renderizza il trigger; il content si apre solo via radix portal', () => {
    renderWithProviders(
      <Sheet>
        <SheetTrigger asChild>
          <button type="button">Apri pannello</button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Titolo</SheetTitle>
            <SheetDescription>Descrizione</SheetDescription>
          </SheetHeader>
          <p>Contenuto del pannello</p>
          <SheetFooter>
            <SheetClose asChild>
              <button type="button">Chiudi</button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('button', { name: /Apri pannello/i })).toBeInTheDocument();
  });

  it('renderizza il content quando defaultOpen=true', () => {
    renderWithProviders(
      <Sheet defaultOpen>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Header del pannello</SheetTitle>
            <SheetDescription>desc</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByText(/Header del pannello/i)).toBeInTheDocument();
  });

  it.each(['top', 'bottom', 'left', 'right'] as const)('side="%s" rende il content', (side) => {
    renderWithProviders(
      <Sheet defaultOpen>
        <SheetContent side={side}>
          <SheetTitle>S {side}</SheetTitle>
          <SheetDescription>d</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByText(`S ${side}`)).toBeInTheDocument();
  });
});
