import type { SyncRun } from '@/api/integrations';
import { RunStatusBadge } from '@/pages/admin/integrations/isidata/PreviewParts';
import { buildProviderTk } from '@/pages/admin/integrations/isidata/isidataHelpers';
import { useTranslation } from 'react-i18next';
import { GitCompare, History } from 'lucide-react';
import { dayjs } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function RunHistoryCard({
  tk,
  loading,
  runs,
  onCompare,
}: {
  tk: ReturnType<typeof buildProviderTk>;
  loading: boolean;
  runs: SyncRun[];
  onCompare: (id: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          {tk('history_title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tk('history_empty')}</p>
        ) : (
          <ul className="divide-y">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    {dayjs(r.createdAt).format('D MMM YYYY · HH:mm')}
                    {r.actor && (
                      <span className="ml-2 text-muted-foreground">
                        · {r.actor.firstName} {r.actor.lastName}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tk('run_summary', {
                      fetched: r.fetched,
                      created: r.created,
                      updated: r.updated,
                      orphaned: r.orphaned,
                      errors: r.errors,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCompare(r.id)}
                    data-testid={`compare-run-${r.id}`}
                    aria-label={tk('compare_action')}
                  >
                    <GitCompare className="h-4 w-4" />
                    <span className="hidden sm:inline">{tk('compare_action')}</span>
                  </Button>
                  <RunStatusBadge status={r.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
