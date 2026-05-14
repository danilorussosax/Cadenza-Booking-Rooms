import { api } from '@/lib/api';
import type { Role } from '@/types';

// Forma canonica restituita dal parser+mapping backend (services/integrations/
// isidata/fieldMapping.js → applyMapping). Mantenuta in sync con il modulo.
export interface ExternalUser {
  externalId: string | null;
  email: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  matricola: string | null;
  courseCode: string | null;
  courseName: string | null;
  status: 'active' | 'inactive';
  raw?: Record<string, string>;
  // Tipologia contrattuale (solo per docenti, quando la qualifica nel file
  // matcha una keyword nota). Vedi `coerceContractType` lato backend.
  contractType?: 'titolare' | 'contratto_orario' | 'supplente' | null;
  // ID Course risolto dal lookup courseCode → Course.code (popolato dal
  // diff engine quando courseCode è in catalogo).
  courseId?: number | null;
}

export interface DiffSummary {
  fetched: number;
  warnings: { row?: number; msg: string }[];
  toCreate: number;
  toUpdate: number;
  toOrphan: number;
}

export interface ToUpdateItem {
  local: {
    id: number;
    email: string | null;
    firstName: string;
    lastName: string;
    role: Role;
    matricola: string | null;
    externalSource: string | null;
    externalId: string | null;
    isActive: boolean;
    status: string;
  };
  external: ExternalUser;
  fieldsChanged: string[];
  linkChanged: boolean;
}

export interface ToOrphanItem {
  id: number;
  email: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  matricola: string | null;
  isActive: boolean;
}

/**
 * Soglie sicurezza pre-apply emesse dal backend (Miglioria 1).
 * Quando `warnings[].level === 'critical'`, la UI deve chiedere una
 * conferma esplicita aggiuntiva prima di abilitare il bottone Applica.
 */
export interface SafetyChecks {
  totalActiveUsers: number;
  deactivateCount: number;
  createCount: number;
  deactivateRatio: number;
  warnings: {
    level: 'critical' | 'warning';
    // Codici noti emessi oggi: 'MASS_DEACTIVATION', 'MASS_CREATION'. Lasciamo
    // `string` per essere forward-compatibili con futuri codici aggiunti
    // backend-side (la UI si limita a mostrare code+message senza switch).
    code: string;
    message: string;
  }[];
}

/**
 * Warning soft prodotti dal diff engine (es. courseCode non in catalogo).
 * Non bloccanti: la UI li mostra in una sezione dedicata. Codice noto oggi:
 * 'UNKNOWN_COURSE_CODE'. Restiamo su `string` per evoluzione futura.
 */
export interface SoftWarning {
  code: string;
  msg: string;
  courseCode?: string;
  count?: number;
}

/**
 * Mapping "user-facing" emesso dal backend (Miglioria 1 — UI guidata).
 * Per ogni target canonico, il nome dell'header del file sorgente (o null
 * se non risolto). `TARGET_FIELDS` di backend definisce le chiavi attese.
 */
export type EffectiveMapping = Record<string, string | null>;

export interface PreviewResponse {
  token: string;
  hash: string;
  headers: string[];
  headerMap: Record<string, string>;
  /**
   * Header rilevati dal file. Equivalente a `headers` ma esposto separatamente
   * per chiarezza semantica nella UI di mapping guidato.
   */
  detectedHeaders?: string[];
  /**
   * Mapping risolto applicando gli overrides admin (è ciò che il backend
   * usa per la sessione corrente). Le chiavi sono target canonici (matricola,
   * email, ...), i valori sono header del file o null.
   */
  effectiveMapping?: EffectiveMapping;
  /**
   * Mapping risolto SENZA overrides — utile alla UI per:
   *   - bottone "Ripristina mapping automatico"
   *   - calcolare delta-vs-auto da spedire come `mappingOverrides`
   */
  autoDetected?: EffectiveMapping;
  summary: DiffSummary;
  // Marcati come opzionali per retro-compatibilità: il backend li popola
  // sempre da Cadenza 1.6+, ma una preview "vecchia" cache-ata potrebbe
  // arrivare senza. La UI fa fallback a `?? []` / `?? undefined`.
  safetyChecks?: SafetyChecks;
  softWarnings?: SoftWarning[];
  diff: {
    toCreate: ExternalUser[];
    toUpdate: ToUpdateItem[];
    toOrphan: ToOrphanItem[];
  };
}

/**
 * Response di GET /api/admin/integrations/runs/:id/compare-previous
 * (Miglioria 2 — diff "ultimi 2 run" per audit).
 */
export interface CompareRunsResponse {
  previous: RunSummary | null;
  current: RunSummary;
  hasPrevious: boolean;
  changes: RunCompareChanges | null;
}

export interface RunSummary {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  createdCount: number;
  updatedCount: number;
  deactivatedCount: number;
}

export interface RunCompareChanges {
  delta: {
    create: number;
    update: number;
    deactivate: number;
  };
  newlyCreatedMatricole: string[];
  newlyDeactivatedMatricole: string[];
  repeatUpdatesMatricole: string[];
  recoveredMatricole: string[];
}

export interface ApplyResponse {
  runId: number;
  status: 'success' | 'partial' | 'failed';
  summary: {
    fetched: number;
    created: number;
    updated: number;
    orphaned: number;
    errors: number;
    warnings: { row?: number; msg: string }[];
  };
}

export interface SyncRun {
  id: number;
  configId: number | null;
  instituteId: number | null;
  provider: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string;
  status: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  orphaned: number;
  errors: number;
  errorPayload: unknown;
  diffSnapshot: unknown;
  createdAt: string;
  actor?: { id: number; firstName: string; lastName: string; email: string } | null;
}

export const integrationsApi = {
  /** Carica un file XLSX/CSV di Isidata e ottiene il diff senza modificare il DB. */
  preview: (file: File, mappingOverrides?: Record<string, string>) => {
    const fd = new FormData();
    fd.append('file', file);
    if (mappingOverrides) fd.append('mappingOverrides', JSON.stringify(mappingOverrides));
    return api<PreviewResponse>('/api/admin/integrations/isidata-csv/preview', {
      method: 'POST',
      body: fd,
    });
  },

  /** Conferma e applica il diff. Usa il token+hash ottenuti dalla preview. */
  apply: (payload: {
    token: string;
    confirmedDiffHash: string;
    mappingOverrides?: Record<string, string>;
    /**
     * Se la preview ha emesso `safetyChecks.warnings` di livello `critical`,
     * il backend rifiuta l'apply con 409 `CRITICAL_WARNINGS_PRESENT` finché
     * il client non manda esplicitamente `confirmCriticalWarnings: true`.
     */
    confirmCriticalWarnings?: boolean;
  }) =>
    api<ApplyResponse>('/api/admin/integrations/isidata-csv/apply', {
      method: 'POST',
      body: payload,
    }),

  /** Storia degli ultimi run (default: tutti i provider). */
  runs: (params: { provider?: string; limit?: number } = {}) =>
    api<{ runs: SyncRun[] }>('/api/admin/integrations/runs', { query: { ...params } }),

  /**
   * Confronta il run `:id` con il precedente "success" dello stesso provider
   * (Miglioria 2). Restituisce `hasPrevious=false` se non c'è precedente.
   */
  comparePrevious: (id: number) =>
    api<CompareRunsResponse>(`/api/admin/integrations/runs/${id}/compare-previous`),
};
