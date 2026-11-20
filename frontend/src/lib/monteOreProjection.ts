import type { AmendmentOperation, MonteOreSlot } from '@/api/monteOre';

type ProjectionSlot = Pick<MonteOreSlot, 'startTime' | 'endTime' | 'isActive' | 'isLocked'> &
  Partial<Pick<MonteOreSlot, 'date'>>;

const INSTITUTION_TZ = 'Europe/Rome';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const minuteOf = (time: string | undefined): number | null => {
  if (typeof time !== 'string' || !TIME_RE.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Ore attive (slot attivi e non bloccati): unica definizione lato client. */
export function activeHours(
  slots: Pick<MonteOreSlot, 'startTime' | 'endTime' | 'isActive' | 'isLocked'>[],
): number {
  let minutes = 0;
  for (const s of slots) {
    if (!s.isActive || s.isLocked) continue;
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    minutes += eh * 60 + em - (sh * 60 + sm);
  }
  return minutes / 60;
}

/** 'YYYY-MM-DDTHH:MM' dell'istante `at` nel fuso istituzionale (stesso fuso del backend). */
function institutionStamp(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: INSTITUTION_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}

function isValidDate(date: string | undefined): date is string {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

const isSunday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() === 0;

/**
 * Specchio delle regole di sicurezza di `applyOperations`
 * (backend/services/monteOreWorkflowService.js) che non richiedono il contesto
 * del piano: slot bloccato, data già trascorsa (PAST_SLOT), domenica, orari
 * non validi. Le regole che dipendono dal piano (validità, calendario
 * didattico, sospensioni) restano solo lato API, che è l'autorità.
 * Il test di parità `monteOreProjectionParity` confronta le due implementazioni.
 */
function touchable(slot: ProjectionSlot, nowStamp: string): boolean {
  if (slot.isLocked) return false;
  if (slot.date !== undefined) {
    if (!isValidDate(slot.date) || isSunday(slot.date)) return false;
    if (`${slot.date}T${slot.startTime}` <= nowStamp) return false;
  }
  const start = minuteOf(slot.startTime);
  const end = minuteOf(slot.endTime);
  return start !== null && end !== null && end > start;
}

/**
 * Estimate a compound request in hours; the API remains authoritative.
 * Returns null when the backend would reject the request (or the estimate
 * cannot be computed). `now` is injectable for tests.
 */
export function projectMonteOreHours(
  slots: MonteOreSlot[],
  operations: AmendmentOperation[],
  now: Date = new Date(),
): number | null {
  const nowStamp = institutionStamp(now);
  const rows = new Map<number, ProjectionSlot>(slots.map((slot) => [slot.id, { ...slot }]));
  for (const [index, op] of operations.entries()) {
    if (op.kind === 'add_new_day') {
      const added: ProjectionSlot = {
        date: op.payload.date,
        startTime: op.payload.startTime ?? '',
        endTime: op.payload.endTime ?? '',
        isActive: true,
        isLocked: false,
      };
      // L'API richiede sempre una data valida per un nuovo giorno.
      if (!isValidDate(added.date) || !touchable(added, nowStamp)) return null;
      if (op.payload.roomId != null && !Number.isInteger(op.payload.roomId)) return null;
      rows.set(-(index + 1), added);
      continue;
    }
    if (!Number.isInteger(op.slotId) || (op.slotId ?? 0) <= 0) return null;
    const row = rows.get(op.slotId ?? 0);
    if (!row || !touchable(row, nowStamp)) return null;
    // Il tipo arriva dal server/UI: accetta anche valori fuori dall'unione.
    const kind: string = op.kind;
    if (kind === 'toggle_off') row.isActive = false;
    else if (kind === 'toggle_on') row.isActive = true;
    else if (kind === 'change_time') {
      row.startTime = op.payload.startTime ?? row.startTime;
      row.endTime = op.payload.endTime ?? row.endTime;
    } else if (kind === 'change_room') {
      const roomId = op.payload.roomId;
      if (!Number.isInteger(roomId) || (roomId ?? 0) <= 0) return null;
    } else if (kind === 'move_to') {
      const target = rows.get(op.payload.targetSlotId ?? 0);
      if (!row.isActive || !target || target.isActive) return null;
      if (!touchable(target, nowStamp)) return null;
      row.isActive = false;
      target.isActive = true;
    } else return null;
    // Come il backend, rivalida lo slot toccato dopo ogni operazione.
    if (!touchable(row, nowStamp)) return null;
  }
  let minutes = 0;
  for (const row of rows.values()) {
    if (!row.isActive || row.isLocked) continue;
    const start = minuteOf(row.startTime);
    const end = minuteOf(row.endTime);
    if (start === null || end === null || end <= start) return null;
    minutes += end - start;
  }
  return minutes / 60;
}
