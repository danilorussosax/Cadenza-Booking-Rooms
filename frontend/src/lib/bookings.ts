import type { BookingStatus, BookingType, RoomType } from '@/types';

/**
 * Mappe di "etichette" per stati/tipi: contengono ora chiavi i18n
 * (es. "booking.form.type_lezione") da risolvere con `t()` nei componenti.
 */

export const BOOKING_TYPE_OPTIONS: { value: BookingType; labelKey: string }[] = [
  { value: 'studio_individuale', labelKey: 'booking.form.type_studio_individuale' },
  { value: 'lezione', labelKey: 'booking.form.type_lezione' },
  { value: 'prova', labelKey: 'booking.form.type_prova' },
  { value: 'concerto', labelKey: 'booking.form.type_concerto' },
  { value: 'altro', labelKey: 'booking.form.type_altro' },
];

export const BOOKING_TYPE_LABEL: Record<BookingType, string> = Object.fromEntries(
  BOOKING_TYPE_OPTIONS.map((o) => [o.value, o.labelKey]),
) as Record<BookingType, string>;

/** Background + text color tokens (Tailwind classes) per booking type */
export const BOOKING_TYPE_STYLES: Record<
  BookingType,
  { soft: string; solid: string; dot: string; ring: string }
> = {
  studio_individuale: {
    soft: 'bg-emerald-100 text-emerald-900 border-emerald-200',
    solid: 'bg-emerald-500 text-white',
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-300',
  },
  lezione: {
    soft: 'bg-sky-100 text-sky-900 border-sky-200',
    solid: 'bg-sky-500 text-white',
    dot: 'bg-sky-500',
    ring: 'ring-sky-300',
  },
  prova: {
    soft: 'bg-amber-100 text-amber-900 border-amber-200',
    solid: 'bg-amber-500 text-white',
    dot: 'bg-amber-500',
    ring: 'ring-amber-300',
  },
  concerto: {
    soft: 'bg-rose-100 text-rose-900 border-rose-200',
    solid: 'bg-rose-500 text-white',
    dot: 'bg-rose-500',
    ring: 'ring-rose-300',
  },
  altro: {
    soft: 'bg-violet-100 text-violet-900 border-violet-200',
    solid: 'bg-violet-500 text-white',
    dot: 'bg-violet-500',
    ring: 'ring-violet-300',
  },
};

/** Chiavi i18n per gli stati di prenotazione (booking.status.<key>). */
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  confirmed: 'booking.status.confirmed',
  cancelled: 'booking.status.cancelled',
  completed: 'booking.status.completed',
  no_show: 'booking.status.no_show',
  pending_approval: 'bookings.status.pending_approval',
};

export const BOOKING_STATUS_STYLES: Record<BookingStatus, string> = {
  confirmed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  cancelled: 'bg-rose-100 text-rose-800 border-rose-200',
  completed: 'bg-slate-100 text-slate-700 border-slate-200',
  no_show: 'bg-amber-100 text-amber-800 border-amber-200',
  pending_approval: 'bg-amber-100 text-amber-800 border-amber-200',
};

/** Chiavi i18n per i tipi di aula (room_types.<key>). */
export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  studio: 'room_types.studio',
  sala_prove: 'room_types.sala_prove',
  aula_concerti: 'room_types.aula_concerti',
  classe: 'room_types.classe',
  aula_didattica: 'room_types.aula_didattica',
  altro: 'room_types.altro',
};
