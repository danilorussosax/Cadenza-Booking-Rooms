import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '@/api/bookings';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Booking } from '@/types';

interface Props {
  booking: Booking | null;
  onClose: () => void;
}

export function CancelBookingDialog({ booking, onClose }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cancelMutation = useMutation({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mutationFn: () => bookingsApi.cancel(booking!.id, reason.trim() || undefined),
    onSuccess: () => {
      toast.success('Prenotazione annullata');
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
      handleClose();
    },
    onError: (err) => {
      setError(httpErrorMessage(err));
    },
  });

  const handleClose = () => {
    setReason('');
    setError(null);
    onClose();
  };

  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Annullare la prenotazione?</DialogTitle>
          <DialogDescription>
            L’aula tornerà disponibile per gli altri utenti. L’operazione è irreversibile.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="reason">Motivazione (opzionale)</Label>
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            placeholder="Es. impegno sopraggiunto"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={cancelMutation.isPending}>
            Mantieni
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              cancelMutation.mutate();
            }}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              'Annulla prenotazione'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
