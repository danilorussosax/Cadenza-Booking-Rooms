import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, Clock, LoaderCircle, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { bookingsApi } from '@/api/bookings';
import { httpErrorMessage } from '@/lib/api';
import { dayjs, formatTime } from '@/lib/date';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Booking } from '@/types';

type Phase = 'tooEarly' | 'open' | 'tooLate' | 'done';

interface BookingPhase {
  phase: Phase;
  opensAt: ReturnType<typeof dayjs>;
  closesAt: ReturnType<typeof dayjs>;
}

function computePhase(
  b: Booking,
  early: number,
  grace: number,
  now: ReturnType<typeof dayjs>,
): BookingPhase {
  const start = dayjs(b.startTime);
  const opensAt = start.subtract(early, 'minute');
  const closesAt = start.add(grace, 'minute');
  if (b.checkedInAt) return { phase: 'done', opensAt, closesAt };
  if (now.isBefore(opensAt)) return { phase: 'tooEarly', opensAt, closesAt };
  if (now.isAfter(closesAt)) return { phase: 'tooLate', opensAt, closesAt };
  return { phase: 'open', opensAt, closesAt };
}

export default function CheckInRoom() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const roomId = Number(id);
  const qc = useQueryClient();
  // Token QR letto da `?t=...`. Quando presente, viene inoltrato al backend
  // che lo confronta con Room.qrToken corrente — invalida i QR stampati prima
  // dell'ultima rigenerazione (vedi /admin/server-settings tab "QR Code").
  const [searchParams] = useSearchParams();
  const qrToken = searchParams.get('t');

  // Live clock per aggiornare la phase ogni secondo
  const [now, setNow] = useState(() => dayjs());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(dayjs());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);

  const query = useQuery({
    queryKey: ['bookings', 'checkin-candidates', roomId],
    queryFn: () => bookingsApi.checkinCandidates(roomId),
    enabled: Number.isFinite(roomId) && roomId > 0,
    refetchInterval: 30_000,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bookings = query.data?.bookings ?? [];
  const config = query.data?.config ?? { earlyMinutes: 5, graceMinutes: 15 };
  const room = bookings[0]?.room;
  const buildingName = room?.building?.name;
  const roomName = room?.name;

  const checkinMutation = useMutation({
    mutationFn: (bookingId: number) => bookingsApi.checkin(bookingId, qrToken),
    onSuccess: () => {
      toast.success(t('check_in.checkin_success'));
      void qc.invalidateQueries({ queryKey: ['bookings', 'checkin-candidates', roomId] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const sortedBookings = useMemo(() => {
    return [...bookings].sort(
      (a, b) => dayjs(a.startTime).valueOf() - dayjs(b.startTime).valueOf(),
    );
  }, [bookings]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
        <Link to="/dashboard">
          <ArrowLeft className="h-4 w-4" />
          {t('check_in.back_to_dashboard')}
        </Link>
      </Button>

      <header className="space-y-2">
        <h1 className="font-display text-3xl font-medium">{t('check_in.title')}</h1>
        {roomName && (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            {t('check_in.subtitle_with_room', {
              room: buildingName ? `${roomName} · ${buildingName}` : roomName,
            })}
          </p>
        )}
      </header>

      <Alert variant="info">
        <AlertDescription className="text-xs">
          {t('check_in.window_help', { early: config.earlyMinutes, grace: config.graceMinutes })}
        </AlertDescription>
      </Alert>

      {query.isLoading && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && sortedBookings.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Clock className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">{t('check_in.subtitle_no_bookings')}</p>
              <p className="text-sm text-muted-foreground">{t('check_in.no_bookings_help')}</p>
            </div>
            <Button asChild variant="outline">
              <Link to="/my-bookings">{t('check_in.go_to_my_bookings')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {sortedBookings.map((b) => {
        const ph = computePhase(b, config.earlyMinutes, config.graceMinutes, now);
        return (
          <BookingCheckinCard
            key={b.id}
            booking={b}
            phase={ph}
            now={now}
            graceMinutes={config.graceMinutes}
            busy={checkinMutation.isPending}
            onCheckin={() => {
              checkinMutation.mutate(b.id);
            }}
          />
        );
      })}
    </div>
  );
}

function BookingCheckinCard({
  booking,
  phase,
  now,
  graceMinutes,
  busy,
  onCheckin,
}: {
  booking: Booking;
  phase: BookingPhase;
  now: ReturnType<typeof dayjs>;
  graceMinutes: number;
  busy: boolean;
  onCheckin: () => void;
}) {
  const { t } = useTranslation();

  const status = phase.phase;
  const startStr = formatTime(booking.startTime);
  const endStr = formatTime(booking.endTime);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="font-display text-xl font-medium">
                {dayjs(booking.startTime).format('dddd D MMMM YYYY')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('check_in.starts_at', { time: startStr })} ·{' '}
                {t('check_in.ends_at', { time: endStr })}
              </p>
              {booking.purpose && (
                <p className="text-sm text-muted-foreground">"{booking.purpose}"</p>
              )}
              <p className="text-xs text-muted-foreground">
                {t('check_in.now', { time: now.format('HH:mm:ss') })}
              </p>
            </div>
            <PhaseBadge phase={status} />
          </div>

          {status === 'tooEarly' && (
            <Alert variant="info">
              <AlertDescription>
                {t('check_in.open_at', { time: phase.opensAt.format('HH:mm') })}
              </AlertDescription>
            </Alert>
          )}

          {status === 'tooLate' && (
            <Alert variant="destructive">
              <AlertDescription>
                {t('check_in.closed_at', { time: phase.closesAt.format('HH:mm') })}
              </AlertDescription>
            </Alert>
          )}

          {status === 'done' && booking.checkedInAt && (
            <Alert variant="info">
              <AlertDescription className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {t('check_in.confirmed_at', { time: formatTime(booking.checkedInAt) })}
              </AlertDescription>
            </Alert>
          )}

          {status === 'open' && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('check_in.auto_cancel_warning', { grace: graceMinutes })}
            </p>
          )}

          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={onCheckin}
            disabled={status !== 'open' || busy}
          >
            {busy ? (
              <LoaderCircle className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
            {t('check_in.confirm_button')}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const { t } = useTranslation();
  if (phase === 'done') {
    return <Badge variant="success">{t('check_in.confirmed_at', { time: '' }).trim()}</Badge>;
  }
  if (phase === 'open') {
    return <Badge variant="default">{t('check_in.confirm_button')}</Badge>;
  }
  if (phase === 'tooEarly') {
    return <Badge variant="muted">{t('check_in.open_at', { time: '' }).trim()}</Badge>;
  }
  return <Badge variant="muted">{t('check_in.closed_at', { time: '' }).trim()}</Badge>;
}
