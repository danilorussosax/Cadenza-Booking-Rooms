import { useTranslation } from 'react-i18next';
import { Timer } from 'lucide-react';
import type { SlowQueryAggregateRow } from '@/api/ops';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtRelative } from '@/lib/opsFormat';
import { useSlowQueries } from './useSlowQueries';

// =====================================================
// Slow queries card (v1.12)
// =====================================================
//
// Polling 60s — il ring buffer in-memory non cambia di colpo e la card
// è "diagnostica", non "live monitoring". Mostra:
//   - aggregato per route (top 10 per p95)
//   - top 10 query lente recenti (ultime 24h)
export function SlowQueriesCard() {
  const { t } = useTranslation();

  const { aggregateQuery, recentQuery, stats } = useSlowQueries();

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
          ) : aggregateQuery.data?.aggregate.length ? (
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
          ) : recentQuery.data?.items.length ? (
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
