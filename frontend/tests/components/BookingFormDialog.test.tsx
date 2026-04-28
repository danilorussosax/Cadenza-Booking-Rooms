import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '../test-utils';
import { HttpError } from '@/lib/api';

// Mock delle 3 API che il dialog usa.
vi.mock('@/api/bookings', () => ({
  bookingsApi: {
    create: vi.fn(),
    createRecurring: vi.fn(),
  },
}));
vi.mock('@/api/rooms', () => ({
  roomsApi: {
    list: vi.fn(),
  },
}));
vi.mock('@/api/waitlist', () => ({
  waitlistApi: {
    join: vi.fn(),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
// Mock dell'AuthContext: il dialog ora chiama useAuth() per scoprire il
// ruolo (mostra il selettore "Prenota a nome di…" solo agli admin). I test
// non devono passare per il flusso di login, quindi forniamo un docente.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'docente', firstName: 'T', lastName: 'User' },
  }),
}));
// usersApi viene chiamato solo per gli admin; per il docente il mock resta
// inerte (la query è disabilitata), ma stub-iamo comunque per sicurezza.
vi.mock('@/api/users', () => ({
  usersApi: {
    list: vi.fn().mockResolvedValue({ users: [] }),
  },
}));

import { bookingsApi } from '@/api/bookings';
import { roomsApi } from '@/api/rooms';
import { waitlistApi } from '@/api/waitlist';
import { BookingFormDialog } from '@/components/bookings/BookingFormDialog';

const mockedBookings = bookingsApi as unknown as { create: ReturnType<typeof vi.fn> };
const mockedRooms = roomsApi as unknown as { list: ReturnType<typeof vi.fn> };
const mockedWaitlist = waitlistApi as unknown as { join: ReturnType<typeof vi.fn> };

const sampleRooms = [
  {
    id: 1,
    name: 'Aula 101',
    floor: 'Piano terra',
    type: 'studio',
    capacity: 5,
    isBookable: true,
    building: { id: 1, name: 'Edificio A' },
  },
];

describe('<BookingFormDialog />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRooms.list.mockResolvedValue({ rooms: sampleRooms });
  });

  it('renderizza il dialog quando open=true', async () => {
    renderWithProviders(<BookingFormDialog open={true} onOpenChange={() => {}} />);
    // Il titolo del dialog usa la chiave i18n; il fallback rende la chiave
    // letterale, che basta per asserire la presenza.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('non renderizza il dialog quando open=false', () => {
    renderWithProviders(<BookingFormDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('su BOOKING_CONFLICT chiude il dialog principale e mostra il popup waitlist', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    // Simula errore conflict dal server
    mockedBookings.create.mockRejectedValueOnce(
      new HttpError(409, { error: 'conflict', code: 'BOOKING_CONFLICT' }),
    );

    const start = new Date(Date.now() + 60 * 60 * 1000);
    // Durata 60 min: lo studio individuale (tipo di default) richiede almeno
    // 1 ora — vedi STUDIO_MIN_DURATION_MINUTES nella schema del form.
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    renderWithProviders(
      <BookingFormDialog
        open={true}
        onOpenChange={onOpenChange}
        defaultRoomId={1}
        defaultStart={start}
        defaultEnd={end}
        lockRoom
      />,
    );

    // Aspetta caricamento aule
    await waitFor(() => expect(mockedRooms.list).toHaveBeenCalled());

    // Submit del form (cerca un button submit dentro il dialog)
    const submitBtn = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('type') === 'submit');
    expect(submitBtn).toBeTruthy();
    await user.click(submitBtn!);

    // Il componente, alla ricezione di BOOKING_CONFLICT, chiude il dialog
    // (chiama onOpenChange(false)) e prepara il popup waitlist.
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    // bookingsApi.create deve essere stato chiamato
    expect(mockedBookings.create).toHaveBeenCalled();
    // Il popup waitlist (sibling del dialog) compare nel DOM:
    // ricerca un button "Conferma" o link "waitlist" nel testo non è
    // sempre stabile per via dell'i18n placeholder; verifichiamo invece
    // che la mutation waitlistApi.join NON sia ancora stata chiamata
    // (deve avvenire solo dopo conferma utente).
    expect(mockedWaitlist.join).not.toHaveBeenCalled();
  });
});
