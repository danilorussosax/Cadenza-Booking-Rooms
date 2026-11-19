import dayjs from 'dayjs';
// I locale dayjs ('it', 'en', 'es') vengono importati da src/i18n/index.ts.
// Il locale attivo viene impostato dinamicamente al cambio lingua.
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isoWeek from 'dayjs/plugin/isoWeek';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(customParseFormat);
dayjs.extend(isoWeek);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);
dayjs.extend(duration);
dayjs.extend(relativeTime);

export { dayjs };

export function formatDate(value: string | Date, fmt = 'DD MMM YYYY') {
  return dayjs(value).format(fmt);
}

export function formatTime(value: string | Date) {
  return dayjs(value).format('HH:mm');
}

export function formatRange(start: string | Date, end: string | Date) {
  const s = dayjs(start);
  const e = dayjs(end);
  if (s.isSame(e, 'day')) {
    return `${s.format('DD MMM YYYY')} · ${s.format('HH:mm')} – ${e.format('HH:mm')}`;
  }
  return `${s.format('DD MMM HH:mm')} → ${e.format('DD MMM HH:mm')}`;
}

export function formatDuration(start: string | Date, end: string | Date) {
  const minutes = dayjs(end).diff(dayjs(start), 'minute');
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function toLocalDateInput(date: Date | string = new Date()) {
  return dayjs(date).format('YYYY-MM-DD');
}

export function toLocalDateTimeInput(date: Date | string = new Date()) {
  return dayjs(date).format('YYYY-MM-DDTHH:mm');
}

export function fromLocalInput(value: string): Date {
  return dayjs(value).toDate();
}

export function relativeFromNow(date: string | Date) {
  return dayjs(date).fromNow();
}

export function startOfWeek() {
  return dayjs().startOf('isoWeek');
}

/**
 * Data calendario 'YYYY-MM-DD' nel fuso LOCALE del browser (componenti
 * getFullYear/getMonth/getDate). Non usare `toISOString().slice(0, 10)`:
 * restituisce la data UTC, che differisce da quella locale vicino a mezzanotte
 * (e per date costruite a mezzanotte locale nei fusi a est di UTC).
 */
export function toLocalIsoDate(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** «Oggi» come data calendario locale 'YYYY-MM-DD'. */
export function todayLocalIso(): string {
  return toLocalIsoDate(new Date());
}
