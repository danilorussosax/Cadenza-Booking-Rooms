import { Fragment, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { dayjs, formatTime } from '@/lib/date';
import { BOOKING_TYPE_LABEL, BOOKING_TYPE_STYLES, ROOM_TYPE_LABEL } from '@/lib/bookings';
import { sortRoomsCrossBuilding } from '@/lib/sortRooms';
import { cn } from '@/lib/utils';
import type { Booking, Room } from '@/types';

const HEADER_HEIGHT = 48;
const SLOT_HEIGHT = 28;

interface Props {
  date: string; // YYYY-MM-DD
  rooms: Room[];
  bookings: Booking[];
  startHour?: number;
  endHour?: number;
  slotMinutes?: number;
  currentUserId?: number;
  onSlotClick?: (room: Room, start: Date, end: Date) => void;
  onBookingClick?: (booking: Booking) => void;
}

export function MultiRoomTimetable({
  date,
  rooms,
  bookings,
  startHour = 8,
  endHour = 21,
  slotMinutes = 30,
  currentUserId,
  onSlotClick,
  onBookingClick,
}: Props) {
  const { t } = useTranslation();
  // Ordina edificio → piano → nome (numeric-aware): garantisce le colonne
  // dell'orario in un ordine "logico" indipendentemente dall'ordine API.
  const sortedRooms = useMemo(() => sortRoomsCrossBuilding(rooms), [rooms]);
  const totalMinutes = (endHour - startHour) * 60;
  const slotCount = totalMinutes / slotMinutes;
  const dayStart = useMemo(
    () => dayjs(date).startOf('day').add(startHour, 'hour'),
    [date, startHour],
  );
  const slots = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => dayStart.add(i * slotMinutes, 'minute')),
    [dayStart, slotCount, slotMinutes],
  );

  const isToday = dayjs(date).isSame(dayjs(), 'day');
  const nowSlotPos = useMemo(() => {
    if (!isToday) return null;
    const minutes = dayjs().diff(dayStart, 'minute');
    if (minutes < 0 || minutes > totalMinutes) return null;
    return minutes / slotMinutes;
  }, [isToday, dayStart, totalMinutes, slotMinutes]);

  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
        {t('rooms.no_rooms')}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div
        className="relative grid min-w-fit"
        style={{
          gridTemplateColumns: `64px repeat(${sortedRooms.length}, minmax(120px, 1fr))`,
          gridTemplateRows: `${HEADER_HEIGHT}px repeat(${slotCount}, ${SLOT_HEIGHT}px)`,
        }}
      >
        {/* ─── Header row ─── */}
        <div className="sticky top-0 z-20 border-b border-r bg-card" aria-hidden />
        {sortedRooms.map((r) => (
          <div
            key={r.id}
            className="sticky top-0 z-10 flex flex-col justify-center overflow-hidden border-b border-l bg-card px-2 text-xs"
          >
            <p className="truncate font-medium leading-tight">{r.name}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {t(ROOM_TYPE_LABEL[r.type])} · {r.floor}
            </p>
          </div>
        ))}

        {/* ─── Body: hour col + slot cells ─── */}
        {slots.map((s, slotIdx) => (
          <Fragment key={slotIdx}>
            {/* Hour label */}
            <div
              className={cn(
                'flex items-start justify-end border-r pr-1 text-[9px] leading-none tabular-nums text-muted-foreground',
                slotIdx % 2 === 0 ? 'border-b border-border/70' : 'border-b border-border/30',
              )}
            >
              {slotIdx % 2 === 0 ? s.format('HH:mm') : ''}
            </div>
            {/* Slot cells per room */}
            {sortedRooms.map((r) => (
              <button
                key={`${slotIdx}-${r.id}`}
                type="button"
                onClick={() =>
                  onSlotClick?.(r, s.toDate(), s.add(slotMinutes * 2, 'minute').toDate())
                }
                className={cn(
                  'border-l transition-colors hover:bg-primary/5',
                  slotIdx % 2 === 0 ? 'border-b border-border/70' : 'border-b border-border/30',
                )}
                aria-label={`Prenota ${r.name} alle ${s.format('HH:mm')}`}
              />
            ))}
          </Fragment>
        ))}

        {/* ─── Booking blocks ─── */}
        {bookings.map((b) => {
          const roomIdx = rooms.findIndex((r) => r.id === b.roomId);
          if (roomIdx === -1) return null;
          const startMin = Math.max(0, dayjs(b.startTime).diff(dayStart, 'minute'));
          const endMin = Math.min(totalMinutes, dayjs(b.endTime).diff(dayStart, 'minute'));
          if (endMin <= 0 || startMin >= totalMinutes) return null;

          // Use CSS grid row spans (rounded to slot boundaries)
          const startSlot = Math.floor(startMin / slotMinutes);
          const endSlot = Math.ceil(endMin / slotMinutes);
          const styles = BOOKING_TYPE_STYLES[b.type];
          const owned = currentUserId && b.userId === currentUserId;

          return (
            <motion.button
              key={b.id}
              type="button"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => onBookingClick?.(b)}
              className={cn(
                'relative z-10 m-px flex flex-col items-start justify-start overflow-hidden rounded-md p-1 text-left text-[10px] leading-tight shadow-xs transition-shadow hover:shadow-md',
                styles.solid,
                owned && cn('ring-2 ring-offset-1', styles.ring),
              )}
              style={{
                gridColumn: roomIdx + 2,
                gridRow: `${startSlot + 2} / ${endSlot + 2}`,
              }}
              title={`${formatTime(b.startTime)}–${formatTime(b.endTime)} · ${t(
                BOOKING_TYPE_LABEL[b.type],
              )}${b.purpose ? ` · ${b.purpose}` : ''}${
                b.user ? ` · ${b.user.firstName} ${b.user.lastName[0]}.` : ''
              }`}
            >
              <span className="font-medium">
                {formatTime(b.startTime)}–{formatTime(b.endTime)}
              </span>
              {b.purpose && <span className="truncate text-[10px] opacity-90">{b.purpose}</span>}
            </motion.button>
          );
        })}

        {/* ─── Now indicator ─── */}
        {nowSlotPos !== null && (
          <div
            className="pointer-events-none absolute left-[64px] right-0 z-20 flex items-center"
            style={{ top: `${HEADER_HEIGHT + nowSlotPos * SLOT_HEIGHT}px` }}
            aria-hidden
          >
            <span className="-ml-1 h-2 w-2 rounded-full bg-rose-500" />
            <span className="h-px flex-1 bg-rose-500" />
          </div>
        )}
      </div>
    </div>
  );
}
