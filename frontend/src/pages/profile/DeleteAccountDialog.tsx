import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { gdprApi } from '@/api/gdpr';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export function DeleteAccountDialog({
  open,
  onOpenChange,
  userEmail,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userEmail: string;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmText('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => gdprApi.deleteAccount(),
    onSuccess: () => {
      onDeleted();
    },
    onError: (err) => {
      setError(httpErrorMessage(err));
    },
  });

  const matches = confirmText.trim().toLowerCase() === userEmail.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Eliminare definitivamente l'account?</DialogTitle>
          <DialogDescription>
            L'operazione è irreversibile. I tuoi dati anagrafici saranno anonimizzati, le
            prenotazioni future cancellate, e la sessione corrente verrà chiusa. Le prenotazioni
            storiche e gli audit log saranno conservati in forma non riconducibile a te per i
            periodi previsti dalla legge.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="confirm-email">
            Per confermare, digita la tua email: <strong>{userEmail}</strong>
          </Label>
          <Input
            id="confirm-email"
            value={confirmText}
            onChange={(e) => {
              setConfirmText(e.target.value);
            }}
            autoComplete="off"
            placeholder={userEmail}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={mutation.isPending}
          >
            Annulla
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              mutation.mutate();
            }}
            disabled={!matches || mutation.isPending}
          >
            {mutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              'Elimina definitivamente'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
