import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';
import {
  Activity,
  Building2,
  CalendarRange,
  Download,
  FileText,
  Flame,
  TrendingUp,
  Users as UsersIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { analyticsApi } from '@/api/analytics';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { dayjs } from '@/lib/date';
import { HeatmapGrid } from '@/components/admin/HeatmapGrid';

export default function AdminAnalytics() {
  const { t } = useTranslation();

  // Default: ultimi 30 giorni
  const [dateFrom, setDateFrom] = useState(() => dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [appliedRange, setAppliedRange] = useState({ from: dateFrom, to: dateTo });

  const query = useQuery({
    queryKey: ['admin', 'analytics', appliedRange.from, appliedRange.to],
    queryFn: () => analyticsApi.get(appliedRange.from, appliedRange.to),
    staleTime: 30_000,
  });

  const data = query.data;

  // Heatmap: trova max value per scaling colore
  const heatmapMax = useMemo(() => {
    if (!data?.heatmap) return 0;
    return Math.max(0, ...data.heatmap.flat().map((c) => c.count));
  }, [data]);

  const trendData = useMemo(() => {
    return (data?.trend ?? []).map((p) => ({
      label: dayjs(p.weekStart).format('DD MMM'),
      hours: p.hours,
      count: p.count,
    }));
  }, [data]);

  const downloadFile = async (kind: 'csv' | 'pdf') => {
    try {
      const blob =
        kind === 'csv'
          ? await analyticsApi.downloadCsv(appliedRange.from, appliedRange.to)
          : await analyticsApi.downloadPdf(appliedRange.from, appliedRange.to);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-${appliedRange.from}-${appliedRange.to}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore export');
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
            <Flame className="h-6 w-6 text-rose-600 dark:text-rose-400" />
            {t('admin.analytics.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('admin.analytics.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => downloadFile('csv')}>
            <Download className="h-4 w-4" />
            {t('admin.analytics.export_csv')}
          </Button>
          <Button variant="outline" onClick={() => downloadFile('pdf')}>
            <FileText className="h-4 w-4" />
            {t('admin.analytics.export_pdf')}
          </Button>
        </div>
      </header>

      {/* Filtri range */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3 sm:items-end">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('admin.analytics.filter.date_from')}
            </Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
              }}
            />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('admin.analytics.filter.date_to')}
            </Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
              }}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={() => {
                setAppliedRange({ from: dateFrom, to: dateTo });
              }}
              className="w-full"
            >
              <CalendarRange className="h-4 w-4" />
              {t('admin.analytics.filter.apply')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPI summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Activity className="h-5 w-5" />}
          label={t('admin.analytics.kpi.confirmed')}
          value={data?.summary.confirmedBookings ?? '—'}
          color="emerald"
          loading={query.isLoading}
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5" />}
          label={t('admin.analytics.kpi.ghosted')}
          value={data?.summary.ghostedBookings ?? '—'}
          color="amber"
          loading={query.isLoading}
        />
        <KpiCard
          icon={<Flame className="h-5 w-5" />}
          label={t('admin.analytics.kpi.no_show_rate')}
          value={data ? `${data.summary.noShowRatePct}%` : '—'}
          color="rose"
          loading={query.isLoading}
        />
        <KpiCard
          icon={<CalendarRange className="h-5 w-5" />}
          label={t('admin.analytics.kpi.total_created')}
          value={data?.summary.totalCreated ?? '—'}
          color="sky"
          loading={query.isLoading}
        />
      </div>

      {/* Heatmap settimanale */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div>
            <h2 className="font-display text-xl font-medium">
              {t('admin.analytics.heatmap.title')}
            </h2>
            <p className="text-xs text-muted-foreground">{t('admin.analytics.heatmap.help')}</p>
          </div>
          {query.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <HeatmapGrid heatmap={data?.heatmap ?? []} max={heatmapMax} />
          )}
        </CardContent>
      </Card>

      {/* Trend ultime 8 settimane */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div>
            <h2 className="font-display text-xl font-medium">{t('admin.analytics.trend.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('admin.analytics.trend.help')}</p>
          </div>
          {query.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : trendData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('admin.analytics.no_data')}
            </p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="hours"
                    stroke="#a855f7"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top 10 rooms + users */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-sky-600 dark:text-sky-400" />
              <h2 className="font-display text-lg font-medium">
                {t('admin.analytics.top_rooms.title')}
              </h2>
            </div>
            {query.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (data?.topRooms.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('admin.analytics.no_data')}
              </p>
            ) : (
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              <TopRoomsChart data={data!.topRooms} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <UsersIcon className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              <h2 className="font-display text-lg font-medium">
                {t('admin.analytics.top_users.title')}
              </h2>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('admin.analytics.top_users.privacy')}
            </p>
            {query.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (data?.topUsers.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('admin.analytics.no_data')}
              </p>
            ) : (
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              <TopUsersList data={data!.topUsers} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  color,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: 'emerald' | 'amber' | 'rose' | 'sky';
  loading: boolean;
}) {
  const colorClasses = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  } as const;
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg',
            colorClasses[color],
          )}
        >
          {icon}
        </span>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-16" />
          ) : (
            <p className="font-display text-2xl font-medium tabular-nums">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TopRoomsChart({
  data,
}: {
  data: { name: string; building: string; hours: number; count: number }[];
}) {
  const chartData = data.map((r) => ({
    label: r.name,
    fullLabel: `${r.name} · ${r.building}`,
    hours: r.hours,
    count: r.count,
  }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} />
          <XAxis type="number" fontSize={10} />
          <YAxis dataKey="label" type="category" width={80} fontSize={10} />
          <Tooltip
            formatter={(value) => [`${Number(value)} h`, 'Ore']}
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
            labelFormatter={(_, p) => p[0]?.payload?.fullLabel ?? ''}
          />
          <Bar dataKey="hours" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TopUsersList({
  data,
}: {
  data: {
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    matricola: string | null;
    hours: number;
    count: number;
  }[];
}) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y rounded-md border">
      {data.map((u, i) => (
        <li key={u.email} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {u.firstName} {u.lastName}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {u.matricola ? `${u.matricola} · ` : ''}
                {u.role}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
            <span className="font-medium">{u.hours}h</span>
            <span className="text-[11px] text-muted-foreground">
              {t('admin.analytics.top_users.bookings_count', { count: u.count })}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
