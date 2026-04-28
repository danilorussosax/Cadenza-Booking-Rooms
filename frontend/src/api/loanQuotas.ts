import { api } from '@/lib/api';
import type { Role } from '@/types';

// Allineato a backend/models/InstrumentLoanQuota.js.
// Nota su scopeValue:
//   - global     → '*'
//   - family     → uno tra: archi, fiati_legni, fiati_ottoni, tastiere,
//                  percussioni, corde, voce, elettronica, altro
//   - instrument → l'id numerico dello strumento, serializzato come stringa
export type InstrumentFamily =
  | 'archi'
  | 'fiati_legni'
  | 'fiati_ottoni'
  | 'tastiere'
  | 'percussioni'
  | 'corde'
  | 'voce'
  | 'elettronica'
  | 'altro';

export type LoanQuotaScopeKind = 'family' | 'instrument' | 'global';

export interface InstrumentLoanQuota {
  id: number;
  role: Role;
  scopeKind: LoanQuotaScopeKind;
  scopeValue: string;
  maxConcurrent: number;
  maxDaysPerYear: number;
  isActive: boolean;
}

export interface UpsertLoanQuotaPayload {
  role: Role;
  scopeKind: LoanQuotaScopeKind;
  scopeValue?: string;
  maxConcurrent?: number;
  maxDaysPerYear?: number;
  isActive?: boolean;
}

const BASE = '/api/admin/instrument-loan-quotas';

export const loanQuotasApi = {
  list: (filters: { role?: Role; scopeKind?: LoanQuotaScopeKind; isActive?: boolean } = {}) =>
    api<{ quotas: InstrumentLoanQuota[] }>(BASE, { query: filters }),
  create: (payload: UpsertLoanQuotaPayload) =>
    api<{ quota: InstrumentLoanQuota }>(BASE, { method: 'POST', body: payload }),
  update: (id: number, payload: Partial<UpsertLoanQuotaPayload>) =>
    api<{ quota: InstrumentLoanQuota }>(`${BASE}/${id}`, { method: 'PUT', body: payload }),
  remove: (id: number, force = false) =>
    api<{ message: string }>(`${BASE}/${id}`, {
      method: 'DELETE',
      query: force ? { force: 'true' } : undefined,
    }),
};

// Etichette UI delle famiglie (lo stesso elenco è in altre parti dell'app
// in versioni leggermente diverse: qui le centralizzo per la pagina Quote
// prestiti, evitando dipendenze trasversali con InstrumentFormDialog).
export const INSTRUMENT_FAMILY_OPTIONS: { value: InstrumentFamily; label: string }[] = [
  { value: 'archi', label: 'Archi' },
  { value: 'fiati_legni', label: 'Fiati (legni)' },
  { value: 'fiati_ottoni', label: 'Fiati (ottoni)' },
  { value: 'tastiere', label: 'Tastiere' },
  { value: 'percussioni', label: 'Percussioni' },
  { value: 'corde', label: 'Corde (pizzicate)' },
  { value: 'voce', label: 'Voce' },
  { value: 'elettronica', label: 'Elettronica' },
  { value: 'altro', label: 'Altro' },
];
