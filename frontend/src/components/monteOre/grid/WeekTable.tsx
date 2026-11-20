import { memo } from 'react';
import { MoreVertical } from 'lucide-react';
import type { CalendarWeek, MonteOreSlot } from '@/api/monteOre';
import { activeHours } from '@/lib/monteOreProjection';

const DAYS_HEAD = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

interface WeekTableProps {
  weeks: CalendarWeek[];
  slotsByDate: Map<string, MonteOreSlot[]>;
  onToggle: (slotId: number) => void;
  onRequestMove?: (slot: MonteOreSlot) => void;
  disabled: boolean;
}

/** Tabella settimana × giorno (Lun-Sab) della griglia di pianificazione. */
export function WeekTable({
  weeks,
  slotsByDate,
  onToggle,
  onRequestMove,
  disabled,
}: WeekTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      {/* table-fixed + colgroup: i 6 giorni (Lun-Sab) si dividono in
                modo identico lo spazio rimanente dopo le colonne S, Settimana
                e Ore — senza questo, le colonne con celle bloccate si
                "schiacciavano" più di quelle con slot lunghi. */}
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-12" />
          <col className="w-32" />
          {/* I 6 giorni Lun-Sab senza width esplicito si dividono in
                    parti uguali lo spazio residuo grazie a table-fixed. */}
          {DAYS_HEAD.map((d) => (
            <col key={d} />
          ))}
          <col className="w-16" />
        </colgroup>
        <thead className="border-b bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-center">S</th>
            <th className="px-3 py-2 text-left">Settimana</th>
            {DAYS_HEAD.map((d) => (
              <th key={d} className="px-2 py-2 text-center">
                {d}
              </th>
            ))}
            <th className="px-2 py-2 text-right">Ore</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <WeekRow
              key={w.weekStart}
              week={w}
              slotsByDate={slotsByDate}
              onToggle={onToggle}
              onRequestMove={onRequestMove}
              disabled={disabled}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface WeekRowProps {
  week: CalendarWeek;
  slotsByDate: Map<string, MonteOreSlot[]>;
  onToggle: (slotId: number) => void;
  onRequestMove?: (slot: MonteOreSlot) => void;
  disabled: boolean;
}

const WeekRow = memo(function WeekRow({
  week,
  slotsByDate,
  onToggle,
  onRequestMove,
  disabled,
}: WeekRowProps) {
  let weekTotal = 0;
  for (const d of week.days) {
    const slots = slotsByDate.get(d.date) ?? [];
    weekTotal += activeHours(slots);
  }
  return (
    <tr className="border-b last:border-0">
      <td className="px-2 py-1.5 text-center font-medium tabular-nums text-muted-foreground">
        {week.weekIndex}
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground">{week.weekLabel}</td>
      {week.days.map((d) => (
        <td key={d.date} className="px-1 py-1 align-top">
          <DayCell
            day={d}
            slots={slotsByDate.get(d.date) ?? []}
            onToggle={onToggle}
            onRequestMove={onRequestMove}
            disabled={disabled}
          />
        </td>
      ))}
      <td className="px-2 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
        {weekTotal > 0 ? `${weekTotal.toFixed(1)}h` : '—'}
      </td>
    </tr>
  );
});

interface DayCellProps {
  day: { date: string; isLocked: boolean; lockReason: string | null };
  slots: MonteOreSlot[];
  onToggle: (slotId: number) => void;
  onRequestMove?: (slot: MonteOreSlot) => void;
  disabled: boolean;
}

const DayCell = memo(function DayCell({
  day,
  slots,
  onToggle,
  onRequestMove,
  disabled,
}: DayCellProps) {
  if (day.isLocked) {
    return (
      <div
        className="flex min-h-[44px] items-center justify-center rounded-md bg-destructive/10 px-1 py-1 text-[10px] font-medium text-destructive"
        title={day.lockReason ?? 'Bloccato'}
      >
        {day.lockReason?.slice(0, 18) ?? '—'}
      </div>
    );
  }
  if (slots.length === 0) {
    return <div className="min-h-[44px] rounded-md bg-muted/20" />;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {slots.map((s) => {
        const active = s.isActive && !s.isLocked;
        const locked = s.isLocked;
        const canMove = active && onRequestMove && !disabled;
        return (
          <div key={s.id} className="relative group">
            <button
              type="button"
              disabled={disabled || locked}
              onClick={() => onToggle(s.id)}
              className={`block w-full min-h-[36px] rounded-md px-1.5 py-1.5 text-[11px] font-medium tabular-nums transition active:scale-95 sm:min-h-0 sm:py-1 ${
                locked
                  ? 'cursor-not-allowed bg-destructive/10 text-destructive'
                  : active
                    ? 'bg-primary text-primary-foreground shadow-xs ring-1 ring-primary hover:bg-primary/90 pr-6'
                    : 'border border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
              title={`${s.startTime}–${s.endTime}${locked && s.lockReason ? ` (${s.lockReason})` : ''}`}
            >
              {s.startTime}–{s.endTime}
            </button>
            {canMove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestMove(s);
                }}
                className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
                title="Opzioni spostamento"
                aria-label="Apri opzioni di spostamento"
              >
                <MoreVertical className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});
