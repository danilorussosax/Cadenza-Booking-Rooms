import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { httpErrorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/opsFormat';
import { BackupCard } from './ops/BackupCard';
import { MailOutboxCard } from './ops/MailOutboxCard';
import { PostgresCard } from './ops/PostgresCard';
import { SchedulersCard } from './ops/SchedulersCard';
import { SlowQueriesCard } from './ops/SlowQueriesCard';
import { useOpsSnapshot } from './ops/useOpsSnapshot';
import { VpsCard } from './ops/VpsCard';

export default function AdminOps() {
  const { t } = useTranslation();
  const query = useOpsSnapshot();

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

      {query.isLoading ? (
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
