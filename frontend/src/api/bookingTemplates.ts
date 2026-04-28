import { api } from '@/lib/api';
import type { Booking, BookingType } from '@/types';

export interface BookingTemplate {
  id: number;
  name: string;
  roomId: number;
  dayOfWeek: number; // 0=Sun … 6=Sat
  startMinutes: number;
  durationMinutes: number;
  type: BookingType;
  purpose: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  room: {
    id: number;
    name: string;
    code: string | null;
    floor: string | null;
    building: { id: number; name: string } | null;
  } | null;
}

export interface CreateBookingTemplatePayload {
  name: string;
  roomId: number;
  dayOfWeek: number;
  startMinutes: number;
  durationMinutes: number;
  type: BookingType;
  purpose?: string | null;
  isFavorite?: boolean;
}

export interface QuickBookResponse {
  booking: Booking;
  scheduled: { startTime: string; endTime: string };
}

export const bookingTemplatesApi = {
  list: () => api<{ templates: BookingTemplate[] }>('/api/bookings/templates'),

  create: (payload: CreateBookingTemplatePayload) =>
    api<{ template: BookingTemplate }>('/api/bookings/templates', {
      method: 'POST',
      body: payload,
    }),

  update: (id: number, payload: CreateBookingTemplatePayload) =>
    api<{ template: BookingTemplate }>(`/api/bookings/templates/${id}`, {
      method: 'PUT',
      body: payload,
    }),

  remove: (id: number) => api<{ ok: true }>(`/api/bookings/templates/${id}`, { method: 'DELETE' }),

  quickBook: (id: number) =>
    api<QuickBookResponse>(`/api/bookings/templates/${id}/quick-book`, {
      method: 'POST',
    }),
};
