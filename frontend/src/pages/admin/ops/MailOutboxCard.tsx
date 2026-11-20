import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, Inbox } from 'lucide-react';
import type { OpsSnapshot } from '@/api/ops';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtDuration } from '@/lib/opsFormat';
import { Row } from './Row';

export function MailOutboxCard({ data }: { data: OpsSnapshot['mailOutbox'] }) {
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
