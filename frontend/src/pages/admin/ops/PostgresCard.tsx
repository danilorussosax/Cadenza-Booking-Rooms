import { useTranslation } from 'react-i18next';
import { AlertTriangle, Database } from 'lucide-react';
import type { OpsSnapshot } from '@/api/ops';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtBytes } from '@/lib/opsFormat';
import { levelBadge } from './levelBadge';
import { Row } from './Row';

export function PostgresCard({ data }: { data: OpsSnapshot['postgres'] }) {
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
