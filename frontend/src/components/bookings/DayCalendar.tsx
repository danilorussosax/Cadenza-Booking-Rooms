import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { dayjs, formatTime } from '@/lib/date';
import { BOOKING_TYPE_STYLES } from '@/lib/bookings';
import { cn } from '@/lib/utils';
import type { Booking } from '@/types';

interface Props {
  date: string; // YYYY-MM-DD
  bookings: Booking[];
  startHour?: number; // default 7
  endHour?: number; // default 23
  slotMinutes?: number; // default 30
  currentUserId?: number;
  onSlotClick?: (start: Date, end: Date) => void;
  onBookingClick?: (booking: Booking) => void;
}

const SLOT_HEIGHT = 32;

export function DayCalendar({
  date,
  bookings,
  startHour = 7,
  endHour = 23,
  slotMinutes = 30,
  currentUserId,
  onSlotClick,
  onBookingClick,
}: Props) {
  const slots = useMemo(() => {
    const arr: { time: string; date: Date }[] = [];
    const day = dayjs(date);
    const totalSlots = ((endHour - startHour) * 60) / slotMinutes;
    for (let i = 0; i < totalSlots; i++) {
      const t = day.startOf('day').add(startHour * 60 + i * slotMinutes, 'minute');
      arr.push({ time: t.format('HH:mm'), date: t.toDate() });
    }
    return arr;
  }, [date, startHour, endHour, slotMinutes]);

  const totalMinutes = (endHour - startHour) * 60;
  const dayStart = useMemo(
    () => dayjs(date).startOf('day').add(startHour, 'hour'),
    [date, startHour],
  );

  // Filter to bookings overlapping this day
  const visibleBookings = useMemo(
    () =>
      bookings.filter((b) => {
        const s = dayjs(b.startTime);
        const e = dayjs(b.endTime);
        const dayBegin = dayjs(date).startOf('day');
        const dayEnd = dayBegin.add(1, 'day');
        return s.isBefore(dayEnd) && e.isAfter(dayBegin) && b.status === 'confirmed';
      }),
    [bookings, date],
  );

  // "Now" indicator if today
  const isToday = dayjs(date).isSame(dayjs(), 'day');
  const nowOffset = useMemo(() => {
    if (!isToday) return null;
    const minutes = dayjs().diff(dayStart, 'minute');
    if (minutes < 0 || minutes > totalMinutes) return null;
    return (minutes / slotMinutes) * SLOT_HEIGHT;
  }, [isToday, dayStart, totalMinutes, slotMinutes]);

  const slotPositionFor = (d: Date) => {
    const minutesFromStart = dayjs(d).diff(dayStart, 'minute');
    return (minutesFromStart / slotMinutes) * SLOT_HEIGHT;
  };

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3 text-xs text-muted-foreground">
        <span>
          Orario {String(startHour).padStart(2, '0')}:00 – {String(endHour).padStart(2, '0')}:00
        </span>
        <div className="flex items-center gap-2">
          {Object.entries(BOOKING_TYPE_STYLES)
            .slice(0, 4)
            .map(([k, s]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className={cn('h-2 w-2 rounded-full', s.dot)} />
                <span className="capitalize">{k.replace('_', ' ')}</span>
              </span>
            ))}
        </div>
      </div>

      <div
        className="relative grid grid-cols-[64px_1fr]"
        style={{ height: slots.length * SLOT_HEIGHT }}
      >
        {/* Hour gutter */}
        <div className="relative border-r">
          {slots.map((s, idx) => (
            <div
              key={s.time}
              className={cn(
                'flex items-start justify-end pr-2 text-[9px] leading-none tabular-nums text-muted-foreground',
                idx % 2 !== 0 && 'opacity-0',
              )}
              style={{ height: SLOT_HEIGHT }}
            >
              {idx % 2 === 0 ? s.time : ''}
            </div>
          ))}
        </div>

        {/* Slots area */}
        <div className="relative">
          {slots.map((s, idx) => (
            <button
              key={s.time}
              type="button"
              onClick={() => {
                const start = s.date;
                const end = dayjs(start)
                  .add(slotMinutes * 2, 'minute')
                  .toDate();
                onSlotClick?.(start, end);
              }}
              className={cn(
                'group relative flex w-full items-center justify-center border-b text-xs transition-colors',
                idx % 2 === 0 ? 'border-border/80' : 'border-border/40',
                'hover:bg-primary/5',
              )}
              style={{ height: SLOT_HEIGHT }}
            >
              <Plus className="h-3 w-3 text-primary opacity-0 transition-opacity group-hover:opacity-70" />
            </button>
          ))}

          {/* Bookings */}
          {visibleBookings.map((b) => {
            const top = Math.max(0, slotPositionFor(new Date(b.startTime)));
            const bottom = Math.min(
              slots.length * SLOT_HEIGHT,
              slotPositionFor(new Date(b.endTime)),
            );
            const height = Math.max(SLOT_HEIGHT, bottom - top);
            const styles = BOOKING_TYPE_STYLES[b.type];
            const owned = currentUserId && b.userId === currentUserId;

            return (
              <motion.button
                key={b.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => onBookingClick?.(b)}
                className={cn(
                  'absolute left-1 right-1 overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] shadow-xs ring-offset-background transition-all',
                  styles.soft,
                  'hover:shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                  owned && cn('ring-2 ring-offset-2', styles.ring),
                )}
                style={{ top, height }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium leading-tight">{b.purpose ?? 'Prenotazione'}</span>
                  <span className="shrink-0 opacity-70">
                    {formatTime(b.startTime)}–{formatTime(b.endTime)}
                  </span>
                </div>
                {b.user && (
                  <div className="truncate text-[10px] opacity-70">
                    {b.user.firstName} {b.user.lastName}
                  </div>
                )}
              </motion.button>
            );
          })}

          {/* Now indicator */}
          {nowOffset !== null && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-10 flex items-center"
              style={{ top: nowOffset }}
            >
              <span className="-ml-1 h-2 w-2 rounded-full bg-rose-500" />
              <span className="h-px flex-1 bg-rose-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
