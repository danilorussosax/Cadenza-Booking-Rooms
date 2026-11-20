import { AlertCircle, CalendarRange, CheckCircle2, Info } from 'lucide-react';
import type {
  AcademicYearOption,
  MonteOreProposal,
  MonteOreThresholdResponse,
} from '@/api/monteOre';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export function StatusBadge({ status }: { status: MonteOreProposal['status'] }) {
  const map: Record<
    MonteOreProposal['status'],
    { v: 'success' | 'secondary' | 'destructive' | 'muted'; lbl: string }
  > = {
    draft: { v: 'muted', lbl: 'Bozza' },
    submitted: { v: 'secondary', lbl: 'In attesa di approvazione' },
    approved: { v: 'success', lbl: 'Approvata' },
    rejected: { v: 'destructive', lbl: 'Rifiutata' },
    generated: { v: 'success', lbl: 'Prenotazioni create' },
  };
  const m = map[status];
  return <Badge variant={m.v}>{m.lbl}</Badge>;
}

interface TopAlertsProps {
  proposal: MonteOreProposal;
  targetItem: AcademicYearOption | undefined;
  threshold: MonteOreThresholdResponse | undefined;
  hasIndividualOverride: boolean;
  isEditable: boolean;
  submitBlockers: string[];
}

/** Banner informativi sopra il riepilogo: AA non corrente, soglia, rivalidazione, blocchi. */
export function ProposalTopAlerts({
  proposal,
  targetItem,
  threshold,
  hasIndividualOverride,
  isEditable,
  submitBlockers,
}: TopAlertsProps) {
  return (
    <>
      {/* Banner AA "non in corso" — visibile quando il docente sta compilando
          il monte ore dell'AA prossimo (rollover automatico durante la
          finestra di submission). Diversifica visivamente il caso normale
          (AA corrente) dal caso più raro (AA futuro) per evitare confusione. */}
      {targetItem && (targetItem.phase !== 'current' || targetItem.adminActivated) && (
        <Alert>
          <CalendarRange className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">
              Stai compilando il monte ore per l'AA {targetItem.academicYear}
              {targetItem.adminActivated
                ? " (attivato dall'amministrazione)"
                : targetItem.phase === 'next'
                  ? ' (prossimo)'
                  : ''}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {targetItem.adminActivated
                ? "L'amministrazione ha selezionato questo anno. La compilazione segue le date configurate nel calendario."
                : targetItem.submissionOpen
                  ? 'La finestra di inserimento è attualmente aperta.'
                  : 'La finestra di inserimento non risulta aperta al momento.'}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {hasIndividualOverride && threshold && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">
              Soglia Monte Ore personalizzata: {threshold.minHours} ore/anno
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {threshold.contractType === 'contratto_orario' && (
                <>Tipo contratto: contratto orario · </>
              )}
              {threshold.contractType === 'supplente' && <>Tipo contratto: supplente · </>}
              {threshold.contractType === 'altro' && <>Tipo contratto: altro · </>}
              Vincolo 2-4 giorni/settimana:{' '}
              {threshold.bypassDayConstraint ? 'NON applicato' : 'applicato'}.
              {' Per modifiche contattare la Direzione.'}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {proposal.requiresRevalidation && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">Proposta da rivalidare</p>
            <p className="text-sm mt-1">
              {proposal.revalidationReason ??
                'I presupposti della tua proposta sono cambiati: rivedi e re-invia.'}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {isEditable && submitBlockers.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">Per inviare la proposta al coordinatore:</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {submitBlockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

/** Alert di stato approvazione (rifiutata / approvata / prenotazioni generate). */
export function ProposalStatusAlerts({ proposal }: { proposal: MonteOreProposal }) {
  return (
    <>
      {proposal.status === 'rejected' && proposal.rejectionReason && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Proposta rifiutata.</strong> {proposal.rejectionReason}
          </AlertDescription>
        </Alert>
      )}
      {proposal.status === 'approved' && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Proposta approvata dal coordinatore. Le prenotazioni verranno create dal sistema.
          </AlertDescription>
        </Alert>
      )}
      {proposal.status === 'generated' && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Prenotazioni create automaticamente in base alla tua proposta — le trovi nella pagina{' '}
            <strong>Le mie prenotazioni</strong>.
            {proposal.generationSummary && (
              <span className="ml-2 text-muted-foreground">
                ({proposal.generationSummary.created} create
                {proposal.generationSummary.skipped > 0 &&
                  `, ${proposal.generationSummary.skipped} saltate per conflitto`}
                ).
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
