import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Timer, XCircle } from 'lucide-react';
import type { OpsScheduler, OpsSnapshot } from '@/api/ops';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtRelative, isStale } from '@/lib/opsFormat';

function SchedulerRow({ s }: { s: OpsScheduler }) {
  const { t } = useTranslation();
  const labelKey = `admin.ops.scheduler.names.${s.name}`;
  const name = t(labelKey, { defaultValue: s.name });
  let badge: ReactNode;
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

export function SchedulersCard({ data }: { data: OpsSnapshot['schedulers'] }) {
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
