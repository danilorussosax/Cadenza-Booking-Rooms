import { useMutation } from '@tanstack/react-query';
import { Ban, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { rulesApi, type OverlapBooking } from '@/api/rules';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { BookingRuleException, Role } from '@/types';
import { roleLabel } from '@/lib/ruleExceptions';

/**
 * Dialog di follow-up dopo il salvataggio di un'eccezione kind='block':
 * elenca le prenotazioni preesistenti che cadono nello scope appena
 * dichiarato e propone di cancellarle in batch (con motivazione = nome
 * dell'eccezione). Coerente con il pattern EasyRoom "sovrapposizioni" al
 * setup di una chiusura.
 */
export function OverlapDialog({
  state,
  onClose,
  onCancelled,
}: {
  state: { exception: BookingRuleException; overlapping: OverlapBooking[] } | null;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const cancelMutation = useMutation({
    mutationFn: (id: number) => rulesApi.cancelOverlapping(id),
    onSuccess: (res) => {
      const moPart =
        res.monteOreSlotsSynced > 0
          ? ` (${res.monteOreSlotsSynced} slot Monte Ore disattivati)`
          : '';
      toast.success(`${res.cancelled} prenotazioni cancellate${moPart}`);
      onCancelled();
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  if (!state) return null;
  const { exception, overlapping } = state;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('it-IT', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Sovrapposizioni rilevate
          </DialogTitle>
        </DialogHeader>

        <Alert variant="destructive">
          <AlertDescription>
            <strong>{overlapping.length}</strong> prenotazione/i futura/e cadono nello scope del
            blocco "{exception.name}". Restano nell'agenda finché non vengono cancellate.
          </AlertDescription>
        </Alert>

        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <ul className="divide-y">
            {overlapping.map((b) => (
              <li key={b.id} className="space-y-0.5 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {fmt(b.startTime)} → {fmt(b.endTime)}
                  </p>
                  {b.fromMonteOre && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      Monte Ore
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground">
                  {b.user
                    ? `${b.user.lastName} ${b.user.firstName} (${roleLabel(b.user.role as Role)})`
                    : 'Utente sconosciuto'}
                  {' • '}
                  {b.room
                    ? `${b.room.name}${b.room.building ? ` (${b.room.building.name})` : ''}`
                    : 'Aula sconosciuta'}
                </p>
                {b.purpose && <p className="italic text-muted-foreground">{b.purpose}</p>}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-muted-foreground">
          La cancellazione tocca solo prenotazioni future non ancora effettuate (no check-in). Le
          prenotazioni passate restano per integrità storica. Per le prenotazioni Monte Ore
          disattiviamo anche lo slot collegato così la rigenerazione non le ricrea.
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Lascia stare
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => cancelMutation.mutate(exception.id)}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              `Cancella ${overlapping.length} prenotazion${overlapping.length === 1 ? 'e' : 'i'}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
