import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, CalendarRange, Repeat, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  expandPreviewDates,
  MAX_OCCURRENCES,
  WEEKDAYS,
  type RecurrenceState,
  type WeekdayCode,
} from '@/lib/recurrence';

interface Props {
  value: RecurrenceState;
  onChange: (next: RecurrenceState) => void;
  /** Data della prima occorrenza (YYYY-MM-DD) — derivata da `startTime` del form parent. */
  startDate: string;
}

export function RecurrenceForm({ value, onChange, startDate }: Props) {
  const { t, i18n } = useTranslation();
  const r = value;

  // Preview live delle prime ~5 date + count totale
  const previewDates = useMemo(
    () => (r.enabled && startDate ? expandPreviewDates(r, startDate) : []),
    [r, startDate],
  );

  const fmtDate = (iso: string) => {
    try {
      const d = new Date(iso + 'T12:00:00');
      return d.toLocaleDateString(i18n.language || 'it', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      });
    } catch {
      return iso;
    }
  };

  const toggleWeekday = (code: WeekdayCode) => {
    const next = r.byWeekday.includes(code)
      ? r.byWeekday.filter((w) => w !== code)
      : [...r.byWeekday, code];
    onChange({ ...r, byWeekday: next });
  };

  const addExcludeDate = (iso: string) => {
    if (!iso || r.excludeDates.includes(iso)) return;
    onChange({ ...r, excludeDates: [...r.excludeDates, iso].sort() });
  };
  const removeExcludeDate = (iso: string) => {
    onChange({ ...r, excludeDates: r.excludeDates.filter((d) => d !== iso) });
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      {/* Master toggle */}
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
          checked={r.enabled}
          onChange={(e) => onChange({ ...r, enabled: e.target.checked })}
        />
        <Repeat className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{t('booking.form.recurring')}</span>
      </label>

      {!r.enabled && (
        <p className="pl-6 text-[11px] text-muted-foreground">{t('booking.form.recurring_hint')}</p>
      )}

      {r.enabled && (
        <div className="space-y-3 pl-6">
          {/* Frequency + interval */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {t('booking.form.recurring_repeat_every')}
            </span>
            <Input
              type="number"
              min={1}
              max={12}
              value={r.interval}
              onChange={(e) =>
                onChange({
                  ...r,
                  interval: Math.max(1, Math.min(12, Number(e.target.value) || 1)),
                })
              }
              className="w-16"
            />
            <select
              value={r.frequency}
              onChange={(e) => onChange({ ...r, frequency: e.target.value as 'daily' | 'weekly' })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="daily">{t('booking.form.recurring_freq_daily')}</option>
              <option value="weekly">{t('booking.form.recurring_freq_weekly')}</option>
            </select>
          </div>

          {/* Weekday picker (solo weekly) */}
          {r.frequency === 'weekly' && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t('booking.form.recurring_weekdays')}
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => {
                  const active = r.byWeekday.includes(w.code);
                  return (
                    <button
                      key={w.code}
                      type="button"
                      onClick={() => toggleWeekday(w.code)}
                      className={cn(
                        'h-9 w-9 rounded-full border text-xs font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background text-foreground hover:bg-muted',
                      )}
                      aria-pressed={active}
                      aria-label={t(`booking.form.recurring_weekday_${w.code}`)}
                    >
                      {t(`booking.form.recurring_weekday_short_${w.code}`)}
                    </button>
                  );
                })}
              </div>
              {r.byWeekday.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {t('booking.form.recurring_weekdays_default_hint')}
                </p>
              )}
            </div>
          )}

          {/* End date */}
          <div className="space-y-1.5">
            <Label htmlFor="recurrence-end-date" className="text-xs text-muted-foreground">
              <CalendarRange className="mr-1 inline h-3 w-3" />
              {t('booking.form.recurring_end_date')}
            </Label>
            <Input
              id="recurrence-end-date"
              type="date"
              value={r.endDate}
              min={startDate}
              onChange={(e) => onChange({ ...r, endDate: e.target.value })}
              className="w-full sm:w-56"
            />
          </div>

          {/* Exclude dates */}
          <div className="space-y-1.5">
            <Label htmlFor="recurrence-exclude" className="text-xs text-muted-foreground">
              <CalendarDays className="mr-1 inline h-3 w-3" />
              {t('booking.form.recurring_exclude_dates')}
            </Label>
            <div className="flex gap-2">
              <Input
                id="recurrence-exclude"
                type="date"
                onChange={(e) => {
                  if (e.target.value) {
                    addExcludeDate(e.target.value);
                    e.target.value = '';
                  }
                }}
                className="w-full sm:w-56"
              />
            </div>
            {r.excludeDates.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {r.excludeDates.map((iso) => (
                  <Badge key={iso} variant="secondary" className="gap-1 pr-1 text-xs">
                    {fmtDate(iso)}
                    <button
                      type="button"
                      onClick={() => removeExcludeDate(iso)}
                      className="rounded-full p-0.5 hover:bg-background/40"
                      aria-label={t('common.remove')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* skipConflicts */}
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-2 focus:ring-ring"
              checked={r.skipConflicts}
              onChange={(e) => onChange({ ...r, skipConflicts: e.target.checked })}
            />
            <span>{t('booking.form.recurring_skip_conflicts_label')}</span>
          </label>

          {/* Preview */}
          {r.endDate && (
            <div className="rounded-md border bg-background/60 p-2.5 text-xs">
              <p className="font-medium">
                {t('booking.form.recurring_preview_count', { count: previewDates.length })}
                {previewDates.length === MAX_OCCURRENCES && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400">
                    ({t('booking.form.recurring_preview_cap')})
                  </span>
                )}
              </p>
              {previewDates.length > 0 && (
                <p className="mt-1 text-muted-foreground">
                  {previewDates.slice(0, 4).map(fmtDate).join(' · ')}
                  {previewDates.length > 4 && ` · …`}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
