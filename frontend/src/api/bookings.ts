import { api } from '@/lib/api';
import type {
  Booking,
  BookingStatus,
  BookingType,
  BookingUsage,
  ConcertInfo,
  ConcertEventType,
} from '@/types';

export interface BookingsListParams {
  from?: string;
  to?: string;
  roomId?: number;
  userId?: number;
  mine?: boolean;
  status?: BookingStatus;
  /** Pagination opt-in (P1-2). Default backend: 100, max 500. */
  limit?: number;
  offset?: number;
}

export interface CreateBookingPayload {
  roomId: number;
  startTime: string;
  endTime: string;
  purpose?: string;
  type?: BookingType;
  notes?: string;
  /** Solo admin: id utente per cui prenotare. Ignorato se uguale al
   *  caller o se il caller non è admin. */
  onBehalfOfUserId?: number;
}

export interface UpdateBookingPayload {
  startTime?: string;
  endTime?: string;
  roomId?: number;
  purpose?: string;
  type?: BookingType;
  notes?: string;
  /** Solo admin: riassegna la prenotazione ad un altro utente approvato. */
  userId?: number;
}

export const bookingsApi = {
  list: (params: BookingsListParams = {}) =>
    api<{ bookings: Booking[] }>('/api/bookings', { query: { ...params } }),

  get: (id: number) => api<{ booking: Booking }>(`/api/bookings/${id}`),

  create: (payload: CreateBookingPayload) =>
    api<{ booking: Booking }>('/api/bookings', { method: 'POST', body: payload }),

  update: (id: number, payload: UpdateBookingPayload) =>
    api<{ booking: Booking }>(`/api/bookings/${id}`, { method: 'PUT', body: payload }),

  cancel: (id: number, reason?: string) =>
    api<{ message: string; booking: Booking }>(`/api/bookings/${id}`, {
      method: 'DELETE',
      body: reason ? { reason } : undefined,
    }),

  /**
   * Crea una serie ricorrente. Il backend accetta sia il formato legacy
   * `{ recurrence: { weeks: N } }` (compat) sia il nuovo formato MRBS-style
   * `{ recurrence: { frequency, interval, byWeekday, startDate, endDate, excludeDates } }`.
   * Response 201: { recurrenceId, createdCount, requestedCount, skipped, conflicts, status }.
   * Response 409 (conflicts senza skipConflicts): payload { error, code:'RECURRENCE_CONFLICTS', conflicts, validCount }.
   */
  createRecurring: (
    payload: CreateBookingPayload & {
      recurrence:
        | { weeks: number }
        | {
            frequency: 'daily' | 'weekly';
            interval?: number;
            byWeekday?: string[] | null;
            startDate: string;
            endDate: string;
            excludeDates?: string[];
          };
      skipConflicts?: boolean;
    },
  ) =>
    api<{
      recurrenceId: number;
      createdCount: number;
      requestedCount: number;
      skipped: number;
      conflicts: { startTime: string; endTime: string; error: string; code: string }[];
      status: string;
    }>('/api/bookings/recurring', { method: 'POST', body: payload }),

  deleteRecurrence: (id: number) =>
    api<{ ok: boolean; cancelledCount: number }>(`/api/bookings/recurrences/${id}`, {
      method: 'DELETE',
    }),

  availability: (roomId: number, date: string) =>
    api<{ date: string; bookings: Booking[] }>(`/api/bookings/availability/${roomId}`, {
      query: { date },
    }),

  myUsage: () => api<BookingUsage>('/api/bookings/usage/me'),

  // Check-in / anti ghost-booking
  checkinCandidates: (roomId: number) =>
    api<{
      bookings: Booking[];
      /** true se l'aula ha `requireCheckIn=false`: l'API non restituisce candidati. */
      roomCheckInDisabled?: boolean;
      config: { earlyMinutes: number; graceMinutes: number };
    }>('/api/bookings/checkin-candidates', { query: { roomId } }),

  checkin: (id: number, qrToken?: string | null) =>
    api<{ booking: Booking; message: string }>(`/api/bookings/${id}/checkin`, {
      method: 'POST',
      body: qrToken ? { qrToken } : undefined,
    }),

  // Scheda concerto (solo booking type='concerto', owner o admin)
  getConcert: (bookingId: number) =>
    api<{ concertInfo: ConcertInfo }>(`/api/bookings/${bookingId}/concert`),
  saveConcert: (
    bookingId: number,
    payload: {
      title: string;
      performers?: string;
      program?: string;
      eventType?: ConcertEventType;
      description?: string | null;
      language?: string | null;
    },
  ) =>
    api<{ concertInfo: ConcertInfo }>(`/api/bookings/${bookingId}/concert`, {
      method: 'PUT',
      body: payload,
    }),
  deleteConcert: (bookingId: number) =>
    api<{ message: string }>(`/api/bookings/${bookingId}/concert`, { method: 'DELETE' }),
  uploadConcertPoster: (bookingId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<{ concertInfo: ConcertInfo; posterUrl: string }>(
      `/api/bookings/${bookingId}/concert/poster`,
      { method: 'POST', body: fd },
    );
  },
  deleteConcertPoster: (bookingId: number) =>
    api<{ concertInfo: ConcertInfo }>(`/api/bookings/${bookingId}/concert/poster`, {
      method: 'DELETE',
    }),

  // Workflow approvazione (admin)
  pending: () => api<{ bookings: Booking[] }>('/api/bookings/pending'),
  pendingCount: () => api<{ count: number }>('/api/bookings/pending/count'),
  approve: (id: number) =>
    api<{ booking: Booking }>(`/api/bookings/${id}/approve`, { method: 'POST' }),
  reject: (id: number, reason?: string) =>
    api<{ booking: Booking }>(`/api/bookings/${id}/reject`, {
      method: 'POST',
      body: reason ? { reason } : undefined,
    }),

  // Pending approvazione dell'utente loggato (per la card Dashboard)
  minePending: () => api<{ bookings: Booking[] }>('/api/bookings/mine/pending'),

  // Bulk cancel admin: broadcast cancellation con motivo a tutti gli utenti
  // selezionati. Skippa gli ID già non-confirmed.
  bulkCancel: (ids: number[], reason?: string) =>
    api<{ cancelled: number; skipped: number }>('/api/bookings/bulk-cancel', {
      method: 'POST',
      body: { ids, reason },
    }),

  // Swap atomico admin: scambia room+orario tra due prenotazioni future
  // confermate non checked-in. Usato per risolvere conflitti rapidamente.
  swap: (aId: number, bId: number) =>
    api<{ a: Booking; b: Booking }>('/api/bookings/swap', {
      method: 'POST',
      body: { aId, bId },
    }),
};
