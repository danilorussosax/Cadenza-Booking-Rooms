import { AmendmentReview } from '@/components/monteOre/AmendmentEditor';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { type MonteOreAmendment } from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { sortRoomsCrossBuilding } from '@/lib/sortRooms';

/**
 * Bottoni di azione su un amendment pending (Approva / Rifiuta).
 * Per `add_new_day` apre un dialog che permette di assegnare/sovrascrivere
 * l'aula prima di approvare.
 */
export function AmendmentActions({
  amendment,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: {
  amendment: MonteOreAmendment;
  onApprove: (opts: { roomId?: number }) => void;
  onReject: (reason: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const qc = useQueryClient();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const isAddNewDay = amendment.kind === 'add_new_day';

  const handleApprove = () => {
    if (isAddNewDay && !amendment.operations) setApproveOpen(true);
    else setReviewOpen(true);
  };

  return (
    <>
      <div className="inline-flex gap-1">
        <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
          Rivedi / modifica
        </Button>
        <Button size="sm" variant="outline" onClick={handleApprove} disabled={isApproving}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approva
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:bg-destructive/10"
          onClick={() => setRejectOpen(true)}
          disabled={isRejecting}
        >
          <XCircle className="h-3.5 w-3.5" />
          Rifiuta
        </Button>
      </div>
      {reviewOpen && (
        <AmendmentReview
          amendment={amendment}
          onClose={() => setReviewOpen(false)}
          onDecided={() => {
            void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore'] });
          }}
        />
      )}
      {isAddNewDay && approveOpen && (
        <ApproveNewDayDialog
          amendment={amendment}
          onClose={() => setApproveOpen(false)}
          onSubmit={(roomId) => {
            onApprove({ roomId });
            setApproveOpen(false);
          }}
          isPending={isApproving}
        />
      )}
      {rejectOpen && (
        <RejectAmendmentDialog
          onClose={() => setRejectOpen(false)}
          onSubmit={(reason) => {
            onReject(reason);
            setRejectOpen(false);
          }}
          isPending={isRejecting}
        />
      )}
    </>
  );
}

function RejectAmendmentDialog({
  onClose,
  onSubmit,
  isPending,
}: {
  onClose: () => void;
  onSubmit: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rifiuta variazione</DialogTitle>
          <DialogDescription>
            Inserisci una motivazione (opzionale): verrà mostrata al docente.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={3}
          maxLength={1024}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Es. aula non disponibile per lavori"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Annulla
          </Button>
          <Button
            variant="destructive"
            onClick={() => onSubmit(reason.trim())}
            disabled={isPending}
          >
            Rifiuta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApproveNewDayDialog({
  amendment,
  onClose,
  onSubmit,
  isPending,
}: {
  amendment: MonteOreAmendment;
  onClose: () => void;
  onSubmit: (roomId: number) => void;
  isPending: boolean;
}) {
  const payload = amendment.payload as {
    date?: string;
    startTime?: string;
    endTime?: string;
    roomId?: number | null;
    bookingType?: string;
  };
  const [roomId, setRoomId] = useState<number | null>(payload.roomId ?? null);

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
  });
  const sortedRooms = sortRoomsCrossBuilding(roomsQuery.data?.rooms ?? []);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approva richiesta nuovo giorno</DialogTitle>
          <DialogDescription>
            {payload.date && payload.startTime && payload.endTime
              ? `${payload.date} · ${payload.startTime}–${payload.endTime}`
              : 'Richiesta giorno fuori pattern'}
            {payload.bookingType ? ` · ${payload.bookingType}` : ''}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (roomId) onSubmit(roomId);
          }}
        >
          {amendment.requestNotes && (
            <div className="rounded-md border bg-muted/20 p-2 text-xs">
              <div className="text-muted-foreground">Note del docente:</div>
              <div className="mt-1">{amendment.requestNotes}</div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Aula assegnata</Label>
            <Select
              value={roomId ? String(roomId) : ''}
              onValueChange={(v) => setRoomId(v ? Number(v) : null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="— scegli aula —" />
              </SelectTrigger>
              <SelectContent>
                {sortedRooms.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                    {r.building?.name ? ` · ${r.building.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {payload.roomId ? (
              <p className="text-[11px] text-muted-foreground">
                Aula proposta dal docente preselezionata. Puoi sovrascriverla.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Il docente non ha indicato l'aula: scegline una.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={!roomId || isPending}>
              Approva
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
