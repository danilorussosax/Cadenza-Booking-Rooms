import { api } from '@/lib/api';
import type {
  BookingRule,
  BookingRuleException,
  BookingRuleExceptionKind,
  BookingRuleExceptionScope,
  Role,
} from '@/types';

export interface UpsertRulePayload {
  maxActiveBookings?: number;
  maxHoursPerWeek?: number;
  maxHoursPerDay?: number;
  maxBookingDurationMinutes?: number;
  minBookingDurationMinutes?: number;
  maxAdvanceDays?: number;
  minAdvanceHours?: number;
  cancellationDeadlineHours?: number;
  minIntervalBetweenBookingsMinutes?: number;
  allowRecurring?: boolean;
  allowNightHours?: boolean;
  allowedStartTime?: string;
  allowedEndTime?: string;
}

export interface OverlapBooking {
  id: number;
  startTime: string;
  endTime: string;
  purpose: string | null;
  type: string | null;
  checkedIn: boolean;
  fromMonteOre: boolean;
  user: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  } | null;
  room: {
    id: number;
    name: string;
    building: { id: number; name: string } | null;
  } | null;
}

export interface UpsertExceptionPayload {
  role: BookingRuleExceptionScope;
  name: string;
  kind: BookingRuleExceptionKind;
  daysOfWeek?: number[] | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  maxHoursInWindow?: number | null;
  isActive?: boolean;
  notes?: string | null;
  /** Scope per aula: null/omesso = globale (tutte le aule). */
  roomId?: number | null;
}

export interface ListExceptionsOptions {
  role?: BookingRuleExceptionScope;
  /** Filtra la lista: ritorna eccezioni globali (roomId=null) + quelle
   *  scoped a questa aula. Non restringe lo scope salvato lato server. */
  roomId?: number;
}

export const rulesApi = {
  list: () => api<{ rules: BookingRule[] }>('/api/rules'),
  get: (role: Role) => api<{ rule: BookingRule }>(`/api/rules/${role}`),
  upsert: (role: Role, payload: UpsertRulePayload) =>
    api<{ rule: BookingRule }>(`/api/rules/${role}`, { method: 'PUT', body: payload }),

  // Eccezioni — quando role è omesso e l'utente è admin, ritorna TUTTE
  // le eccezioni (tutti i ruoli inclusi 'all'). Vedi backend routes/rules.js.
  listExceptions: (opts?: ListExceptionsOptions | BookingRuleExceptionScope) => {
    // Backward-compat: la firma legacy accetta direttamente lo scope role.
    const o: ListExceptionsOptions = typeof opts === 'string' ? { role: opts } : (opts ?? {});
    const query: Record<string, unknown> = {};
    if (o.role) query.role = o.role;
    if (o.roomId) query.roomId = o.roomId;
    return api<{ exceptions: BookingRuleException[] }>('/api/rules/exceptions', {
      query: Object.keys(query).length > 0 ? query : undefined,
    });
  },
  createException: (payload: UpsertExceptionPayload) =>
    api<{ exception: BookingRuleException }>('/api/rules/exceptions', {
      method: 'POST',
      body: payload,
    }),
  updateException: (id: number, payload: UpsertExceptionPayload) =>
    api<{ exception: BookingRuleException }>(`/api/rules/exceptions/${id}`, {
      method: 'PUT',
      body: payload,
    }),
  deleteException: (id: number) =>
    api<{ message: string }>(`/api/rules/exceptions/${id}`, { method: 'DELETE' }),

  // Sovrapposizioni storiche (kind='block') — anteprima e cancel batch.
  previewOverlaps: (payload: UpsertExceptionPayload) =>
    api<{ overlapping: OverlapBooking[] }>('/api/rules/exceptions/preview-overlaps', {
      method: 'POST',
      body: payload,
    }),
  cancelOverlapping: (id: number, reason?: string) =>
    api<{ cancelled: number; ids: number[]; monteOreSlotsSynced: number }>(
      `/api/rules/exceptions/${id}/cancel-overlapping`,
      { method: 'POST', body: { reason } },
    ),

  // Preview validatore (admin only). Restituisce il risultato del
  // validateBooking come se la prenotazione fosse fatta da un fake user
  // del ruolo richiesto. Le quote/limiti individuali NON sono valutate
  // (vedi backend/routes/rulesPreview.js).
  preview: (payload: {
    role: Role;
    courseId?: number | null;
    roomId: number;
    startTime: string;
    endTime: string;
  }) =>
    api<{ valid: boolean; errors: string[]; codes: (string | null)[] }>(
      '/api/admin/rules/preview',
      { method: 'POST', body: payload },
    ),
};
