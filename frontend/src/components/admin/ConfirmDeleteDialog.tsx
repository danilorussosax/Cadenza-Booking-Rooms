import type { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  /**
   * Variant del bottone di conferma. Default 'destructive' (UX delete).
   * Usa 'default' per bulk approve / non-destructive bulk action.
   */
  variant?: 'default' | 'destructive';
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  /** Slot opzionale renderizzato sopra il footer (es. textarea motivo). */
  children?: ReactNode;
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title = 'Confermi l’eliminazione?',
  description = 'L’operazione è irreversibile.',
  confirmLabel = 'Elimina',
  variant = 'destructive',
  loading,
  error,
  onConfirm,
  children,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={loading}
          >
            Annulla
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={loading}>
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
