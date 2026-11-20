import type { EffectiveMapping } from '@/api/integrations';

/**
 * Target field canonici esposti dal backend (TARGET_FIELDS lato fieldMapping.js).
 * Mantenuti in sync manualmente: una stringa estranea qui produce solo righe
 * "non risolte" (fallback null), niente crash.
 */
export const TARGET_FIELDS = [
  'matricola',
  'externalId',
  'email',
  'firstName',
  'lastName',
  'role',
  'courseCode',
  'courseName',
  'status',
  'contractType',
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

// Target obbligatori per applicare l'import: il backend richiede matricola
// OPPURE email per matchare/creare.
export const REQUIRED_FIELDS: TargetField[] = ['matricola', 'email'];

export type MappingRowStatus = 'auto' | 'manual' | 'missing' | 'optional';

/**
 * Restituisce true se TUTTI gli header non-null in `saved` sono presenti in
 * `available`. Usato per decidere se prepopolare la UI da localStorage.
 */
export function savedMappingApplicable(
  saved: EffectiveMapping | null,
  available: string[] | undefined,
): boolean {
  if (!saved || !Array.isArray(available)) return false;
  const set = new Set(available);
  for (const v of Object.values(saved)) {
    if (v && !set.has(v)) return false;
  }
  return true;
}

/**
 * Calcola gli `mappingOverrides` da spedire al backend: per ogni target dove
 * la UI differisce da `autoDetected`, includiamo l'header scelto. I target
 * demappati (valore null/vuoto) non finiscono nel payload.
 *
 * Restituisce `undefined` se non ci sono delta.
 */
export function computeDelta(
  current: EffectiveMapping,
  auto: EffectiveMapping,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const target of TARGET_FIELDS) {
    const cur = current[target] ?? null;
    const a = auto[target] ?? null;
    if (cur !== a && cur) {
      out[target] = cur;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function emptyMapping(): EffectiveMapping {
  const out: EffectiveMapping = {};
  for (const t of TARGET_FIELDS) out[t] = null;
  return out;
}

export function computeRowStatus({
  value,
  autoVal,
  isRequired,
}: {
  value: string | null;
  autoVal: string | null;
  isRequired: boolean;
}): MappingRowStatus {
  if (!value) {
    return isRequired ? 'missing' : 'optional';
  }
  return value === autoVal ? 'auto' : 'manual';
}
