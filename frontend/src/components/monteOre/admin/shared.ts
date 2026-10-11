import { type MonteOreProposal, type MonteOreAmendment } from '@/api/monteOre';
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

export const STATUS_LABEL: Record<MonteOreProposal['status'], string> = {
  draft: 'Bozza',
  submitted: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  generated: 'Prenotazioni create',
};

export const STATUS_VARIANT: Record<
  MonteOreProposal['status'],
  'success' | 'secondary' | 'destructive' | 'muted'
> = {
  draft: 'muted',
  submitted: 'secondary',
  approved: 'success',
  rejected: 'destructive',
  generated: 'success',
};

export const CONTRACT_LABEL: Record<
  NonNullable<NonNullable<MonteOreProposal['user']>['contractType']>,
  string
> = {
  titolare: 'Titolare',
  contratto_orario: 'Contratto orario',
  supplente: 'Supplente',
  altro: 'Altro',
  tempo_definito: 'Tempo definito',
  collaborazione: 'Collaborazione',
};

const CCNL_STANDARD_HOURS = 324;

/**
 * Risolve la soglia ore annue applicabile a un docente per la UI admin:
 *   1. snapshot della proposta (immutabile, fissato al submit) →
 *   2. override individuale corrente sul docente →
 *   3. fallback CCNL standard 324h.
 *
 * `isCustom` distingue una soglia diversa dal CCNL standard (e quindi
 * meritevole di evidenziazione), indipendentemente dalla fonte. Una proposta
 * con snapshot=324 NON è "personalizzata" anche se la fonte è snapshot —
 * è semplicemente la soglia istituzionale congelata al submit.
 */
export function resolveProposalThreshold(p: MonteOreProposal): {
  hours: number;
  source: 'snapshot' | 'override' | 'ccnl';
  isCustom: boolean;
  contractType: NonNullable<MonteOreProposal['user']>['contractType'] | null;
} {
  const ct = p.user?.contractType ?? null;
  // Lo snapshot è la "fotografia contrattuale" del momento del submit:
  // resta valido anche se l'admin rimuove o modifica l'override in seguito.
  if (p.minRequiredHoursSnapshot != null) {
    const hours = p.minRequiredHoursSnapshot;
    return {
      hours,
      source: 'snapshot',
      isCustom: hours !== CCNL_STANDARD_HOURS,
      contractType: ct,
    };
  }
  // Proposta non ancora submitted: applichiamo l'override corrente del docente
  // (se presente). Il valore mostrato è "previsionale" — diventerà snapshot al submit.
  if (p.user?.monteOreAnnualHoursOverride != null) {
    return {
      hours: p.user.monteOreAnnualHoursOverride,
      source: 'override',
      isCustom: true,
      contractType: ct,
    };
  }
  return { hours: CCNL_STANDARD_HOURS, source: 'ccnl', isCustom: false, contractType: ct };
}

export const AMENDMENT_KIND_LABEL: Record<MonteOreAmendment['kind'], string> = {
  toggle_off: 'Disattivazione',
  toggle_on: 'Riattivazione',
  change_time: 'Cambio orario',
  add_new_day: 'Nuovo giorno',
  change_room: 'Cambio aula',
  move_to: 'Spostamento',
};
