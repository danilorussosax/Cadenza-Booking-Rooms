import { Activity, Building2, CalendarDays, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PublicStats } from '@/api/public';
import { cn } from '@/lib/utils';

// ===========================
// LegendStats — statistiche compatte renderizzate inline nella legenda del
// BuildingTable. Sostituisce la riga di KpiCard separata che occupava una
// banda verticale dedicata. Format: `icon valore label` separato da `·`,
// con le 4 voci classiche (in uso, oggi, settimana, aule attive).
// Se `stats` è undefined (loading/offline) mostra placeholder neutri.
// ===========================
export function LegendStats({ stats }: { stats: PublicStats | undefined }) {
  const { t } = useTranslation();
  const items = [
    {
      Icon: Activity,
      tone: 'text-emerald-600 dark:text-emerald-300',
      value: stats ? `${stats.today.inUse}/${stats.today.roomsTotal}` : '—',
      label: stats ? t('display.kpi.in_use_subtitle', { pct: stats.today.occupancyPct }) : '',
      title: t('display.kpi.in_use'),
    },
    {
      Icon: CalendarDays,
      tone: 'text-sky-600 dark:text-sky-300',
      value: stats ? String(stats.today.bookings) : '—',
      label: stats ? t('display.kpi.bookings_today_subtitle', { hours: stats.today.hours }) : '',
      title: t('display.kpi.bookings_today'),
    },
    {
      Icon: TrendingUp,
      tone: 'text-violet-600 dark:text-violet-300',
      value: stats ? String(stats.week.bookings) : '—',
      label: stats ? t('display.kpi.week_subtitle', { hours: stats.week.hours }) : '',
      title: t('display.kpi.week'),
    },
    {
      Icon: Building2,
      tone: 'text-amber-600 dark:text-amber-300',
      value: stats ? String(stats.today.roomsTotal) : '—',
      label: t('display.kpi.active_rooms_subtitle'),
      title: t('display.kpi.active_rooms'),
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 normal-case 2xl:gap-x-5">
      {items.map(({ Icon, tone, value, label, title }, i) => (
        <span key={title} className="inline-flex items-center gap-1.5" title={title}>
          {i > 0 && (
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
          )}
          <Icon className={cn('h-3 w-3 shrink-0 2xl:h-3.5 2xl:w-3.5', tone)} />
          <span className="font-display text-[0.75rem] font-medium text-foreground 2xl:text-sm">
            {value}
          </span>
          {label && <span className="text-muted-foreground/90">{label}</span>}
        </span>
      ))}
    </div>
  );
}
