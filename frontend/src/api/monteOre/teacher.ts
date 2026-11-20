import { api } from '@/lib/api';
import type { BookingType } from '@/types';

import type {
  AcademicYearListResponse,
  AmendmentOperation,
  CalendarWeek,
  MonteOreAmendment,
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSettings,
  MonteOreSlot,
  MonteOreThresholdResponse,
  SchedulePayload,
} from './types';

export const monteOreApi = {
  getMine: (year?: string) =>
    api<{ proposal: MonteOreProposal }>('/api/monte-ore/me', {
      query: year ? { year } : undefined,
    }),

  /** Risolve la soglia ore applicabile al docente corrente (override / settings). */
  getMyThreshold: (year?: string) =>
    api<MonteOreThresholdResponse>('/api/monte-ore/me/threshold', {
      query: year ? { year } : undefined,
    }),

  updateMine: (payload: {
    notes?: string | null;
    totalHoursRequested?: number;
    validFrom?: string;
    validTo?: string;
    academicYear?: string;
  }) =>
    api<{ proposal: MonteOreProposal }>('/api/monte-ore/me', {
      method: 'PUT',
      body: payload,
    }),

  addMySchedule: (payload: SchedulePayload, year?: string) =>
    api<{ schedule: MonteOreSchedule }>('/api/monte-ore/me/schedules', {
      method: 'POST',
      body: { ...payload, academicYear: year },
    }),

  updateMySchedule: (id: number, payload: Partial<SchedulePayload>, year?: string) =>
    api<{ schedule: MonteOreSchedule }>(`/api/monte-ore/me/schedules/${id}`, {
      method: 'PATCH',
      body: { ...payload, academicYear: year },
    }),

  removeMySchedule: (id: number, year?: string) =>
    api<{ message: string }>(`/api/monte-ore/me/schedules/${id}`, {
      method: 'DELETE',
      query: year ? { year } : undefined,
    }),

  submitMine: (academicYear?: string) =>
    api<{ proposal: MonteOreProposal }>('/api/monte-ore/me/submit', {
      method: 'POST',
      body: academicYear ? { academicYear } : {},
    }),

  // ---- Sezione B: calendario griglia + slot ----
  getCalendar: (year?: string) =>
    api<{ settings: MonteOreSettings; weeks: CalendarWeek[] }>('/api/monte-ore/me/calendar', {
      query: year ? { year } : undefined,
    }),

  regenerateSlots: (year?: string, confirmRemoval = false) =>
    api<{
      result: {
        created: number;
        locked: number;
        total: number;
        requiresConfirmation?: boolean;
        removedActive?: { date: string; startTime: string; endTime: string }[];
      };
    }>('/api/monte-ore/me/regenerate-slots', {
      method: 'POST',
      body: { academicYear: year, confirmRemoval },
    }),

  getMySlots: (year?: string) =>
    api<{ slots: MonteOreSlot[] }>('/api/monte-ore/me/slots', {
      query: year ? { year } : undefined,
    }),

  toggleSlot: (id: number, notes?: string) =>
    api<{ slot?: MonteOreSlot; amendment?: MonteOreAmendment }>(
      `/api/monte-ore/me/slots/${id}/toggle`,
      { method: 'POST', body: notes ? { notes } : {} },
    ),

  selectSlots: (body: {
    academicYear?: string;
    dateFrom: string;
    dateTo: string;
    dayOfWeek?: number;
    isActive: boolean;
  }) => api<{ ok: boolean }>('/api/monte-ore/me/slots/select', { method: 'POST', body }),

  requestAmendment: (body: {
    academicYear?: string;
    operations: AmendmentOperation[];
    notes: string;
    requestKey: string;
  }) =>
    api<{ amendment: MonteOreAmendment }>('/api/monte-ore/me/amendments', { method: 'POST', body }),

  getMyAmendments: (year?: string) =>
    api<{ amendments: MonteOreAmendment[] }>('/api/monte-ore/me/amendments', {
      query: year ? { year } : undefined,
    }),

  // Richiesta di un nuovo giorno fuori dal pattern settimanale approvato.
  // Crea sempre un amendment pending (richiede approvazione del coordinatore).
  // Se roomId è omesso, il coordinatore assegnerà l'aula in fase di approve.
  requestNewDay: (payload: {
    year?: string;
    date: string;
    startTime: string;
    endTime: string;
    roomId?: number;
    bookingType?: BookingType;
    purpose?: string | null;
    notes?: string | null;
  }) =>
    api<{ amendment: MonteOreAmendment }>('/api/monte-ore/me/amendments/add-new-day', {
      method: 'POST',
      body: payload,
    }),

  /** Cambia l'orario di una singola occorrenza ricorrente (auto se slot
   *  originalActive, pending altrimenti). */
  changeSlotTime: (
    slotId: number,
    body: { startTime?: string; endTime?: string; notes?: string },
  ) =>
    api<{ amendment: MonteOreAmendment }>(`/api/monte-ore/me/slots/${slotId}/change-time`, {
      method: 'POST',
      body,
    }),

  /** Cambia l'aula di una singola occorrenza (override puntuale, lascia pattern
   *  intatto). Sempre pending: richiede approvazione del coordinatore. */
  changeSlotRoom: (slotId: number, body: { roomId: number; notes?: string }) =>
    api<{ amendment: MonteOreAmendment }>(`/api/monte-ore/me/slots/${slotId}/change-room`, {
      method: 'POST',
      body,
    }),

  /** Sposta una lezione attiva su una cella diversa (toggle off+on atomico,
   *  1 sola variazione di budget). Auto se entrambi sono in pattern. */
  moveSlotTo: (sourceSlotId: number, body: { targetSlotId: number; notes?: string }) =>
    api<{ amendment: MonteOreAmendment }>(`/api/monte-ore/me/slots/${sourceSlotId}/move-to`, {
      method: 'POST',
      body,
    }),

  /**
   * Lista degli AA disponibili. Per `scope='admin'` ritorna tutti gli AA con
   * settings + flag `canCreateNew` sugli AA futuri non ancora creati.
   * Per docente (senza scope) ritorna solo l'AA target.
   */
  listAcademicYears: (scope?: 'admin') =>
    api<AcademicYearListResponse>('/api/monte-ore/academic-years', {
      query: scope ? { scope } : undefined,
    }),

  /** Alias docente: ritorna unicamente l'AA target del docente corrente. */
  getAcademicYearForTeacher: () => api<AcademicYearListResponse>('/api/monte-ore/academic-years'),
};
