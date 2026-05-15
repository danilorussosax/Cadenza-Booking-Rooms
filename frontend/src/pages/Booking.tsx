import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { bookingsApi } from '@/api/bookings';
import { roomsApi } from '@/api/rooms';
import { dayjs, toLocalDateInput } from '@/lib/date';
import { sortRoomsCrossBuilding } from '@/lib/sortRooms';
import { ROOM_TYPE_LABEL } from '@/lib/bookings';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DayCalendar } from '@/components/bookings/DayCalendar';
import { BookingFormDialog } from '@/components/bookings/BookingFormDialog';
import { CancelBookingDialog } from '@/components/bookings/CancelBookingDialog';
import { BookingInfoDialog } from '@/components/bookings/BookingInfoDialog';
import type { Booking } from '@/types';

export default function BookingPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  const [date, setDate] = useState<string>(() => params.get('date') ?? toLocalDateInput());
  const [roomIdStr, setRoomIdStr] = useState<string>(() => params.get('room') ?? '');
  const [createState, setCreateState] = useState<{
    open: boolean;
    start?: Date;
    end?: Date;
  }>({ open: false });
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [editTarget, setEditTarget] = useState<Booking | null>(null);
  const [infoTarget, setInfoTarget] = useState<Booking | null>(null);

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
  });

  // Default room: first one if none chosen
  useEffect(() => {
    if (!roomIdStr && roomsQuery.data?.rooms.length) {
      setRoomIdStr(String(roomsQuery.data.rooms[0].id));
    }
  }, [roomIdStr, roomsQuery.data]);

  // Sync URL params
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (roomIdStr) next.set('room', roomIdStr);
    next.set('date', date);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, roomIdStr]);

  const roomId = roomIdStr ? Number(roomIdStr) : null;
  const selectedRoom = useMemo(
    () => roomsQuery.data?.rooms.find((r) => r.id === roomId) ?? null,
    [roomsQuery.data, roomId],
  );

  const availabilityQuery = useQuery({
    queryKey: ['availability', roomId, date],
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    queryFn: () => bookingsApi.availability(roomId!, date),
    enabled: !!roomId,
  });

  const handleSlotClick = (start: Date, end: Date) => {
    setCreateState({ open: true, start, end });
  };

  const handleBookingClick = (b: Booking) => {
    if (b.status !== 'confirmed' || dayjs(b.endTime).isBefore(dayjs())) return;
    // Stessa logica della Dashboard (handleBookingClick): admin -> modifica
    // di qualsiasi booking, owner -> cancel della propria, altri -> info
    // read-only. Le tre vie qui sono necessarie perché /booking mostra il
    // calendario completo dell'aula con TUTTE le prenotazioni (anche altrui).
    if (user?.role === 'admin') {
      setEditTarget(b);
      return;
    }
    if (b.userId === user?.id) {
      setCancelTarget(b);
      return;
    }
    setInfoTarget(b);
  };

  const dayLabel = dayjs(date).format('dddd D MMMM YYYY');
  const isToday = dayjs(date).isSame(dayjs(), 'day');

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl font-medium sm:text-3xl">{t('booking.title')}</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">{t('booking.subtitle')}</p>
        </div>
        {/* CTA: nascosta su mobile — tap sullo slot libero crea direttamente
            la prenotazione, quindi un secondo bottone in cima e' rumore. */}
        <Button
          className="hidden sm:inline-flex"
          onClick={() => {
            setCreateState({ open: true });
          }}
        >
          <CalendarPlus className="h-4 w-4" />
          {t('my_bookings.new_booking')}
        </Button>
      </header>

      {/* Filters */}
      <Card>
        <CardContent className="grid gap-3 p-3 sm:gap-4 sm:p-5 sm:grid-cols-[1fr_auto_auto]">
          <div className="space-y-2">
            <Label>{t('booking.form.room')}</Label>
            <Select value={roomIdStr} onValueChange={setRoomIdStr} disabled={roomsQuery.isLoading}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    roomsQuery.isLoading
                      ? t('booking.form.room_loading')
                      : t('common.select_placeholder')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sortRoomsCrossBuilding(roomsQuery.data?.rooms ?? []).map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                    {r.building?.name ? ` · ${r.building.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('booking.form.date')}</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
              }}
            />
          </div>

          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              size="icon"
              title={t('dashboard.prev_day')}
              onClick={() => {
                setDate(dayjs(date).subtract(1, 'day').format('YYYY-MM-DD'));
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDate(toLocalDateInput());
              }}
              disabled={isToday}
            >
              {t('common.today')}
            </Button>
            <Button
              variant="outline"
              size="icon"
              title={t('dashboard.next_day')}
              onClick={() => {
                setDate(dayjs(date).add(1, 'day').format('YYYY-MM-DD'));
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Selected room info */}
      {selectedRoom && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 sm:gap-3 sm:px-5 sm:py-3"
        >
          <div className="space-y-0.5">
            <p className="font-display text-lg font-medium leading-tight">{selectedRoom.name}</p>
            <p className="text-xs text-muted-foreground">
              {selectedRoom.building?.name} · {selectedRoom.floor} ·{' '}
              {t(
                selectedRoom.capacity === 1
                  ? 'admin.structure.seats_one'
                  : 'admin.structure.seats_other',
                { count: selectedRoom.capacity },
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t(ROOM_TYPE_LABEL[selectedRoom.type])}</Badge>
            <Badge variant={selectedRoom.isBookable ? 'success' : 'muted'}>
              {selectedRoom.isBookable
                ? t('admin.structure.bookable')
                : t('admin.structure.not_bookable')}
            </Badge>
          </div>
        </motion.div>
      )}

      {/* Day calendar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-base font-medium capitalize sm:text-lg">{dayLabel}</p>
          <p className="hidden text-xs text-muted-foreground sm:block">{t('booking.click_help')}</p>
        </div>
        {!roomId && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              {t('booking.select_room_first')}
            </CardContent>
          </Card>
        )}
        {roomId && availabilityQuery.isLoading && <Skeleton className="h-[800px] w-full" />}
        {roomId && availabilityQuery.data && (
          <DayCalendar
            date={date}
            bookings={availabilityQuery.data.bookings}
            currentUserId={user?.id}
            onSlotClick={handleSlotClick}
            onBookingClick={handleBookingClick}
          />
        )}
      </div>

      <BookingFormDialog
        open={createState.open}
        onOpenChange={(open) => {
          setCreateState((s) => ({ ...s, open }));
        }}
        defaultRoomId={roomId ?? undefined}
        defaultStart={createState.start}
        defaultEnd={createState.end}
      />
      <CancelBookingDialog
        booking={cancelTarget}
        onClose={() => {
          setCancelTarget(null);
        }}
      />
      {/* Admin: modifica di prenotazioni esistenti (anche altrui) — apertura
          al click sul blocco quando il ruolo è admin. */}
      <BookingFormDialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        booking={editTarget}
      />
      {/* Click su prenotazione altrui (non admin, non owner): read-only. */}
      <BookingInfoDialog
        booking={infoTarget}
        onClose={() => {
          setInfoTarget(null);
        }}
      />
    </div>
  );
}
