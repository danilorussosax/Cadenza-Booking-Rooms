import type { BookingType, Role } from '@/types';

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

/** Cosa può fare ora il docente: unica fonte per il gating della UI. */
export interface MonteOreTeacherActions {
  editPattern: boolean;
  selectDates: boolean;
  submit: boolean;
  /** Spostamenti, toggle e nuovi giorni via variazione (negato se serve rivalidazione). */
  requestAmendment: boolean;
  /** Storico variazioni consultabile. */
  viewAmendments: boolean;
}

/** Cosa può fare ora l'amministratore sul piano. */
export interface MonteOreAdminActions {
  approve: boolean;
  reject: boolean;
  revertToDraft: boolean;
  unlock: boolean;
  editSchedules: boolean;
  reviewAmendments: boolean;
  revalidate: boolean;
}

export interface MonteOreWorkflowActions {
  teacher: MonteOreTeacherActions;
  admin: MonteOreAdminActions;
}

/** Risposta calcolata dal server: pronto? cosa blocca? cosa si può fare ora. */
export interface MonteOreWorkflowState {
  status: MonteOreStatus;
  ready: boolean;
  blockers: { code: string; message: string; violations?: unknown[] }[];
  actions: MonteOreWorkflowActions;
}

export interface MonteOreProposal {
  /** Presente solo nelle risposte GET /me e GET admin /:id. */
  workflow?: MonteOreWorkflowState;
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
  requestCount: number;
  revision: number;
  slots?: MonteOreSlot[];
  contractSnapshot?: MonteOreThresholdResponse | null;
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
    contractType?: string | null;
    /** Soglia personalizzata override (se valorizzata sostituisce 324h CCNL). */
    monteOreAnnualHoursOverride?: number | null;
    monteOreBypassDayConstraint?: boolean;
    monteOreOverrideReason?: string | null;
  };
  approver?: { id: number; firstName: string; lastName: string } | null;
  /**
   * Origine della proposta:
   *   - 'user' (default): inserita dal docente via UI;
   *   - 'admin_import': creata da un admin importando un file Excel pre-popolato
   *     (`POST /api/admin/monte-ore/import`). Sblocca badge "importata" + il
   *     blocco "Origine" nel dettaglio.
   */
  source?: 'user' | 'admin_import';
  /** ISO timestamp dell'import (valorizzato solo per `source='admin_import'`). */
  importedAt?: string | null;
  /** Id dell'utente admin che ha eseguito l'import. */
  importedById?: number | null;
  /** Riferimento al file originario (nome file o hash) — solo log/diagnostica. */
  importSourceRef?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Import Excel monte ore (admin)
// ============================================================

/**
 * Response di `POST /api/admin/monte-ore/import`:
 * proposta creata + dati utente di destinazione + riepilogo (n. fasce, ore
 * settimanali, warning non bloccanti incontrati dal parser).
 */
export interface ImportExcelResponse {
  proposal: MonteOreProposal;
  user: { id: number; email: string; fullName: string };
  summary: {
    schedulesCreated: number;
    totalHoursPattern: number;
    warnings: string[];
  };
}

// ============================================================
// Sezione B — settings, suspensions, slot, amendments
// ============================================================

export type AcademicYearStatus = 'draft' | 'published' | 'archived';

export interface MonteOreSettings {
  status?: AcademicYearStatus;
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
  // Vincoli giornalieri configurabili (Z2/Z3 Regolamento Art. 2).
  // NULL = vincolo disabilitato. Le soglie variano tra istituti / nel tempo.
  maxHoursPerDay: number | null;
  dailyBreakAfterHours: number | null;
  dailyBreakMinutes: number | null;
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

export type AcademicYearPhase = 'past' | 'current' | 'next' | 'future';

export interface AcademicYearOption {
  status?: AcademicYearStatus;
  academicYear: string;
  label: string;
  /** Fase relativa all'AA di riferimento (avviato dall'admin, altrimenti calendario). */
  phase: AcademicYearPhase;
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
  copyRules?: boolean;
  copyCalendar?: boolean;
  copyCustom?: boolean;
  copyExamSessions?: boolean;
  settings?: Partial<MonteOreSettings>;
  publish?: boolean;
}

export interface AcademicYearPreview {
  settings: MonteOreSettings;
  suspensions: MonteOreSuspension[];
  warnings: string[];
  availableDays: number[];
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
  'toggle_off' | 'toggle_on' | 'change_time' | 'add_new_day' | 'change_room' | 'move_to';
export type AmendmentStatus = 'pending' | 'auto_approved' | 'approved' | 'rejected';

export interface AmendmentOperation {
  kind: AmendmentKind;
  slotId?: number;
  payload: {
    date?: string;
    startTime?: string;
    endTime?: string;
    roomId?: number | null;
    targetSlotId?: number;
    bookingType?: string;
    purpose?: string | null;
  };
}

export interface MonteOreAmendment {
  beforeSnapshot?: MonteOreSlot[] | null;
  afterSnapshot?: MonteOreSlot[] | null;
  operations?: AmendmentOperation[] | null;
  finalOperations?: AmendmentOperation[] | null;
  decisionNotes?: string | null;
  emailStatus?: string | null;
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
  mode?: 'minimum' | 'exact' | 'maximum';
  academicYear: string;
  minHours: number;
  bypassDayConstraint: boolean;
  contractType: 'titolare' | 'contratto_orario' | 'supplente' | 'altro' | null;
  reason: string | null;
  source: 'user_override' | 'institute_settings' | 'default';
  /**
   * Vincoli giornalieri istituzionali (Z2/Z3 Regolamento Art. 2).
   * Tutti i campi null = nessun vincolo per questo AA.
   */
  dailyConstraints: {
    maxHoursPerDay: number | null;
    dailyBreakAfterHours: number | null;
    dailyBreakMinutes: number | null;
  };
}
