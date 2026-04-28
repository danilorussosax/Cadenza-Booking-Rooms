import { api } from '@/lib/api';
import type { Booking, BookingType, Role } from '@/types';

export type MonteOreStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'generated';

export interface MonteOreSchedule {
  id: number;
  proposalId: number;
  roomId: number | null;
  dayOfWeek: number; // 0=dom, 1=lun, … 6=sab
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  bookingType: BookingType;
  purpose: string | null;
  notes: string | null;
  excludeDates: string[]; // ["YYYY-MM-DD"]
  generatedBookingIds: number[];
  room?: {
    id: number;
    name: string;
    floor?: string | null;
    code?: string | null;
    building?: { id: number; name: string } | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonteOreProposal {
  id: number;
  userId: number;
  academicYear: string;
  validFrom: string; // "YYYY-MM-DD"
  validTo: string; // "YYYY-MM-DD"
  totalHoursRequested: number;
  totalHoursPlanned: number;
  workingDaysCount: number | null;
  minRequiredHoursSnapshot: number | null;
  amendmentCount: number;
  notes: string | null;
  status: MonteOreStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  generatedAt: string | null;
  approverId: number | null;
  rejectionReason: string | null;
  coordinatorNotes: string | null;
  generationSummary: {
    created: number;
    skipped: number;
    errors: number;
    details?: { skipped?: unknown[]; errors?: unknown[] };
  } | null;
  schedules: MonteOreSchedule[];
  user?: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    role: Role;
    matricola: string | null;
  };
  approver?: { id: number; firstName: string; lastName: string } | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Sezione B — settings, suspensions, slot, amendments
// ============================================================

export interface MonteOreSettings {
  id: number;
  instituteId: number;
  academicYear: string;
  academicYearStart: string;
  academicYearEnd: string;
  lessonsStartDate: string;
  lessonsEndDate: string;
  submissionWindowStart: string;
  submissionWindowEnd: string;
  minRequiredHours: number;
  maxAmendmentsPerYear: number;
}

export type SuspensionKind = 'full_week' | 'partial';

export interface MonteOreSuspension {
  id: number;
  instituteId: number;
  academicYear: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  kind: SuspensionKind;
  notes: string | null;
}

export interface MonteOreSlot {
  id: number;
  proposalId: number;
  scheduleId: number;
  date: string; // "YYYY-MM-DD"
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
  isLocked: boolean;
  lockReason: string | null;
  originalActive: boolean;
  bookingId: number | null;
}

export interface CalendarWeek {
  weekStart: string;
  weekEnd: string;
  weekIndex: number;
  weekLabel: string;
  days: {
    date: string;
    dayOfWeek: number;
    isLocked: boolean;
    lockReason: string | null;
  }[];
}

export type AmendmentKind = 'toggle_off' | 'toggle_on' | 'change_time' | 'add_new_day';
export type AmendmentStatus = 'pending' | 'auto_approved' | 'approved' | 'rejected';

export interface MonteOreAmendment {
  id: number;
  proposalId: number;
  requesterId: number;
  slotId: number | null;
  kind: AmendmentKind;
  payload: Record<string, unknown>;
  status: AmendmentStatus;
  requestNotes: string | null;
  rejectionReason: string | null;
  decidedAt: string | null;
  decidedBy: number | null;
  createdAt: string;
  updatedAt: string;
  requester?: { id: number; firstName: string; lastName: string; email?: string };
  slot?: MonteOreSlot;
  proposal?: { id: number; academicYear: string; userId: number; status: MonteOreStatus };
}

export interface SchedulePayload {
  roomId?: number | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  bookingType?: BookingType;
  purpose?: string | null;
  notes?: string | null;
  excludeDates?: string[];
}

export interface GenerateResult {
  created: number;
  skipped: { date: string; scheduleId: number; reason: string }[];
  errors: { date: string; scheduleId: number; message: string }[];
  bookingIds: number[];
}

// ============================================================
// Endpoints docente
// ============================================================

export const monteOreApi = {
  getMine: (year?: string) =>
    api<{ proposal: MonteOreProposal }>('/api/monte-ore/me', {
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

  addMySchedule: (payload: SchedulePayload) =>
    api<{ schedule: MonteOreSchedule }>('/api/monte-ore/me/schedules', {
      method: 'POST',
      body: payload,
    }),

  updateMySchedule: (id: number, payload: Partial<SchedulePayload>) =>
    api<{ schedule: MonteOreSchedule }>(`/api/monte-ore/me/schedules/${id}`, {
      method: 'PATCH',
      body: payload,
    }),

  removeMySchedule: (id: number) =>
    api<{ message: string }>(`/api/monte-ore/me/schedules/${id}`, { method: 'DELETE' }),

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

  regenerateSlots: () =>
    api<{ result: { created: number; locked: number; total: number } }>(
      '/api/monte-ore/me/regenerate-slots',
      { method: 'POST', body: {} },
    ),

  getMySlots: (year?: string) =>
    api<{ slots: MonteOreSlot[] }>('/api/monte-ore/me/slots', {
      query: year ? { year } : undefined,
    }),

  toggleSlot: (id: number, notes?: string) =>
    api<{ slot?: MonteOreSlot; amendment?: MonteOreAmendment }>(
      `/api/monte-ore/me/slots/${id}/toggle`,
      { method: 'POST', body: notes ? { notes } : {} },
    ),

  getMyAmendments: (year?: string) =>
    api<{ amendments: MonteOreAmendment[] }>('/api/monte-ore/me/amendments', {
      query: year ? { year } : undefined,
    }),
};

// ============================================================
// Endpoints admin
// ============================================================

export const monteOreAdminApi = {
  list: (params: { status?: MonteOreStatus; academicYear?: string; userId?: number } = {}) =>
    api<{ proposals: MonteOreProposal[] }>('/api/admin/monte-ore', { query: { ...params } }),

  get: (id: number) => api<{ proposal: MonteOreProposal }>(`/api/admin/monte-ore/${id}`),

  addSchedule: (id: number, payload: SchedulePayload) =>
    api<{ schedule: MonteOreSchedule }>(`/api/admin/monte-ore/${id}/schedules`, {
      method: 'POST',
      body: payload,
    }),

  updateSchedule: (id: number, sid: number, payload: Partial<SchedulePayload>) =>
    api<{ schedule: MonteOreSchedule }>(`/api/admin/monte-ore/${id}/schedules/${sid}`, {
      method: 'PATCH',
      body: payload,
    }),

  removeSchedule: (id: number, sid: number) =>
    api<{ message: string }>(`/api/admin/monte-ore/${id}/schedules/${sid}`, { method: 'DELETE' }),

  approve: (id: number, notes?: string) =>
    api<{ proposal: MonteOreProposal }>(`/api/admin/monte-ore/${id}/approve`, {
      method: 'POST',
      body: notes ? { notes } : {},
    }),

  reject: (id: number, reason?: string) =>
    api<{ proposal: MonteOreProposal }>(`/api/admin/monte-ore/${id}/reject`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }),

  generate: (id: number, opts: { includePast?: boolean } = {}) =>
    api<{ result: GenerateResult; proposal: MonteOreProposal }>(
      `/api/admin/monte-ore/${id}/generate`,
      {
        method: 'POST',
        body: opts.includePast ? { includePast: true } : {},
      },
    ),

  unlock: (id: number) =>
    api<{ proposal: MonteOreProposal; cleared: { cleared: number } }>(
      `/api/admin/monte-ore/${id}/unlock`,
      {
        method: 'POST',
        body: {},
      },
    ),

  // ---- Settings (calendario didattico, finestra inserimento) ----
  getSettings: (academicYear?: string) =>
    api<{ settings: MonteOreSettings }>('/api/admin/monte-ore/settings', {
      query: academicYear ? { academicYear } : undefined,
    }),

  updateSettings: (payload: Partial<MonteOreSettings> & { academicYear?: string }) =>
    api<{ settings: MonteOreSettings }>('/api/admin/monte-ore/settings', {
      method: 'PUT',
      body: payload,
    }),

  listSettings: (academicYear?: string) =>
    api<{ settings: MonteOreSettings[] }>('/api/admin/monte-ore/settings/list', {
      query: academicYear ? { academicYear } : undefined,
    }),

  // ---- Suspensions (vacanze / festività) ----
  listSuspensions: (academicYear?: string) =>
    api<{ suspensions: MonteOreSuspension[] }>('/api/admin/monte-ore/suspensions', {
      query: academicYear ? { academicYear } : undefined,
    }),

  createSuspension: (payload: {
    academicYear?: string;
    name: string;
    dateFrom: string;
    dateTo: string;
    kind?: SuspensionKind;
    notes?: string | null;
  }) =>
    api<{ suspension: MonteOreSuspension }>('/api/admin/monte-ore/suspensions', {
      method: 'POST',
      body: payload,
    }),

  updateSuspension: (id: number, payload: Partial<MonteOreSuspension>) =>
    api<{ suspension: MonteOreSuspension }>(`/api/admin/monte-ore/suspensions/${id}`, {
      method: 'PATCH',
      body: payload,
    }),

  removeSuspension: (id: number) =>
    api<{ message: string }>(`/api/admin/monte-ore/suspensions/${id}`, { method: 'DELETE' }),

  // ---- Amendments ----
  listAmendments: (params: { status?: AmendmentStatus; proposalId?: number } = {}) =>
    api<{ amendments: MonteOreAmendment[] }>('/api/admin/monte-ore/amendments', {
      query: { ...params },
    }),

  listProposalAmendments: (id: number) =>
    api<{ amendments: MonteOreAmendment[] }>(`/api/admin/monte-ore/${id}/amendments`),

  approveAmendment: (id: number, aid: number) =>
    api<{ amendment: MonteOreAmendment }>(`/api/admin/monte-ore/${id}/amendments/${aid}/approve`, {
      method: 'POST',
      body: {},
    }),

  rejectAmendment: (id: number, aid: number, reason?: string) =>
    api<{ amendment: MonteOreAmendment }>(`/api/admin/monte-ore/${id}/amendments/${aid}/reject`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }),
};

// Re-export per chi consuma il modulo
export type { Booking };
