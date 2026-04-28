import { api } from '@/lib/api';
import type { Booking, BookingType, BookingWaitlistEntry } from '@/types';

export interface JoinWaitlistPayload {
  roomId: number;
  startTime: string; // ISO datetime
  endTime: string; // ISO datetime
  type?: BookingType;
  purpose?: string;
}

export const waitlistApi = {
  /** Le code attive dell'utente (in coda + notificate, no claim/cancel) */
  mine: () => api<{ entries: BookingWaitlistEntry[] }>('/api/bookings/waitlist/me'),

  /** Iscrivi alla coda d'attesa (di solito chiamata dopo BOOKING_CONFLICT) */
  join: (payload: JoinWaitlistPayload) =>
    api<{ entry: BookingWaitlistEntry; message?: string }>('/api/bookings/waitlist', {
      method: 'POST',
      body: payload,
    }),

  /** Riscatta una notifica waitlist creando la booking dallo slot in coda */
  claim: (id: number) =>
    api<{ booking: Booking; message: string }>(`/api/bookings/waitlist/${id}/claim`, {
      method: 'POST',
    }),

  /** Cancella la propria iscrizione */
  cancel: (id: number) =>
    api<{ message: string }>(`/api/bookings/waitlist/${id}`, { method: 'DELETE' }),
};
