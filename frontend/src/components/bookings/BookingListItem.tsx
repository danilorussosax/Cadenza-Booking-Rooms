import { useState } from 'react';
import { AlertTriangle, Calendar, Clock, FileText, MapPin, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { dayjs, formatDate, formatDuration, formatTime } from '@/lib/date';
import { BOOKING_TYPE_STYLES } from '@/lib/bookings';
import { TypeBadge } from './TypeBadge';
import { StatusBadge } from './StatusBadge';
import { ConcertInfoDialog } from './ConcertInfoDialog';
import { Button } from '@/components/ui/button';
import type { Booking } from '@/types';

interface Props {
  booking: Booking;
  onCancel?: (booking: Booking) => void;
  cancelling?: boolean;
}

export function BookingListItem({ booking, onCancel, cancelling }: Props) {
  const { t } = useTranslation();
  const [concertOpen, setConcertOpen] = useState(false);
  const room = booking.room;
  const building = room?.building;
  const styles = BOOKING_TYPE_STYLES[booking.type];
  // Booking di tipo concerto che non sia stato cancellato → mostra l'azione
  // "Scheda concerto" per editare titolo, esecutori, programma e locandina.
  const showConcertAction = booking.type === 'concerto' && booking.status !== 'cancelled';
  // Check-in mancato: prenotazione iniziata in passato senza checkedInAt.
  // Mostra il badge ambra (informativo) anche dopo l'auto-cancel.
  // Skip se l'aula ha requireCheckIn=false (admin ha disattivato la feature).
  const missedCheckin =
    room?.requireCheckIn !== false &&
    !booking.checkedInAt &&
    dayjs(booking.startTime).isBefore(dayjs());

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center"
    >
      <div className={cn('h-10 w-1.5 shrink-0 rounded-full sm:h-12', styles.dot)} aria-hidden />

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{booking.purpose ?? 'Prenotazione'}</p>
          <TypeBadge type={booking.type} />
          <StatusBadge status={booking.status} />
          {missedCheckin && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300"
              title={t('check_in.missed_checkin_help')}
            >
              <AlertTriangle className="h-3 w-3" />
              {t('check_in.missed_checkin_badge')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(booking.startTime, 'ddd D MMM YYYY')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatTime(booking.startTime)} – {formatTime(booking.endTime)} ·{' '}
            {formatDuration(booking.startTime, booking.endTime)}
          </span>
          {room && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {room.name}
              {building && ` · ${building.name}`}
              {room.floor && ` · ${room.floor}`}
            </span>
          )}
        </div>
        {booking.notes && (
          <p className="text-xs text-muted-foreground line-clamp-2">{booking.notes}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        {showConcertAction && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConcertOpen(true);
            }}
          >
            <FileText className="h-4 w-4" />
            {t('concert.action_open')}
          </Button>
        )}
        {onCancel && booking.status === 'confirmed' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onCancel(booking);
            }}
            disabled={cancelling}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-4 w-4" />
            Annulla
          </Button>
        )}
      </div>

      {showConcertAction && (
        <ConcertInfoDialog
          open={concertOpen}
          onOpenChange={setConcertOpen}
          bookingId={booking.id}
        />
      )}
    </motion.div>
  );
}
