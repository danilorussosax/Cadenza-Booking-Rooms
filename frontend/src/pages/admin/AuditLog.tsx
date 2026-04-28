import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CalendarRange, ChevronLeft, ChevronRight, ClipboardList, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { auditLogApi, type AuditLogListParams } from '@/api/auditLog';
import { dayjs } from '@/lib/date';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AdminBookingsContent } from '@/pages/admin/Bookings';
import type { AuditLogEntry } from '@/types';

// Macro-tab in stile pagina /admin/rules: card grandi con icona+label,
// active state con bg-background + ring, sotto un header descrittivo.
type ActivityTab = 'approvals' | 'log';
interface ActivityTabDef {
  value: ActivityTab;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}
const ACTIVITY_TABS: ActivityTabDef[] = [
  {
    value: 'approvals',
    labelKey: 'admin.activity.tab_approvals',
    descriptionKey: 'admin.activity.tab_approvals_description',
    icon: CalendarRange,
    iconColor: 'text-primary',
    iconBg: 'bg-primary/10',
  },
  {
    value: 'log',
    labelKey: 'admin.activity.tab_log',
    descriptionKey: 'admin.activity.tab_log_description',
    icon: ClipboardList,
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
  },
];

const ACTION_VARIANT: Record<
  AuditLogEntry['action'],
  'success' | 'secondary' | 'muted' | 'default'
> = {
  POST: 'success',
  PUT: 'secondary',
  PATCH: 'secondary',
  DELETE: 'default',
};

const PAGE_SIZE = 50;

// =============================================================================
// /admin/audit-log — pagina tabbed:
//   1. Tab "Approvazioni"     → AdminBookingsContent (bulk-cancel prenotazioni
//                                confermate; era la vecchia /admin/bookings)
//   2. Tab "Registro attività" → tabella audit log filtri + paginazione
//
// La rotta /admin/bookings ora redirige a questa pagina (vedi App.tsx) e la
// voce di sidebar "Prenotazioni" è stata rimossa: tutto vive qui.
// =============================================================================
export default function AdminAuditLog() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ActivityTab>('approvals');
  const activeTab = ACTIVITY_TABS.find((tdef) => tdef.value === tab) ?? ACTIVITY_TABS[0];
  const ActiveIcon = activeTab.icon;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          {t('admin.activity.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('admin.activity.subtitle')}</p>
      </header>

      {/* Strip macro-tab in stile /admin/rules: card grandi con icona+label,
          active state con bg-background + ring + colore icona acceso. */}
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-1.5 sm:grid-cols-2">
        {ACTIVITY_TABS.map((tdef) => {
          const Icon = tdef.icon;
          const isActive = tdef.value === tab;
          return (
            <button
              key={tdef.value}
              type="button"
              onClick={() => {
                setTab(tdef.value);
              }}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg px-3 py-2.5 text-left transition-all',
                isActive
                  ? 'bg-background shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              <Icon className={cn('h-4 w-4', isActive ? tdef.iconColor : '')} />
              <span className={cn('text-sm font-medium', isActive && 'text-foreground')}>
                {t(tdef.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Header descrittivo della tab attiva. */}
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <div className={cn('mt-0.5 rounded-lg p-2', activeTab.iconBg)}>
            <ActiveIcon className={cn('h-4 w-4', activeTab.iconColor)} />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-display text-lg font-medium leading-tight">
              {t(activeTab.labelKey)}
            </h2>
            <p className="text-xs text-muted-foreground">{t(activeTab.descriptionKey)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Contenuti per tab */}
      {tab === 'approvals' && <AdminBookingsContent />}
      {tab === 'log' && <AuditLogTab />}
    </div>
  );
}

// Logica audit log estratta come componente per essere usata come tab.
function AuditLogTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AuditLogListParams>({});
  const [draftFilters, setDraftFilters] = useState<AuditLogListParams>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const query = useQuery({
    queryKey: ['admin', 'audit-log', page, filters],
    queryFn: () => auditLogApi.list({ ...filters, page, pageSize: PAGE_SIZE }),
    staleTime: 15_000,
    placeholderData: (prev) => prev, // mantiene la lista durante refetch
  });

  const targetTypesQuery = useQuery({
    queryKey: ['admin', 'audit-log', 'target-types'],
    queryFn: () => auditLogApi.targetTypes(),
    staleTime: 5 * 60_000,
  });

  const totalPages = query.data?.totalPages ?? 1;

  const applyFilters = () => {
    setFilters(draftFilters);
    setPage(1);
  };

  const resetFilters = () => {
    setFilters({});
    setDraftFilters({});
    setPage(1);
  };

  const toggleExpanded = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((v) => v !== undefined && v !== '' && v !== null),
    [filters],
  );

  return (
    <div className="space-y-6">
      {/* Filtri */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('admin.audit_log.filter.action')}
            </Label>
            <Select
              value={draftFilters.action ?? 'all'}
              onValueChange={(v) => {
                setDraftFilters((d) => ({
                  ...d,
                  action: v === 'all' ? undefined : (v as AuditLogEntry['action']),
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('admin.audit_log.filter.target_type')}
            </Label>
            <Select
              value={draftFilters.targetType ?? 'all'}
              onValueChange={(v) => {
                setDraftFilters((d) => ({
                  ...d,
                  targetType: v === 'all' ? undefined : v,
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {(targetTypesQuery.data?.targetTypes ?? []).map((tt) => (
                  <SelectItem key={tt} value={tt}>
                    {tt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('admin.audit_log.filter.actor_id')}
            </Label>
            <Input
              type="number"
              min={1}
              placeholder={t('admin.audit_log.filter.actor_id_placeholder')}
              value={draftFilters.actorId ?? ''}
              onChange={(e) => {
                setDraftFilters((d) => ({
                  ...d,
                  actorId: e.target.value ? Number(e.target.value) : undefined,
                }));
              }}
            />
          </div>

          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('admin.audit_log.filter.date_from')}
            </Label>
            <Input
              type="datetime-local"
              value={draftFilters.dateFrom ?? ''}
              onChange={(e) => {
                setDraftFilters((d) => ({ ...d, dateFrom: e.target.value || undefined }));
              }}
            />
          </div>

          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('admin.audit_log.filter.date_to')}
            </Label>
            <Input
              type="datetime-local"
              value={draftFilters.dateTo ?? ''}
              onChange={(e) => {
                setDraftFilters((d) => ({ ...d, dateTo: e.target.value || undefined }));
              }}
            />
          </div>

          <div className="lg:col-span-3">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('admin.audit_log.filter.path_search')}
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={draftFilters.q ?? ''}
                onChange={(e) => {
                  setDraftFilters((d) => ({ ...d, q: e.target.value || undefined }));
                }}
                placeholder={t('admin.audit_log.filter.path_placeholder')}
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex items-end justify-end gap-2 lg:col-span-2">
            {hasActiveFilters && (
              <Button type="button" variant="ghost" onClick={resetFilters}>
                {t('admin.audit_log.filter.reset')}
              </Button>
            )}
            <Button type="button" onClick={applyFilters}>
              {t('admin.audit_log.filter.apply')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabella */}
      {query.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && (query.data?.entries.length ?? 0) === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t('admin.audit_log.empty_title')}</p>
            <p className="text-sm text-muted-foreground">{t('admin.audit_log.empty_subtitle')}</p>
          </CardContent>
        </Card>
      )}

      {!query.isLoading && (query.data?.entries.length ?? 0) > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('admin.audit_log.col_when')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.audit_log.col_actor')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.audit_log.col_action')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.audit_log.col_target')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.audit_log.col_path')}</th>
                  <th className="px-4 py-3 text-center font-medium">
                    {t('admin.audit_log.col_status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data?.entries.map((e) => (
                  <AuditRow
                    key={e.id}
                    entry={e}
                    expanded={expanded.has(e.id)}
                    onToggle={() => {
                      toggleExpanded(e.id);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Paginazione */}
      {!query.isLoading && (query.data?.total ?? 0) > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {t('admin.audit_log.pagination_summary', {
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, query.data?.total ?? 0),
              total: query.data?.total,
            })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
              }}
              disabled={page <= 1 || query.isFetching}
            >
              <ChevronLeft className="h-3 w-3" />
              {t('common.previous')}
            </Button>
            <span className="px-2 tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setPage((p) => Math.min(totalPages, p + 1));
              }}
              disabled={page >= totalPages || query.isFetching}
            >
              {t('common.next')}
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const actorLabel = entry.actor
    ? `${entry.actor.firstName} ${entry.actor.lastName}`
    : entry.actorId != null
      ? `#${entry.actorId}`
      : '—';
  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
          {dayjs(entry.createdAt).format('DD/MM/YYYY HH:mm:ss')}
        </td>
        <td className="px-4 py-3">
          <p className="font-medium">{actorLabel}</p>
          {entry.actor?.email && (
            <p className="truncate text-[11px] text-muted-foreground">{entry.actor.email}</p>
          )}
        </td>
        <td className="px-4 py-3">
          <Badge variant={ACTION_VARIANT[entry.action]} className="font-mono text-[11px]">
            {entry.action}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <span className="font-medium">{entry.targetType}</span>
          {entry.targetId != null && (
            <span className="text-muted-foreground"> #{entry.targetId}</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span className="truncate font-mono text-[11px]">{entry.path}</span>
        </td>
        <td className="px-4 py-3 text-center">
          <span
            className={cn(
              'tabular-nums font-mono text-xs',
              entry.statusCode >= 400
                ? 'text-destructive'
                : 'text-emerald-700 dark:text-emerald-400',
            )}
          >
            {entry.statusCode}
          </span>
        </td>
      </motion.tr>
      {expanded && (
        <tr className="border-b bg-muted/20">
          <td colSpan={6} className="px-4 py-3">
            <div className="space-y-2 text-xs">
              {entry.payload != null && Object.keys(entry.payload).length > 0 && (
                <div>
                  <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                    payload
                  </span>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-background p-2 text-[11px]">
                    {JSON.stringify(entry.payload, null, 2)}
                  </pre>
                </div>
              )}
              {entry.response && Object.keys(entry.response).length > 0 && (
                <div>
                  <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                    response
                  </span>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-background p-2 text-[11px]">
                    {JSON.stringify(entry.response, null, 2)}
                  </pre>
                </div>
              )}
              <div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                <div>
                  IP: <span className="font-mono">{entry.ip ?? '—'}</span>
                </div>
                <div>
                  UA: <span className="font-mono truncate">{entry.userAgent ?? '—'}</span>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
