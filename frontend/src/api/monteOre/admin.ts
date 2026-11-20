import { api, apiBlob, HttpError, tokenStore } from '@/lib/api';
import { saveBlob } from '@/lib/download';

import type {
  AcademicYearPreview,
  AmendmentOperation,
  AmendmentStatus,
  BootstrapAcademicYearPayload,
  BootstrapResponse,
  ExamSessionPayload,
  GenerateResult,
  ImportExcelResponse,
  MonteOreAmendment,
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSettings,
  MonteOreSlot,
  MonteOreStatus,
  MonteOreSuspension,
  SchedulePayload,
  SuspensionKind,
} from './types';

/**
 * `JSON.parse` con fallback al testo grezzo (allineato all'helper interno di
 * `lib/api.ts`). Usato per parsare le response di endpoint che bypassano
 * `api()` (es. upload multipart).
 */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function calendarRequest<T>(
  url: string,
  method: 'PUT' | 'POST' | 'PATCH',
  body: object,
): Promise<T> {
  try {
    return await api<T>(url, { method, body });
  } catch (error) {
    if (
      error instanceof HttpError &&
      error.payload.code === 'CALENDAR_IMPACT_CONFIRMATION' &&
      window.confirm(error.message)
    ) {
      return api<T>(url, { method, body: { ...body, confirmImpact: true } });
    }
    throw error;
  }
}

export const monteOreAdminApi = {
  list: (params: { status?: MonteOreStatus; academicYear?: string; userId?: number } = {}) =>
    api<{ proposals: MonteOreProposal[] }>('/api/admin/monte-ore', { query: { ...params } }),

  revalidate: (id: number, body: { operations: AmendmentOperation[]; reason: string }) =>
    api<{ amendment: MonteOreAmendment }>(`/api/admin/monte-ore/${id}/revalidate`, {
      method: 'POST',
      body,
    }),

  checkApproval: (id: number, assignments: { slotId: number; roomId: number }[]) =>
    api<{
      totalHours: number;
      activeCount: number;
      issues: { date?: string; message: string; code: string }[];
      slots: MonteOreSlot[];
    }>(`/api/admin/monte-ore/${id}/preview`, { method: 'POST', body: { assignments } }),

  preview: (id: number) =>
    api<{
      totalHours: number;
      activeCount: number;
      issues: { date?: string; message: string; code: string }[];
      slots: MonteOreSlot[];
    }>(`/api/admin/monte-ore/${id}/preview`),

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

  approve: (id: number, notes?: string, assignments?: { slotId: number; roomId: number }[]) =>
    api<{ proposal: MonteOreProposal }>(`/api/admin/monte-ore/${id}/approve`, {
      method: 'POST',
      body: { notes, assignments },
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
    api<{ settings: MonteOreSettings | null }>('/api/admin/monte-ore/settings', {
      query: academicYear ? { academicYear } : undefined,
    }),

  updateSettings: (payload: Partial<MonteOreSettings> & { academicYear?: string }) =>
    calendarRequest<{ settings: MonteOreSettings }>(
      '/api/admin/monte-ore/settings',
      'PUT',
      payload,
    ),

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
    calendarRequest<{ suspension: MonteOreSuspension }>(
      '/api/admin/monte-ore/suspensions',
      'POST',
      payload,
    ),

  updateSuspension: (id: number, payload: Partial<MonteOreSuspension>) =>
    calendarRequest<{ suspension: MonteOreSuspension }>(
      `/api/admin/monte-ore/suspensions/${id}`,
      'PATCH',
      payload,
    ),

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
  approveAmendment: (
    id: number,
    aid: number,
    opts: { roomId?: number; operations?: AmendmentOperation[]; reason?: string } = {},
  ) =>
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
  previewAcademicYear: (payload: BootstrapAcademicYearPayload) =>
    api<AcademicYearPreview>('/api/admin/monte-ore/academic-years/preview', {
      method: 'POST',
      body: payload,
    }),

  setAcademicYearStatus: (year: string, status: 'published' | 'archived') =>
    api<{ settings: MonteOreSettings }>(
      `/api/admin/monte-ore/academic-years/${encodeURIComponent(year)}/status`,
      { method: 'POST', body: { status } },
    ),

  createAcademicYear: (payload: BootstrapAcademicYearPayload) =>
    calendarRequest<BootstrapResponse>('/api/admin/monte-ore/academic-years', 'POST', payload),

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
    calendarRequest<{ examSession: MonteOreSuspension }>(
      '/api/admin/monte-ore/exam-sessions',
      'POST',
      payload,
    ),

  updateExamSession: (id: number, patch: Partial<Omit<ExamSessionPayload, 'academicYear'>>) =>
    calendarRequest<{ examSession: MonteOreSuspension }>(
      `/api/admin/monte-ore/exam-sessions/${id}`,
      'PATCH',
      patch,
    ),

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
   * Importa un file Excel monte ore precompilato (formato del template
   * scaricabile via `downloadImportTemplate`). Il backend deduce il docente
   * destinatario dall'email indicata nel foglio e crea/sovrascrive la
   * proposta dell'AA letto dal file.
   *
   * Flag:
   *   - `overwrite=false` impedisce di toccare una proposta esistente in
   *     draft/submitted/rejected (default true);
   *   - `force=true` (querystring) permette di sovrascrivere anche proposte
   *     in stati "protetti" (approved/generated) — usare con cautela.
   *
   * NB: bypassa l'helper `api()` perché serve `multipart/form-data` con
   * boundary auto-generato dal browser (impossibile via `Content-Type` manuale)
   * e mantiene il token gestito da `tokenStore`.
   */
  importExcel: async (
    file: File,
    opts: { overwrite?: boolean; force?: boolean } = {},
  ): Promise<ImportExcelResponse> => {
    const fd = new FormData();
    fd.append('file', file);
    // Backend default = true; mandiamo il flag solo per disattivare overwrite.
    if (opts.overwrite === false) fd.append('overwrite', 'false');
    const token = tokenStore.get();
    const url = `/api/admin/monte-ore/import${opts.force ? '?force=true' : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data: unknown = text ? safeJsonParse(text) : null;
    if (!res.ok) {
      const payload =
        data && typeof data === 'object' ? (data as { error?: string; code?: string }) : {};
      throw new HttpError(res.status, {
        error: payload.error ?? `Errore HTTP ${res.status}`,
        code: payload.code,
      });
    }
    return data as ImportExcelResponse;
  },

  /**
   * Scarica il template Excel via fetch (gestisce il Bearer token) e
   * triggera il download via blob: necessario perché <a href> diretto non
   * propaga l'header Authorization.
   */
  downloadImportTemplate: async (academicYear: string): Promise<void> => {
    const blob = await apiBlob('/api/admin/monte-ore/import-template.xlsx', {
      query: { academicYear },
    });
    saveBlob(blob, `monte-ore-template-${academicYear.replace('/', '-')}.xlsx`);
  },
};
