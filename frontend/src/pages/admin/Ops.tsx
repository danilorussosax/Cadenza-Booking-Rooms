import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  HardDrive,
  Inbox,
  RefreshCw,
  Server,
  Timer,
  XCircle,
} from 'lucide-react';
import { opsApi, type OpsScheduler, type OpsSnapshot, type SlowQueryAggregateRow } from '@/api/ops';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { httpErrorMessage } from '@/lib/api';

// Polling 10s. Il backend ha già memoization 5s → al massimo una query reale
// ogni 10s anche con più admin connessi insieme.
const REFETCH_INTERVAL_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// Formattatori

function fmtBytes(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b)) return '—';
  if (b < 1024) return `${b} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = b / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 86_400)}g`;
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return `tra ${fmtDuration(-ms / 1000)}`;
    const sec = ms / 1000;
    if (sec < 60) return `${Math.round(sec)}s fa`;
    if (sec < 3600) return `${Math.round(sec / 60)}min fa`;
    if (sec < 86_400) return `${(sec / 3600).toFixed(1)}h fa`;
    return `${Math.round(sec / 86_400)}g fa`;
  } catch {
    return iso;
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// Soglia → variant badge: verde sotto warn, giallo tra warn-crit, rosso oltre.
function levelBadge(value: number | null | undefined, warn: number, crit: number, label: string) {
  if (value == null) return <Badge variant="muted">—</Badge>;
  if (value >= crit) {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {label}
      </Badge>
    );
  }
  if (value >= warn) {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="gap-1">
      <CheckCircle2 className="h-3 w-3" />
      {label}
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Widget: VPS

function VpsCard({ data }: { data: OpsSnapshot['vps'] }) {
  const { t } = useTranslation();
  const memPct = data.memory.usedPercent ?? 0;
  const diskPct = data.disk?.usedPercent ?? 0;
  const load1 = data.loadAvg[0] ?? 0;
  const cpuPct = data.cpuCount > 0 ? Math.round((load1 / data.cpuCount) * 100) : 0;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Server className="h-4 w-4 text-muted-foreground" />
          {t('admin.ops.vps.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm pt-0 sm:pt-0">
        <Row
          label={
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
              {t('admin.ops.vps.cpu')}
            </span>
          }
          value={
            <span className="flex items-center gap-2 tabular-nums">
              {load1.toFixed(2)} / {data.cpuCount}{' '}
              <span className="text-xs text-muted-foreground">({cpuPct}%)</span>
              {levelBadge(cpuPct, 70, 90, `${cpuPct}%`)}
            </span>
          }
        />
        <Row
          label={
            <span className="inline-flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              {t('admin.ops.vps.memory')}
            </span>
          }
          value={
            <span className="flex items-center gap-2 tabular-nums">
              {fmtBytes(data.memory.usedBytes)} / {fmtBytes(data.memory.totalBytes)}
              {levelBadge(memPct, 75, 90, `${memPct}%`)}
            </span>
          }
        />
        {data.disk && (
          <Row
            label={
              <span className="inline-flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                {t('admin.ops.vps.disk')}
              </span>
            }
            value={
              <span className="flex items-center gap-2 tabular-nums">
                {fmtBytes(data.disk.usedBytes)} / {fmtBytes(data.disk.totalBytes)}
                {levelBadge(diskPct, 75, 90, `${diskPct}%`)}
              </span>
            }
          />
        )}
        <Row
          label={t('admin.ops.vps.uptime_system')}
          value={<span className="tabular-nums">{fmtDuration(data.uptimeSec)}</span>}
        />
        <Row
          label={t('admin.ops.vps.uptime_process')}
          value={<span className="tabular-nums">{fmtDuration(data.processUptimeSec)}</span>}
        />
        <Row
          label={t('admin.ops.vps.node_version')}
          value={<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{data.nodeVersion}</code>}
        />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Widget: Postgres

function PostgresCard({ data }: { data: OpsSnapshot['postgres'] }) {
  const { t } = useTranslation();
  if (!data.available) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            {t('admin.ops.postgres.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0 sm:pt-0">
          {t('admin.ops.postgres.unavailable', { dialect: data.dialect })}
        </CardContent>
      </Card>
    );
  }
  const conns = data.connections;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Database className="h-4 w-4 text-muted-foreground" />
          {t('admin.ops.postgres.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm pt-0 sm:pt-0">
        {conns ? (
          <>
            <Row
              label={t('admin.ops.postgres.connections')}
              value={
                <span className="flex items-center gap-2 tabular-nums">
                  {conns.total}
                  {levelBadge(conns.total, 40, 48, `${conns.total}/50`)}
                </span>
              }
            />
            <Row
              label={t('admin.ops.postgres.active')}
              value={<span className="tabular-nums">{conns.active}</span>}
            />
            <Row
              label={t('admin.ops.postgres.idle')}
              value={<span className="tabular-nums">{conns.idle}</span>}
            />
            {conns.idle_in_tx > 0 && (
              <Row
                label={t('admin.ops.postgres.idle_in_tx')}
                value={
                  <span className="flex items-center gap-2 tabular-nums">
                    {conns.idle_in_tx}
                    <Badge variant="warning" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {t('admin.ops.postgres.warn_idle_in_tx')}
                    </Badge>
                  </span>
                }
              />
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {data.connectionsError ?? t('admin.ops.postgres.no_stats')}
          </p>
        )}
        {typeof data.dbSizeBytes === 'number' && (
          <Row
            label={t('admin.ops.postgres.db_size')}
            value={<span className="tabular-nums">{fmtBytes(data.dbSizeBytes)}</span>}
          />
        )}
        {data.topTables && data.topTables.length > 0 && (
          <div className="space-y-1 pt-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t('admin.ops.postgres.top_tables')}
            </p>
            <ul className="space-y-0.5 text-xs">
              {data.topTables.slice(0, 3).map((tab) => (
                <li key={tab.table} className="flex justify-between gap-2">
                  <code className="truncate rounded bg-muted px-1.5">{tab.table}</code>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {tab.liveTuples.toLocaleString('it-IT')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Widget: MailOutbox

function MailOutboxCard({ data }: { data: OpsSnapshot['mailOutbox'] }) {
  const { t } = useTranslation();
  if (data.error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            {t('admin.ops.mailOutbox.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive pt-0 sm:pt-0">{data.error}</CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          {t('admin.ops.mailOutbox.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm pt-0 sm:pt-0">
        <Row
          label={t('admin.ops.mailOutbox.pending')}
          value={
            <span className="flex items-center gap-2 tabular-nums">
              {data.pending ?? 0}
              {data.pending != null && data.pending > 0 ? (
                <Badge variant="muted" className="gap-1">
                  <Clock className="h-3 w-3" />
                  {fmtDuration(data.oldestPendingAgeSec)}
                </Badge>
              ) : null}
            </span>
          }
        />
        <Row
          label={t('admin.ops.mailOutbox.dead')}
          value={
            <span className="flex items-center gap-2 tabular-nums">
              {data.dead ?? 0}
              {(data.dead ?? 0) > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {t('admin.ops.mailOutbox.review_required')}
                </Badge>
              )}
            </span>
          }
        />
        <Row
          label={t('admin.ops.mailOutbox.sent')}
          value={
            <span className="text-muted-foreground tabular-nums">
              {(data.sent ?? 0).toLocaleString('it-IT')}
            </span>
          }
        />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Widget: Backup

function BackupCard({ data }: { data: OpsSnapshot['backups'] }) {
  const { t } = useTranslation();
  if (data.error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            {t('admin.ops.backup.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive pt-0 sm:pt-0">{data.error}</CardContent>
      </Card>
    );
  }
  const ageHours = data.lastBackupAgeHours;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          {t('admin.ops.backup.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm pt-0 sm:pt-0">
        {data.lastBackup ? (
          <>
            <Row
              label={t('admin.ops.backup.last_backup')}
              value={
                <span className="flex items-center gap-2 tabular-nums">
                  {fmtRelative(data.lastBackup.createdAt)}
                  {levelBadge(
                    ageHours ?? null,
                    24,
                    36,
                    ageHours != null ? `${ageHours.toFixed(1)}h` : '—',
                  )}
                </span>
              }
            />
            <Row
              label={t('admin.ops.backup.size')}
              value={<span className="tabular-nums">{fmtBytes(data.lastBackup.sizeBytes)}</span>}
            />
            <Row
              label={t('admin.ops.backup.count')}
              value={
                <span className="text-muted-foreground tabular-nums">
                  {data.count} ({fmtBytes(data.totalSizeBytes)})
                </span>
              }
            />
          </>
        ) : (
          <Alert variant="warning">
            <AlertDescription className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {t('admin.ops.backup.empty')}
            </AlertDescription>
          </Alert>
        )}
        {data.verify && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Verifica integrità
            </p>
            <Row
              label="Ultima verifica"
              value={
                data.verify.lastTickAt ? (
                  <span className="flex items-center gap-2 tabular-nums">
                    {fmtRelative(data.verify.lastTickAt)}
                    {data.verify.lastOk === true ? (
                      <Badge variant="success">OK</Badge>
                    ) : data.verify.lastOk === false ? (
                      <Badge variant="destructive">{data.verify.lastReason ?? 'FAIL'}</Badge>
                    ) : (
                      <Badge variant="secondary">?</Badge>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">mai eseguita</span>
                )
              }
            />
            {data.verify.enabled && data.verify.nextTickAt && (
              <Row
                label="Prossima verifica"
                value={
                  <span className="text-muted-foreground tabular-nums">
                    {fmtRelative(data.verify.nextTickAt)}
                  </span>
                }
              />
            )}
            {!data.verify.enabled && (
              <p className="text-xs text-muted-foreground">
                Disabilitata (<code>BACKUP_VERIFY_ENABLED=false</code>)
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Widget: Schedulers

function isStale(s: OpsScheduler): boolean {
  if (!s.enabled) return false;
  if (!s.lastTickAt || !s.intervalMs) return false;
  const age = Date.now() - new Date(s.lastTickAt).getTime();
  // "Stale" se non ha tick-ato da oltre 2× il proprio intervallo nominale.
  return age > s.intervalMs * 2;
}

function SchedulerRow({ s }: { s: OpsScheduler }) {
  const { t } = useTranslation();
  const labelKey = `admin.ops.scheduler.names.${s.name}`;
  const name = t(labelKey, { defaultValue: s.name });
  let badge: React.ReactNode;
  if (s.error) {
    badge = (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {t('admin.ops.scheduler.error')}
      </Badge>
    );
  } else if (!s.enabled) {
    badge = <Badge variant="muted">{t('admin.ops.scheduler.disabled')}</Badge>;
  } else if (isStale(s)) {
    badge = (
      <Badge variant="warning" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        {t('admin.ops.scheduler.stale')}
      </Badge>
    );
  } else if (s.lastError) {
    badge = (
      <Badge variant="warning" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        {t('admin.ops.scheduler.last_error')}
      </Badge>
    );
  } else {
    badge = (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {t('admin.ops.scheduler.ok')}
      </Badge>
    );
  }
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          {s.lastTickAt
            ? `${t('admin.ops.scheduler.last_tick')}: ${fmtRelative(s.lastTickAt)}`
            : t('admin.ops.scheduler.never_ticked')}
        </p>
        {s.lastError && (
          <p className="mt-0.5 max-w-[260px] truncate text-xs text-destructive" title={s.lastError}>
            {s.lastError}
          </p>
        )}
      </div>
      <div className="shrink-0">{badge}</div>
    </div>
  );
}

function SchedulersCard({ data }: { data: OpsSnapshot['schedulers'] }) {
  const { t } = useTranslation();
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Timer className="h-4 w-4 text-muted-foreground" />
          {t('admin.ops.scheduler.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        <div className="divide-y">
          {data.map((s) => (
            <SchedulerRow key={s.name} s={s} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function AdminOps() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['admin', 'ops', 'snapshot'],
    queryFn: () => opsApi.snapshot(),
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-medium">{t('admin.ops.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.ops.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {query.data && (
            <span className="tabular-nums">
              {t('admin.ops.last_update')}: {fmtDate(query.data.capturedAt)}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void query.refetch();
            }}
            disabled={query.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
            {t('admin.ops.refresh')}
          </Button>
        </div>
      </header>

      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {httpErrorMessage(query.error)}
          </AlertDescription>
        </Alert>
      )}

      {query.isLoading && !query.data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : query.data ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <VpsCard data={query.data.vps} />
            <PostgresCard data={query.data.postgres} />
            <MailOutboxCard data={query.data.mailOutbox} />
            <BackupCard data={query.data.backups} />
            <SchedulersCard data={query.data.schedulers} />
          </div>
          <SlowQueriesCard />
        </>
      ) : null}
    </div>
  );
}

// =====================================================
// Slow queries card (v1.12)
// =====================================================
//
// Polling 60s — il ring buffer in-memory non cambia di colpo e la card
// è "diagnostica", non "live monitoring". Mostra:
//   - aggregato per route (top 10 per p95)
//   - top 10 query lente recenti (ultime 24h)
function SlowQueriesCard() {
  const { t } = useTranslation();

  const aggregateQuery = useQuery({
    queryKey: ['admin', 'ops', 'slow-queries', 'aggregate', 'route'],
    queryFn: () => opsApi.slowQueriesAggregate({ by: 'route', since: '24h', limit: 10 }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const recentQuery = useQuery({
    queryKey: ['admin', 'ops', 'slow-queries', 'recent'],
    queryFn: () => opsApi.slowQueries({ limit: 10, since: '24h' }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const stats = aggregateQuery.data?.stats ?? recentQuery.data?.stats;

  return (
    <Card className="mt-2">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="inline-flex items-center gap-2 text-base">
          <Timer className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          {t('admin.ops.slow_queries.title')}
        </CardTitle>
        {stats && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('admin.ops.slow_queries.threshold', { ms: stats.thresholdMs })} ·{' '}
            {t('admin.ops.slow_queries.buffer', {
              used: stats.bufferUsed,
              size: stats.bufferSize,
            })}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-6 pt-0 sm:pt-0">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('admin.ops.slow_queries.aggregate_by_route')}
          </h3>
          {aggregateQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : aggregateQuery.data?.aggregate?.length ? (
            <AggregateTable rows={aggregateQuery.data.aggregate} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('admin.ops.slow_queries.empty')}</p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('admin.ops.slow_queries.recent')}
          </h3>
          {recentQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : recentQuery.data?.items?.length ? (
            <ul className="space-y-1.5">
              {recentQuery.data.items.map((item, idx) => (
                <li
                  key={`${item.at}-${idx}`}
                  className="rounded-md border border-border bg-muted/30 p-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-amber-700 tabular-nums dark:text-amber-300">
                      {item.durationMs} ms
                    </span>
                    <span className="text-muted-foreground">
                      {item.route ?? '-'} · {fmtRelative(item.at)}
                    </span>
                  </div>
                  <code className="mt-1 block truncate text-[11px] text-foreground/80">
                    {item.sql}
                  </code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('admin.ops.slow_queries.empty')}</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function AggregateTable({ rows }: { rows: SlowQueryAggregateRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-1.5 pr-3 text-left font-medium">
              {t('admin.ops.slow_queries.col_route')}
            </th>
            <th className="py-1.5 pr-3 text-right font-medium tabular-nums">
              {t('admin.ops.slow_queries.col_count')}
            </th>
            <th className="py-1.5 pr-3 text-right font-medium tabular-nums">p50</th>
            <th className="py-1.5 pr-3 text-right font-medium tabular-nums">p95</th>
            <th className="py-1.5 text-right font-medium tabular-nums">max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/40 last:border-0">
              <td className="py-1.5 pr-3 font-mono truncate max-w-[18rem]">{row.key}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{row.count}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{row.p50}ms</td>
              <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{row.p95}ms</td>
              <td className="py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-300">
                {row.maxMs}ms
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
