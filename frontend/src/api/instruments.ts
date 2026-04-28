import { api, tokenStore } from '@/lib/api';
import type {
  Instrument,
  InstrumentCondition,
  InstrumentFamily,
  InstrumentLoan,
  LoanStatus,
} from '@/types';

export interface InstrumentLoanRule {
  family: InstrumentFamily;
  allowedCourseIds: number[];
  notes: string | null;
  configured: boolean;
}

export const loanRulesApi = {
  list: () => api<{ rules: InstrumentLoanRule[] }>('/api/admin/instrument-loan-rules'),
  upsert: (
    family: InstrumentFamily,
    payload: { allowedCourseIds: number[]; notes?: string | null },
  ) =>
    api<{ rule: InstrumentLoanRule }>(`/api/admin/instrument-loan-rules/${family}`, {
      method: 'PUT',
      body: payload,
    }),
  reset: (family: InstrumentFamily) =>
    api<{ message: string }>(`/api/admin/instrument-loan-rules/${family}`, {
      method: 'DELETE',
    }),
};

export interface UpsertInstrumentPayload {
  code?: string | null;
  name: string;
  family: InstrumentFamily;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  condition: InstrumentCondition;
  isLoanable: boolean;
  /** Codici SAD (Course.id) abilitati. Array vuoto = chiunque. */
  allowedCourseIds?: number[];
  notes?: string | null;
}

export interface InstrumentListParams {
  q?: string;
  family?: InstrumentFamily | '';
  loanable?: boolean | null;
}

export interface RequestLoanPayload {
  instrumentId: number;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  notes?: string | null;
}

export const instrumentsApi = {
  list: (params: InstrumentListParams = {}) =>
    api<{ instruments: Instrument[] }>('/api/instruments', {
      query: {
        q: params.q ?? undefined,
        family: params.family ?? undefined,
        loanable:
          params.loanable === undefined || params.loanable === null
            ? undefined
            : params.loanable
              ? 'true'
              : 'false',
      },
    }),

  get: (id: number) => api<{ instrument: Instrument }>(`/api/instruments/${id}`),

  create: (payload: UpsertInstrumentPayload) =>
    api<{ instrument: Instrument }>('/api/instruments', {
      method: 'POST',
      body: payload,
    }),

  update: (id: number, payload: Partial<UpsertInstrumentPayload>) =>
    api<{ instrument: Instrument }>(`/api/instruments/${id}`, {
      method: 'PUT',
      body: payload,
    }),

  remove: (id: number) => api<{ message: string }>(`/api/instruments/${id}`, { method: 'DELETE' }),

  bulkDelete: (ids: number[]) =>
    api<{ deleted: number; removedLoans: number }>('/api/instruments/bulk-delete', {
      method: 'POST',
      body: { ids },
    }),

  bulkToggleLoanable: (ids: number[], isLoanable: boolean) =>
    api<{ changed: number }>('/api/instruments/bulk-toggle-loanable', {
      method: 'POST',
      body: { ids, isLoanable },
    }),

  // CSV import / export
  importCsv: (csv: string) =>
    api<{
      result: {
        rowsTotal: number;
        created: number;
        updated: number;
        skipped: number;
        errors: { row: number; message: string }[];
      };
    }>('/api/instruments/import', { method: 'POST', body: { csv } }),

  exportCsvUrl: () => '/api/instruments/export',

  async downloadCsv(): Promise<Blob> {
    const token = tokenStore.get();
    if (!token) throw new Error('Sessione scaduta');
    const res = await fetch('/api/instruments/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Sessione scaduta' : `Errore ${res.status}`);
    }
    return res.blob();
  },

  uploadPhoto: (id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<{ instrument: Instrument; photoUrl: string }>(`/api/instruments/${id}/photo`, {
      method: 'POST',
      body: fd,
    });
  },
  removePhoto: (id: number) =>
    api<{ instrument: Instrument }>(`/api/instruments/${id}/photo`, {
      method: 'DELETE',
    }),
};

export interface LoanListFilters {
  status?: LoanStatus;
  userId?: number;
  instrumentId?: number;
}

export const loansApi = {
  // Utente
  mine: () => api<{ loans: InstrumentLoan[] }>('/api/loans/mine'),
  request: (payload: RequestLoanPayload) =>
    api<{ loan: InstrumentLoan }>('/api/loans', {
      method: 'POST',
      body: payload,
    }),
  cancel: (id: number) => api<{ message: string }>(`/api/loans/${id}`, { method: 'DELETE' }),
  returnLoan: (id: number) =>
    api<{ loan: InstrumentLoan }>(`/api/loans/${id}/return`, { method: 'POST' }),

  // Admin
  list: (filters: LoanListFilters = {}) =>
    api<{ loans: InstrumentLoan[] }>('/api/loans', { query: { ...filters } }),
  overdue: () => api<{ loans: InstrumentLoan[] }>('/api/loans/overdue'),
  expiring: (days = 2) =>
    api<{ loans: InstrumentLoan[] }>('/api/loans/expiring', { query: { days } }),
  approve: (id: number) =>
    api<{ loan: InstrumentLoan }>(`/api/loans/${id}/approve`, { method: 'POST' }),
  reject: (id: number) =>
    api<{ loan: InstrumentLoan }>(`/api/loans/${id}/reject`, { method: 'POST' }),

  // PDF (delivery/return) — autenticato via Bearer in fetch + blob download.
  // Restituisce il blob o lancia un Error con messaggio leggibile.
  async downloadPdf(id: number, kind: 'delivery' | 'return'): Promise<Blob> {
    const token = tokenStore.get();
    if (!token) throw new Error('Sessione scaduta');
    const res = await fetch(`/api/loans/${id}/pdf?kind=${kind}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const status = res.status;
      throw new Error(status === 401 ? 'Sessione scaduta' : `Errore ${status}`);
    }
    return res.blob();
  },
};
