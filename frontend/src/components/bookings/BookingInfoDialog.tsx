import { useTranslation } from 'react-i18next';
import { CalendarClock, DoorOpen, Lock, User as UserIcon } from 'lucide-react';
import { dayjs } from '@/lib/date';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { TypeBadge } from '@/components/bookings/TypeBadge';
import type { Booking } from '@/types';

interface Props {
  booking: Booking | null;
  onClose: () => void;
}

// =============================================================================
// Dialog read-only per visualizzare i dettagli di una prenotazione **altrui**.
// Usato in Dashboard quando un utente non-admin clicca su un blocco della
// griglia settimanale che non è suo: nessuna possibilità di modifica o
// cancellazione (lock icon nel titolo), solo informazioni minime utili a
// capire chi ha occupato l'aula.
//
// Le informazioni sensibili (email, telefono, matricola) NON vengono mostrate
// in questa vista: solo nome+cognome+ruolo, orario, aula, motivo se presente.
// =============================================================================
export function BookingInfoDialog({ booking, onClose }: Props) {
  const { t } = useTranslation();
  const open = booking !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            {t('booking.info_dialog.title')}
          </DialogTitle>
          <DialogDescription>{t('booking.info_dialog.subtitle')}</DialogDescription>
        </DialogHeader>

        {booking && (
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('booking.info_dialog.when')}
              </p>
              <p className="inline-flex items-center gap-2 text-sm">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <span>
                  {dayjs(booking.startTime).format('dddd D MMMM YYYY')}
                  {' · '}
                  {dayjs(booking.startTime).format('HH:mm')}
                  {' – '}
                  {dayjs(booking.endTime).format('HH:mm')}
                </span>
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('booking.info_dialog.room')}
              </p>
              <p className="inline-flex items-center gap-2 text-sm">
                <DoorOpen className="h-4 w-4 text-muted-foreground" />
                <span>
                  {booking.room?.code ? `${booking.room.code} · ` : ''}
                  {booking.room?.name ?? `#${booking.roomId}`}
                  {booking.room?.building?.name ? ` — ${booking.room.building.name}` : ''}
                </span>
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('booking.info_dialog.booked_by')}
              </p>
              <p className="inline-flex items-center gap-2 text-sm">
                <UserIcon className="h-4 w-4 text-muted-foreground" />
                <span>
                  {booking.user
                    ? `${booking.user.firstName} ${booking.user.lastName}`
                    : t('booking.info_dialog.unknown_user')}
                  {booking.user?.role && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {t(`roles.${booking.user.role}`)}
                    </Badge>
                  )}
                </span>
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('booking.info_dialog.type')}
              </p>
              <TypeBadge type={booking.type} />
            </div>

            {booking.purpose && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('booking.info_dialog.purpose')}
                </p>
                <p className="text-sm text-foreground/90">{booking.purpose}</p>
              </div>
            )}

            <p className="border-t pt-3 text-xs italic text-muted-foreground">
              {t('booking.info_dialog.readonly_note')}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
