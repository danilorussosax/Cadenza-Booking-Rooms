import { ListChecks, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { BookingType } from '@/types';

// =====================================================
// Dialog di offerta waitlist
// =====================================================
//
// Si apre automaticamente quando il backend rifiuta una booking con code
// 'BOOKING_CONFLICT'. Mostra il riepilogo (aula + orari) e chiede all'utente
// se vuole iscriversi alla coda. Se sì, parte la mutation; al completamento
// il dialog si chiude e l'utente vede toast + card waitlist sulla Dashboard.
export function WaitlistOfferDialog({
  payload,
  loading,
  onConfirm,
  onClose,
}: {
  payload: {
    roomId: number;
    startTime: string;
    endTime: string;
    type: BookingType;
    roomLabel: string | null;
  } | null;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const open = !!payload;
  const start = payload ? new Date(payload.startTime) : null;
  const end = payload ? new Date(payload.endTime) : null;
  const fmt = (d: Date) =>
    d.toLocaleString(undefined, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            {t('waitlist.offer_dialog_title')}
          </DialogTitle>
          <DialogDescription>{t('waitlist.offer_dialog_description')}</DialogDescription>
        </DialogHeader>

        {payload && start && end && (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
            {payload.roomLabel && (
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('booking.form.room')}
                </span>
                <span className="font-medium">{payload.roomLabel}</span>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {fmt(start)} → {fmt(end)}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            {t('waitlist.offer_dialog_decline')}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={loading}>
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ListChecks className="h-4 w-4" />
            )}
            {t('waitlist.offer_dialog_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
