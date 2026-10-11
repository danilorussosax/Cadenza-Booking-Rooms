import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllProviders, makeQueryClient } from '../test-utils';
import { HttpError } from '@/lib/api';
import { fromLocalInput } from '@/lib/date';
import { useBookingSubmission } from '@/components/bookings/useBookingSubmission';
import type { Booking } from '@/types';

const mocks = vi.hoisted(() => ({
  user: { id: 1, role: 'docente' },
  create: vi.fn(),
  update: vi.fn(),
  createRecurring: vi.fn(),
  join: vi.fn(),
  rooms: vi.fn(),
  types: vi.fn(),
  users: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/api/bookings', () => ({ bookingsApi: mocks }));
vi.mock('@/api/waitlist', () => ({ waitlistApi: { join: mocks.join } }));
vi.mock('@/api/rooms', () => ({ roomsApi: { list: mocks.rooms } }));
vi.mock('@/api/bookingTypes', () => ({ bookingTypesApi: { list: mocks.types } }));
vi.mock('@/api/users', () => ({ usersApi: { list: mocks.users } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const values = {
  roomId: '7',
  startTime: '2026-11-16T10:00',
  endTime: '2026-11-16T11:00',
  type: 'lezione' as const,
  purpose: '  Prova  ',
  notes: '  Note  ',
};
const payload = {
  roomId: 7,
  startTime: fromLocalInput(values.startTime).toISOString(),
  endTime: fromLocalInput(values.endTime).toISOString(),
  type: 'lezione',
  purpose: 'Prova',
  notes: 'Note',
};

function setup(options: { open?: boolean; booking?: Booking } = {}) {
  const queryClient = makeQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  const hook = renderHook(
    () => useBookingSubmission({ open: true, ...options, onOpenChange, onCreated }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AllProviders queryClient={queryClient}>{children}</AllProviders>
      ),
    },
  );
  return { ...hook, onOpenChange, onCreated, invalidate };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.role = 'docente';
  mocks.rooms.mockResolvedValue({
    rooms: [{ id: 7, name: 'Aula 7', floor: '1', building: { name: 'Sede' } }],
  });
  mocks.types.mockResolvedValue({ types: [] });
  mocks.users.mockResolvedValue({ users: [] });
  mocks.create.mockResolvedValue({ booking: { id: 10 } });
  mocks.update.mockResolvedValue({ booking: { id: 10 } });
});

describe('useBookingSubmission', () => {
  it('non carica i cataloghi quando il dialog è chiuso', () => {
    setup({ open: false });
    expect(mocks.rooms).not.toHaveBeenCalled();
    expect(mocks.types).not.toHaveBeenCalled();
    expect(mocks.users).not.toHaveBeenCalled();
  });

  it('crea una prenotazione e aggiorna le viste senza inviare un proprietario per il docente', async () => {
    const { result, onOpenChange, onCreated, invalidate } = setup();
    act(() => result.current.setOnBehalfOfUserId(99));
    act(() => result.current.onSubmit(values));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith(payload);
    expect(mocks.users).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['bookings'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['availability'] });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('consente all’admin di riassegnare il proprietario durante la modifica', async () => {
    mocks.user.role = 'admin';
    const booking = { id: 10, userId: 2 } as Booking;
    const { result, onCreated } = setup({ booking });
    act(() => result.current.setOnBehalfOfUserId(3));
    act(() => result.current.onSubmit(values));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledWith(10, { ...payload, userId: 3 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.users).toHaveBeenCalledWith({ status: 'approved', active: true });
  });

  it('invia regola e opzioni della ricorrenza con il proprietario scelto dall’admin', async () => {
    mocks.user.role = 'admin';
    mocks.createRecurring.mockResolvedValue({ createdCount: 3, skipped: 1 });
    const { result, onCreated } = setup();
    act(() => {
      result.current.setOnBehalfOfUserId(3);
      result.current.setRecurrence({
        enabled: true,
        frequency: 'weekly',
        interval: 2,
        byWeekday: ['MO'],
        endDate: '2026-12-31',
        excludeDates: ['2026-11-30'],
        skipConflicts: true,
      });
    });
    act(() => result.current.onSubmit(values));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(mocks.createRecurring).toHaveBeenCalledWith({
      ...payload,
      onBehalfOfUserId: 3,
      recurrence: {
        frequency: 'weekly',
        interval: 2,
        byWeekday: ['MO'],
        startDate: payload.startTime.slice(0, 10),
        endDate: '2026-12-31',
        excludeDates: ['2026-11-30'],
      },
      skipConflicts: true,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('mantiene aperto il form quando il conflitto offre alternative', async () => {
    const suggestion = {
      roomId: 8,
      startTime: payload.startTime,
      endTime: payload.endTime,
      reason: 'similar_room_same_time',
    };
    mocks.create.mockRejectedValueOnce(
      new HttpError(409, {
        error: 'conflict',
        code: 'BOOKING_CONFLICT',
        suggestions: [suggestion],
      }),
    );
    const { result, onOpenChange } = setup();
    act(() => result.current.onSubmit(values));
    await waitFor(() => expect(result.current.suggestions).toEqual([suggestion]));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(result.current.conflictPayload).toBeNull();
    expect(mocks.join).not.toHaveBeenCalled();
    act(() => result.current.clearSuggestions());
    expect(result.current.suggestions).toEqual([]);
  });

  it('entra in lista d’attesa solo dopo la conferma e conserva i dati del conflitto', async () => {
    mocks.create.mockRejectedValueOnce(
      new HttpError(409, { error: 'conflict', code: 'BOOKING_CONFLICT' }),
    );
    mocks.join.mockResolvedValue({ entry: { position: 0 } });
    const { result, onOpenChange, invalidate } = setup();
    await waitFor(() => expect(result.current.roomsQuery.isSuccess).toBe(true));
    act(() => result.current.onSubmit(values));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(result.current.conflictPayload?.roomLabel).toBe('Aula 7 · Sede · 1');
    expect(mocks.join).not.toHaveBeenCalled();
    act(() => result.current.waitlistMutation.mutate());
    await waitFor(() => expect(result.current.conflictPayload).toBeNull());
    expect(mocks.join).toHaveBeenCalledWith({
      roomId: 7,
      startTime: payload.startTime,
      endTime: payload.endTime,
      type: 'lezione',
      purpose: 'Prova',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['waitlist', 'me'] });
  });

  it('mostra gli errori generici e ripulisce lo stato alla riapertura', async () => {
    mocks.create.mockRejectedValueOnce(new HttpError(500, { error: 'Errore server' }));
    const { result, onOpenChange } = setup();
    act(() => result.current.onSubmit(values));
    await waitFor(() => expect(result.current.serverError).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalled();
    act(() => {
      result.current.setRecurrence((previous) => ({ ...previous, enabled: true }));
      result.current.setOnBehalfOfUserId(9);
    });
    act(() => result.current.resetSubmission(null));
    expect(result.current.serverError).toBeNull();
    expect(result.current.onBehalfOfUserId).toBeNull();
    expect(result.current.recurrence.enabled).toBe(false);
  });
});
