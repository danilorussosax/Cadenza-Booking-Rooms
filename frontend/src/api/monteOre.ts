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
  /** Fase 6.3 — proposta da rivalidare dopo cambio contratto/ore admin. */
  requiresRevalidation?: boolean;
  revalidationReason?: string | null;
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
    /** Tipo contrattuale del docente — per UI admin: badge accanto al nome. */
    contractType?: 'titolare' | 'contratto_orario' | 'supplente' | 'altro' | null;
    /** Soglia personalizzata override (se valorizzata sostituisce 324h CCNL). */
    monteOreAnnualHoursOverride?: number | null;
    monteOreBypassDayConstraint?: boolean;
    monteOreOverrideReason?: string | null;
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
  isActiveForTeachers: boolean;
}

export type SuspensionKind = 'full_week' | 'partial';
export type SuspensionCategory = 'holiday' | 'exam_session' | 'custom';

export interface MonteOreSuspension {
  id: number;
  instituteId: number;
  academicYear: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  kind: SuspensionKind;
  category?: SuspensionCategory;
  notes: string | null;
}

// ============================================================
// Academic year selector / bootstrap (F3 — gestione AA)
// ============================================================

export interface AcademicYearOption {
  academicYear: string;
  label: string;
  isCurrent: boolean;
  isNext: boolean;
  submissionOpen: boolean;
  hasSettings: boolean;
  /** Solo admin, presente per AA "futuri" non ancora bootstrappati. */
  canCreateNew?: boolean;
  /** L'admin ha marcato esplicitamente questo AA come attivo per i docenti. */
  adminActivated?: boolean;
  /** Solo admin: id della riga MonteOreSettings. */
  settingsId?: number;
}

export interface AcademicYearListResponse {
  items: AcademicYearOption[];
  /** AA suggerito come default (admin: current; docente: target). */
  default: string;
}

export type AcademicYearBootstrapMode = 'default' | 'from_previous';

export interface BootstrapAcademicYearPayload {
  academicYear: string;
  mode?: AcademicYearBootstrapMode;
  previousYear?: string | null;
  overwrite?: boolean;
}

export interface BootstrapResponse {
  settings: MonteOreSettings;
  suspensionsCreated: number;
  suspensionsSkipped: number;
}

export interface ExamSessionPayload {
  academicYear: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  notes?: string | null;
}

export interface MonteOreSlot {
  id: number;
  proposalId: number;
  // Slot dentro pattern settimanale: scheduleId valorizzato. Slot fuori
  // pattern (creati da amendment add_new_day approvato): scheduleId=null.
  scheduleId: number | null;
  date: string; // "YYYY-MM-DD"
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
  isLocked: boolean;
  lockReason: string | null;
  originalActive: boolean;
  bookingId: number | null;
  // Valorizzati solo per slot fuori-pattern (scheduleId=null)
  roomId: number | null;
  bookingType: string | null;
  purpose: string | null;
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

export type AmendmentKind =
  | 'toggle_off'
  | 'toggle_on'
  | 'change_time'
  | 'add_new_day'
  | 'change_room'
  | 'move_to';
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

export interface MonteOreThresholdResponse {
  academicYear: string;
  minHours: number;
  bypassDayConstraint: boolean;
  contractType: 'titolare' | 'contratto_orario' | 'supplente' | 'altro' | null;
  reason: string | null;
  source: 'user_override' | 'institute_settings' | 'default';
}

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

  // Richiesta di un nuovo giorno fuori dal pattern settimanale approvato.
  // Crea sempre un amendment pending (richiede approvazione del coordinatore).
  // Se roomId è omesso, il coordinatore assegnerà l'aula in fase di approve.
  requestNewDay: (payload: {
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

  /** Fase 6.4 — riporta una proposta submitted/approved in draft per chiedere
   *  modifiche al docente. Per 'generated' chiamare prima `unlock`. */
  revertToDraft: (id: number, reason?: string) =>
    api<{ proposal: MonteOreProposal }>(`/api/admin/monte-ore/${id}/revert-to-draft`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }),

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
    applyToAllBookings?: boolean;
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

  pendingAmendmentsCount: () =>
    api<{ count: number }>('/api/admin/monte-ore/amendments/pending/count'),

  listProposalAmendments: (id: number) =>
    api<{ amendments: MonteOreAmendment[] }>(`/api/admin/monte-ore/${id}/amendments`),

  // Per amendments `add_new_day` l'admin può fornire/sovrascrivere l'aula
  // in fase di approvazione; per gli altri kind l'argomento è ignorato.
  approveAmendment: (id: number, aid: number, opts: { roomId?: number } = {}) =>
    api<{ amendment: MonteOreAmendment }>(`/api/admin/monte-ore/${id}/amendments/${aid}/approve`, {
      method: 'POST',
      body: opts,
    }),

  rejectAmendment: (id: number, aid: number, reason?: string) =>
    api<{ amendment: MonteOreAmendment }>(`/api/admin/monte-ore/${id}/amendments/${aid}/reject`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }),

  // ---- Bootstrap AA + sessioni d'esame (F3 — gestione AA) ----

  /**
   * Crea (o sovrascrive) un AA: settings con range deterministico 1 nov → 31
   * ott, finestra inserimento default e suspensions (festività + opzionali
   * personalizzate clonate dall'AA precedente con +1 anno).
   */
  createAcademicYear: (payload: BootstrapAcademicYearPayload) =>
    api<BootstrapResponse>('/api/admin/monte-ore/academic-years', {
      method: 'POST',
      body: payload,
    }),

  /**
   * Override admin: marca (o smarca) un AA come "attivo per i docenti".
   * Vince sulla finestra di submission automatica. Atomico: disattiva tutti
   * gli altri AA dello stesso istituto.
   */
  activateAcademicYearForTeachers: (academicYear: string, active = true) =>
    api<{ activated: MonteOreSettings | null; deactivated: number }>(
      `/api/admin/monte-ore/academic-years/${encodeURIComponent(academicYear)}/activate-for-teachers`,
      {
        method: 'POST',
        body: { active },
      },
    ),

  listExamSessions: (academicYear: string) =>
    api<{ examSessions: MonteOreSuspension[] }>('/api/admin/monte-ore/exam-sessions', {
      query: { academicYear },
    }),

  createExamSession: (payload: ExamSessionPayload) =>
    api<{ examSession: MonteOreSuspension }>('/api/admin/monte-ore/exam-sessions', {
      method: 'POST',
      body: payload,
    }),

  updateExamSession: (id: number, patch: Partial<Omit<ExamSessionPayload, 'academicYear'>>) =>
    api<{ examSession: MonteOreSuspension }>(`/api/admin/monte-ore/exam-sessions/${id}`, {
      method: 'PATCH',
      body: patch,
    }),

  deleteExamSession: (id: number) =>
    api<{ message: string }>(`/api/admin/monte-ore/exam-sessions/${id}`, {
      method: 'DELETE',
    }),

  /**
   * URL di download del template Excel pre-popolato per l'AA selezionato.
   * Pensato per <a href download> — il browser gestisce direttamente il flusso.
   *
   * NOTA: l'endpoint richiede auth Bearer; per usarlo con <a download> serve
   * che il token sia veicolato via cookie o intercettato. In alternativa,
   * scaricare con fetch+blob (helper a parte).
   */
  getImportTemplateUrl: (academicYear: string) =>
    `/api/admin/monte-ore/import-template.xlsx?academicYear=${encodeURIComponent(academicYear)}`,

  /**
   * Scarica il template Excel via fetch (gestisce il Bearer token) e
   * triggera il download via blob: necessario perché <a href> diretto non
   * propaga l'header Authorization.
   */
  downloadImportTemplate: async (academicYear: string): Promise<void> => {
    const token = (await import('@/lib/api')).tokenStore.get();
    const url = `/api/admin/monte-ore/import-template.xlsx?academicYear=${encodeURIComponent(academicYear)}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Download fallito (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `monte-ore-template-${academicYear.replace('/', '-')}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  },
};

// Re-export per chi consuma il modulo
export type { Booking };

/**
 * Etichetta sintetica "data + orario" di un amendment, leggendo lo slot
 * collegato o, per gli `add_new_day` ancora pending (slot non ancora creato),
 * il payload della richiesta.
 */
export function amendmentSummary(a: MonteOreAmendment): string {
  const base = a.slot ? `${a.slot.date} ${a.slot.startTime}–${a.slot.endTime}` : '';
  if (a.kind === 'change_time') {
    const p = a.payload as { startTime?: string; endTime?: string };
    if (p.startTime || p.endTime) {
      return `${base} → ${p.startTime ?? a.slot?.startTime}–${p.endTime ?? a.slot?.endTime}`;
    }
  }
  if (a.kind === 'change_room') {
    const p = a.payload as { roomId?: number };
    return `${base} → aula #${p.roomId ?? '?'}`;
  }
  if (a.kind === 'move_to') {
    const p = a.payload as { sourceDate?: string; targetDate?: string };
    if (p.sourceDate && p.targetDate) return `${p.sourceDate} → ${p.targetDate}`;
  }
  if (a.kind === 'add_new_day') {
    const p = a.payload as { date?: string; startTime?: string; endTime?: string };
    if (p.date && p.startTime && p.endTime) return `${p.date} ${p.startTime}–${p.endTime}`;
  }
  return base || '—';
}
