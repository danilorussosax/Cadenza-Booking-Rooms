import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { contractTypesApi } from '@/api/contractTypes';
import type { ContractTypeRow } from '@/types';

interface Props {
  contractType: ContractTypeRow;
  newDefaultHours: number | null;
  onCancel: () => void;
  onConfirm: () => void;
  confirming: boolean;
}

/**
 * Dialog di conferma quando l'admin cambia `defaultHours` di una tipologia
 * già in uso. Mostra l'elenco dei docenti che useranno la nuova soglia
 * (utenti senza override individuale) + le proposte draft che verranno
 * ricalcolate al prossimo `resolveAnnualThreshold`.
 *
 * Le proposte già `submitted` o `approved` hanno snapshot stabile e non
 * vengono toccate — questo è esplicitato in copy.
 */
export function ImpactConfirmDialog({
  contractType,
  newDefaultHours,
  onCancel,
  onConfirm,
  confirming,
}: Props) {
  const impactQuery = useQuery({
    queryKey: ['contract-types', contractType.id, 'impact'],
    queryFn: () => contractTypesApi.impact(contractType.id),
    staleTime: 0,
  });

  const data = impactQuery.data;
  const oldHours = contractType.defaultHours;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Conferma cambio soglia ore
          </DialogTitle>
          <DialogDescription>
            Stai cambiando la soglia predefinita di "{contractType.label}" da{' '}
            <strong>{oldHours == null ? 'non impostata' : `${oldHours}h`}</strong> a{' '}
            <strong>{newDefaultHours == null ? 'non impostata' : `${newDefaultHours}h`}</strong>.
            Verifica chi sarà impattato prima di confermare.
          </DialogDescription>
        </DialogHeader>

        {impactQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : impactQuery.isError ? (
          <Alert variant="destructive">
            <AlertDescription>Impossibile caricare il report di impatto.</AlertDescription>
          </Alert>
        ) : data ? (
          <div className="space-y-4">
            {/* Riassunto */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Docenti impattati
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  {data.usersAffectedCount}
                </div>
                <div className="text-xs text-muted-foreground">senza override individuale</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Con override individuale
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.usersWithOverrideCount}
                </div>
                <div className="text-xs text-muted-foreground">non impattati</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Proposte draft
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.draftProposalsCount}
                </div>
                <div className="text-xs text-muted-foreground">verranno ricalcolate</div>
              </div>
            </div>

            {/* Lista docenti impattati */}
            {data.usersAffected.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Docenti con questa tipologia (e senza override personale)
                </div>
                <div className="max-h-48 overflow-y-auto rounded-lg border">
                  <ul className="divide-y text-sm">
                    {data.usersAffected.map((u) => (
                      <li key={u.id} className="flex items-center justify-between px-3 py-2">
                        <span>
                          <strong>
                            {u.lastName} {u.firstName}
                          </strong>
                          <span className="ml-2 text-xs text-muted-foreground">{u.email}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Note */}
            <Alert>
              <AlertDescription className="text-xs">
                Le proposte già <strong>inviate</strong> o <strong>approvate</strong> hanno uno{' '}
                <em>snapshot</em> della soglia fissato al momento del submit: <strong>non</strong>{' '}
                vengono modificate da questo cambio. Solo le proposte in stato <em>draft</em>{' '}
                useranno la nuova soglia al prossimo calcolo.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={confirming}>
            Annulla
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={confirming || impactQuery.isLoading}
            variant="default"
            className="bg-amber-600 hover:bg-amber-700"
          >
            {confirming ? 'Conferma in corso…' : 'Confermo, applica il cambio'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
