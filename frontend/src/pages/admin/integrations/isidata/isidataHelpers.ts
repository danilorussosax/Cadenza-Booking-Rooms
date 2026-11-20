import type { useTranslation } from 'react-i18next';
import { TARGET_FIELDS, savedMappingApplicable } from '@/lib/isidataMapping';
import type { EffectiveMapping, IntegrationSource, ToUpdateItem } from '@/api/integrations';

// Chiave localStorage per la persistenza opzionale dell'ultimo mapping admin.
// Salva un Record<TargetField,string|null> — al reopen, se TUTTI gli header
// referenziati sono presenti nel nuovo file, prepopoliamo. Altrimenti no.
const MAPPING_LS_KEY = 'isidata.lastMapping';

export function readSavedMapping(): EffectiveMapping | null {
  try {
    const raw = localStorage.getItem(MAPPING_LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return obj as EffectiveMapping;
  } catch {
    return null;
  }
}

export function saveMappingToLs(map: EffectiveMapping) {
  try {
    localStorage.setItem(MAPPING_LS_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled — silently ignore */
  }
}

export type Step = 'upload' | 'preview' | 'done';

/**
 * Factory di helper i18n con fallback per il riuso del componente con
 * diversi provider (isidata, esse3): prova prima la chiave specifica del
 * provider e poi ricade sulla base isidata. Definito a livello di module
 * (non hook) per essere usato anche nei componenti satellite del file
 * (CompareRunDialog, CompareRunBody, ChangedBlock).
 */
export function buildProviderTk(
  t: ReturnType<typeof useTranslation>['t'],
  source: IntegrationSource,
) {
  return (suffix: string, opts?: Record<string, unknown>): string => {
    const sentinel = '__TK_MISS__';
    if (source !== 'isidata') {
      const specific = t(`integrations.${source}.${suffix}`, {
        ...opts,
        defaultValue: sentinel,
      });
      if (specific !== sentinel) return specific;
    }
    return t(`integrations.isidata.${suffix}`, opts);
  };
}

/**
 * Prepopola il mapping effettivo con quello salvato in localStorage, ma solo
 * se tutti gli header referenziati sono presenti nel nuovo file; altrimenti
 * ritorna l'effective invariato.
 */
export function mergeSavedMapping(
  eff: EffectiveMapping,
  saved: EffectiveMapping | null,
  detectedHeaders: string[] | undefined,
): EffectiveMapping {
  if (!saved || !savedMappingApplicable(saved, detectedHeaders)) return eff;
  // Merge: per i target dove `saved` ha un valore presente nei nuovi
  // headers, lo usiamo; altrimenti fallback sull'effective.
  const merged: EffectiveMapping = { ...eff };
  for (const k of TARGET_FIELDS) {
    if (k in saved) merged[k] = saved[k];
  }
  return merged;
}

// I campi in `local`/`external` sono primitivi (string/number/boolean/null).
// `formatPrimitive` proietta a stringa solo i primitivi: se per errore
// arrivasse un oggetto annidato (mai oggi, ma robusto a evoluzioni schema)
// emette '?' invece di '[object Object]'.
export function formatPrimitive(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return v.toString();
  }
  return '?';
}

export function changedSummary(u: ToUpdateItem): string {
  const localRec = u.local as unknown as Record<string, unknown>;
  const externalRec = u.external as unknown as Record<string, unknown>;
  const items: string[] = [];
  for (const f of u.fieldsChanged) {
    items.push(`${f}: ${formatPrimitive(localRec[f])} → ${formatPrimitive(externalRec[f])}`);
  }
  if (u.linkChanged) items.push('externalId');
  return items.length > 0 ? items.join(' · ') : '—';
}

export function roleLabel(role: string, t: ReturnType<typeof useTranslation>['t']) {
  // Helper plain: usa direttamente t() perché viene chiamato anche da puri
  // render (formatPrimitive), non dipende dal provider. Il sed precedente
  // l'aveva accidentalmente convertito in tk().
  if (role === 'docente') return t('integrations.isidata.role.docente');
  if (role === 'studente') return t('integrations.isidata.role.studente');
  return role;
}
