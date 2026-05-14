import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { rulesApi } from '@/api/rules';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Role } from '@/types';

/**
 * Hint compatto che mostra all'utente i vincoli di prenotazione del proprio
 * ruolo (durata, anticipo, finestra oraria, quote). Pensato per essere
 * inserito sopra i campi del BookingFormDialog: previene il "perché non
 * riesco a prenotare?" mostrando *prima* del submit cosa è ammesso.
 *
 * - Niente render per `admin` (vede già tutto in /admin/rules).
 * - Niente render se la fetch della rule fallisce o è in caricamento:
 *   l'hint è ausiliario, non blocca il flow.
 */
export function BookingRuleHint({ role }: { role: Role }) {
  const query = useQuery({
    queryKey: ['rules', role],
    queryFn: () => rulesApi.get(role),
    // Le BookingRule cambiano raramente (solo l'admin le edita): cache
    // generosa così non rifaccio la fetch ogni volta che si riapre il dialog.
    staleTime: 5 * 60 * 1000,
    enabled: role !== 'admin',
  });

  if (role === 'admin') return null;
  if (!query.data?.rule) return null;
  const r = query.data.rule;

  const formatDuration = (mins: number) => {
    if (mins < 60) return `${mins} min`;
    const h = mins / 60;
    return Number.isInteger(h) ? `${h} ore` : `${h.toFixed(1)} ore`;
  };
  const formatAdvance = (hours: number) => {
    if (hours < 24) return `${hours}h`;
    const d = hours / 24;
    return Number.isInteger(d) ? `${d}g` : `${d.toFixed(1)}g`;
  };

  const items: string[] = [];
  items.push(
    `Durata: ${formatDuration(r.minBookingDurationMinutes)} – ${formatDuration(r.maxBookingDurationMinutes)}`,
  );
  items.push(
    `Anticipo: tra ${formatAdvance(r.minAdvanceHours)} e ${r.maxAdvanceDays} giorni dall'inizio`,
  );
  if (r.allowedStartTime && r.allowedEndTime) {
    items.push(`Fascia oraria: ${r.allowedStartTime} – ${r.allowedEndTime}`);
  }
  items.push(
    `Massimi: ${r.maxActiveBookings} prenotazioni attive · ${r.maxHoursPerWeek}h/settimana · ${r.maxHoursPerDay}h/giorno`,
  );
  if (r.cancellationDeadlineHours > 0) {
    items.push(`Cancellazione: almeno ${r.cancellationDeadlineHours}h prima dell'inizio`);
  }
  if (r.minIntervalBetweenBookingsMinutes > 0) {
    items.push(
      `Pausa minima tra prenotazioni: ${formatDuration(r.minIntervalBetweenBookingsMinutes)}`,
    );
  }
  // Le ricorrenze settimanali sono permesse di default solo a docente/admin
  // (lo studente ha allowRecurring=false nella seed). Lo segnaliamo
  // esplicitamente per chi le ha così l'utente sa di poter usare il toggle
  // "Ripeti settimanalmente" del form.
  if (r.allowRecurring) {
    items.push('Ricorrenze settimanali ammesse');
  }

  return (
    <Alert variant="info">
      <Info className="h-4 w-4" />
      <AlertDescription>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide opacity-70">
          Limiti del tuo ruolo ({role})
        </p>
        <ul className="space-y-0.5 text-xs leading-snug">
          {items.map((it) => (
            <li key={it}>· {it}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
