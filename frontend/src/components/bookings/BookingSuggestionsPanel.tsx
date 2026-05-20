import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, CalendarClock, Clock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BookingSuggestion, BookingSuggestionReason, Room } from '@/types';

interface Props {
  suggestions: BookingSuggestion[];
  rooms: Pick<Room, 'id' | 'name' | 'floor' | 'building'>[];
  onPick: (suggestion: BookingSuggestion) => void;
  /** Disabilita il click delle chip (es. retry in corso). */
  disabled?: boolean;
  /** Locale per `toLocaleString`; default = browser locale. */
  locale?: string;
  /** Nome (firstName + lastName) del proprietario della booking conflittuale.
   *  Mostrato come banner sopra le chip per docenti/admin. `null` per studenti. */
  conflictOwner?: string | null;
}

/**
 * Pannello di alternative su BOOKING_CONFLICT (§2.11): rendering di chip
 * cliccabili che pre-compilano il form. Standalone, accessibile (role=list /
 * listitem, aria-label per ogni chip), pensato per essere mostrato INLINE
 * dentro `BookingFormDialog`.
 */
export function BookingSuggestionsPanel({
  suggestions,
  rooms,
  onPick,
  disabled = false,
  locale,
  conflictOwner,
}: Props) {
  const { t } = useTranslation();

  const roomById = useMemo(() => {
    const map = new Map<number, Props['rooms'][number]>();
    for (const r of rooms) map.set(r.id, r);
    return map;
  }, [rooms]);

  if (suggestions.length === 0) {
    return (
      <section
        aria-label={t('booking.suggestions.title')}
        className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
      >
        <div className="mb-1 inline-flex items-center gap-2 font-semibold">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t('booking.suggestions.title')}
        </div>
        <p className="text-amber-800/90 dark:text-amber-200/90">{t('booking.suggestions.none')}</p>
      </section>
    );
  }

  return (
    <section
      aria-label={t('booking.suggestions.title')}
      className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/40"
    >
      <header className="space-y-1">
        <div className="inline-flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-100">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t('booking.suggestions.title')}
        </div>
        <p className="text-amber-800/90 dark:text-amber-200/90">
          {t('booking.suggestions.subtitle')}
        </p>
        {conflictOwner && (
          <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="conflict-owner">
            {t('booking.suggestions.conflict_owner', { name: conflictOwner })}
          </p>
        )}
      </header>

      <ul role="list" className="grid gap-2 sm:grid-cols-2">
        {suggestions.map((s, idx) => {
          const room = roomById.get(s.roomId);
          const roomLabel = room
            ? [room.name, room.building?.name].filter(Boolean).join(' · ')
            : t('booking.suggestions.unknown_room', { id: s.roomId });
          const start = new Date(s.startTime);
          const end = new Date(s.endTime);
          const reasonLabel = t(`booking.suggestions.reason.${s.reason}`);
          const Icon = iconForReason(s.reason);
          const ariaLabel = t('booking.suggestions.chip_aria', {
            room: roomLabel,
            start: formatRange(start, end, locale).start,
            end: formatRange(start, end, locale).end,
            reason: reasonLabel,
          });

          return (
            <li key={`${s.roomId}-${s.startTime}-${idx}`} role="listitem">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  onPick(s);
                }}
                aria-label={ariaLabel}
                className="h-auto w-full justify-start gap-2 border-amber-300 bg-white/70 px-3 py-2 text-left whitespace-normal hover:bg-white dark:border-amber-800 dark:bg-amber-950/60 dark:hover:bg-amber-950"
              >
                <Icon
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300"
                  aria-hidden="true"
                />
                <span className="flex-1 space-y-0.5">
                  <span className="block font-medium">{roomLabel}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatRangeLabel(start, end, locale)}
                  </span>
                  <span className="block text-xs italic text-amber-800 dark:text-amber-200">
                    {reasonLabel}
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function iconForReason(reason: BookingSuggestionReason) {
  if (reason === 'similar_room_same_time') return Building2;
  if (reason === 'same_room_next_day' || reason === 'same_room_two_days_later') {
    return CalendarClock;
  }
  return Clock;
}

function formatRange(start: Date, end: Date, locale?: string) {
  const fmt = (d: Date) =>
    d.toLocaleString(locale, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  return { start: fmt(start), end: fmt(end) };
}

function formatRangeLabel(start: Date, end: Date, locale?: string) {
  const sameDay = start.toDateString() === end.toDateString();
  const date = start.toLocaleDateString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
  const t1 = start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const t2 = end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `${date} · ${t1} → ${t2}`;
  return `${formatRange(start, end, locale).start} → ${formatRange(start, end, locale).end}`;
}
