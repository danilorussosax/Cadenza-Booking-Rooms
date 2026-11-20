import type { MonteOreTeacherActions } from '@/api/monteOre';
import type { BookingType } from '@/types';

export const DAYS_IT = [
  'Domenica',
  'Lunedì',
  'Martedì',
  'Mercoledì',
  'Giovedì',
  'Venerdì',
  'Sabato',
];

export const TYPE_OPTIONS: { value: BookingType; label: string }[] = [
  { value: 'lezione', label: 'Lezione' },
  { value: 'studio_individuale', label: 'Studio individuale' },
  { value: 'prova', label: 'Prova' },
  { value: 'concerto', label: 'Concerto' },
];

/** Ripiego conservativo se il server non fornisce `workflow`: nessuna azione. */
export const NO_TEACHER_ACTIONS: MonteOreTeacherActions = {
  editPattern: false,
  selectDates: false,
  submit: false,
  requestAmendment: false,
  viewAmendments: false,
};
