import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ClipboardList, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { auditLogApi, type AuditLogListParams } from '@/api/auditLog';
import { dayjs } from '@/lib/date';
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
import type { AuditLogEntry } from '@/types';

const PAGE_SIZE = 50;

const ACTION_VARIANT: Record<AuditLogEntry['action'], 'success' | 'secondary' | 'destructive'> = {
  POST: 'success',
  PUT: 'secondary',
  PATCH: 'secondary',
  DELETE: 'destructive',
};

// Contenuto della pagina senza header: filtri + tabella + paginazione.
// Riutilizzato come tab dentro /admin/server-settings.
export function AuditLogPanel() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AuditLogListParams>({});
  const [draft, setDraft] = useState<AuditLogListParams>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const query = useQuery({
    queryKey: ['admin', 'audit-log', page, filters],
    queryFn: () => auditLogApi.list({ ...filters, page, pageSize: PAGE_SIZE }),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  const targetTypesQuery = useQuery({
    queryKey: ['admin', 'audit-log', 'target-types'],
    queryFn: () => auditLogApi.targetTypes(),
    staleTime: 5 * 60_000,
  });

  const totalPages = query.data?.totalPages ?? 1;
  const total = query.data?.total ?? 0;
  const entries = query.data?.entries ?? [];

  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((v) => v !== undefined && v !== '' && v !== null),
    [filters],
  );

  const applyFilters = () => {
    setFilters(draft);
    setPage(1);
  };

  const resetFilters = () => {
    setDraft({});
    setFilters({});
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

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-3 p-4 sm:p-6 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('admin.audit_log.filter.action')}
            </Label>
            <Select
              value={draft.action ?? 'all'}
              onValueChange={(v) => {
                setDraft((d) => ({
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
              value={draft.targetType ?? 'all'}
              onValueChange={(v) => {
                setDraft((d) => ({ ...d, targetType: v === 'all' ? undefined : v }));
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
              value={draft.actorId ?? ''}
              onChange={(e) => {
                setDraft((d) => ({
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
              value={draft.dateFrom ?? ''}
              onChange={(e) => {
                setDraft((d) => ({ ...d, dateFrom: e.target.value || undefined }));
              }}
            />
          </div>

          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('admin.audit_log.filter.date_to')}
            </Label>
            <Input
              type="datetime-local"
              value={draft.dateTo ?? ''}
              onChange={(e) => {
                setDraft((d) => ({ ...d, dateTo: e.target.value || undefined }));
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
                value={draft.q ?? ''}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, q: e.target.value || undefined }));
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

      {query.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && entries.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t('admin.audit_log.empty_title')}</p>
            <p className="text-sm text-muted-foreground">{t('admin.audit_log.empty_subtitle')}</p>
          </CardContent>
        </Card>
      )}

      {!query.isLoading && entries.length > 0 && (
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
                {entries.map((e) => (
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

      {!query.isLoading && total > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {t('admin.audit_log.pagination_summary', {
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, total),
              total,
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

// Pagina standalone /admin/audit-log: aggiunge l'header al pannello.
export default function AdminAuditLog() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          {t('admin.audit_log.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('admin.audit_log.subtitle')}</p>
      </header>
      <AuditLogPanel />
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
  const hasPayload =
    entry.payload != null &&
    typeof entry.payload === 'object' &&
    Object.keys(entry.payload).length > 0;
  const hasResponse = entry.response != null && Object.keys(entry.response).length > 0;
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
        <td className="px-4 py-3 text-center font-mono text-xs tabular-nums text-emerald-700 dark:text-emerald-400">
          {entry.statusCode}
        </td>
      </motion.tr>
      {expanded && (
        <tr className="border-b bg-muted/20">
          <td colSpan={6} className="px-4 py-3">
            <div className="space-y-2 text-xs">
              {hasPayload && (
                <div>
                  <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                    payload
                  </span>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-background p-2 text-[11px]">
                    {JSON.stringify(entry.payload, null, 2)}
                  </pre>
                </div>
              )}
              {hasResponse && (
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
                  UA: <span className="truncate font-mono">{entry.userAgent ?? '—'}</span>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
