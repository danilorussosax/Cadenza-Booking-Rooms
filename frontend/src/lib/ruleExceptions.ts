import type { UpsertExceptionPayload } from '@/api/rules';
import type {
  BookingRuleException,
  BookingRuleExceptionKind,
  BookingRuleExceptionScope,
  Role,
} from '@/types';

/** Etichette giorni indicizzate come `Date#getDay()` (0 = domenica). */
export const DAYS_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

export function roleLabel(r: Role): string {
  return r === 'admin' ? 'Admin' : r === 'docente' ? 'Docenti' : 'Studenti';
}

/** Riassunto testuale di una eccezione (aula · date · giorni · fascia oraria). */
export function exceptionSummary(exc: BookingRuleException): string {
  const parts: string[] = [];
  if (exc.roomId != null) {
    parts.push(`Solo aula: ${exc.room?.name ?? `#${exc.roomId}`}`);
  }
  if (exc.dateFrom && exc.dateTo) {
    parts.push(
      exc.dateFrom === exc.dateTo ? `Il ${exc.dateFrom}` : `Dal ${exc.dateFrom} al ${exc.dateTo}`,
    );
  } else if (exc.dateFrom) {
    parts.push(`Dal ${exc.dateFrom}`);
  } else if (exc.dateTo) {
    parts.push(`Fino al ${exc.dateTo}`);
  }
  if (exc.daysOfWeek && exc.daysOfWeek.length > 0) {
    parts.push(exc.daysOfWeek.map((d) => DAYS_LABELS[d]).join(', '));
  }
  if (exc.startTime || exc.endTime) {
    parts.push(`${exc.startTime ?? '00:00'}–${exc.endTime ?? '23:59'}`);
  }
  if (parts.length === 0) parts.push('Sempre attiva');
  return parts.join(' · ');
}

export interface ExceptionFormState {
  role: BookingRuleExceptionScope;
  /** 'all' (tutte le aule) oppure id stringa dell'aula scoped */
  roomScope: string;
  name: string;
  kind: BookingRuleExceptionKind;
  daysOfWeek: number[];
  dateFrom: string;
  dateTo: string;
  singleDate: boolean;
  startTime: string;
  endTime: string;
  maxHoursInWindow: string;
  isActive: boolean;
  notes: string;
}

export function blankException(
  defaultRole: BookingRuleExceptionScope,
  defaultRoomId?: number,
): ExceptionFormState {
  return {
    role: defaultRole,
    roomScope: defaultRoomId ? String(defaultRoomId) : 'all',
    name: '',
    kind: 'block',
    daysOfWeek: [],
    dateFrom: '',
    dateTo: '',
    singleDate: false,
    startTime: '',
    endTime: '',
    maxHoursInWindow: '1',
    isActive: true,
    notes: '',
  };
}

export function fromException(exc: BookingRuleException): ExceptionFormState {
  return {
    role: exc.role,
    roomScope: exc.roomId != null ? String(exc.roomId) : 'all',
    name: exc.name,
    kind: exc.kind,
    daysOfWeek: exc.daysOfWeek ?? [],
    dateFrom: exc.dateFrom ?? '',
    dateTo: exc.dateTo ?? '',
    singleDate: !!(exc.dateFrom && exc.dateTo && exc.dateFrom === exc.dateTo),
    startTime: exc.startTime ?? '',
    endTime: exc.endTime ?? '',
    maxHoursInWindow: exc.maxHoursInWindow != null ? String(exc.maxHoursInWindow) : '1',
    isActive: exc.isActive,
    notes: exc.notes ?? '',
  };
}

/** Aggiunge/toglie il giorno `d` mantenendo l'elenco ordinato. */
export function toggleDay(days: number[], d: number): number[] {
  return days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
}

/**
 * True se un blocco ha l'intero range nel passato (`dateTo` < `todayIso`):
 * non intercetterà mai prenotazioni future. `todayIso` è YYYY-MM-DD locale.
 */
export function isPastOnlyRange(form: ExceptionFormState, todayIso: string): boolean {
  if (form.kind !== 'block') return false;
  const effectiveDateTo = form.singleDate ? form.dateFrom : form.dateTo;
  return !!effectiveDateTo && effectiveDateTo < todayIso;
}

export type ExceptionValidation =
  { ok: true; payload: UpsertExceptionPayload } | { ok: false; error: string };

/** Valida il form e, se valido, costruisce il payload per l'API. */
export function validateException(form: ExceptionFormState): ExceptionValidation {
  if (!form.name.trim()) {
    return { ok: false, error: 'Nome obbligatorio' };
  }
  if (form.kind === 'time_window') {
    const h = Number(form.maxHoursInWindow);
    if (!Number.isFinite(h) || h <= 0) {
      return { ok: false, error: 'Ore massime nella finestra: valore positivo richiesto' };
    }
  }
  if (form.startTime && form.endTime && form.startTime >= form.endTime) {
    return { ok: false, error: "L'orario di fine deve essere successivo a quello di inizio" };
  }

  const dateFrom = form.dateFrom || null;
  const dateTo = form.singleDate ? form.dateFrom || null : form.dateTo || null;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { ok: false, error: 'La data di inizio deve precedere quella di fine' };
  }

  return {
    ok: true,
    payload: {
      role: form.role,
      name: form.name.trim(),
      kind: form.kind,
      daysOfWeek: form.daysOfWeek.length > 0 ? form.daysOfWeek : null,
      dateFrom,
      dateTo,
      startTime: form.startTime || null,
      endTime: form.endTime || null,
      maxHoursInWindow: form.kind === 'time_window' ? Number(form.maxHoursInWindow) : null,
      isActive: form.isActive,
      notes: form.notes.trim() || null,
      roomId: form.roomScope === 'all' ? null : Number(form.roomScope),
    },
  };
}
