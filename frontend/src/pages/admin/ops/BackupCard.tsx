import { useTranslation } from 'react-i18next';
import { AlertTriangle, HardDrive } from 'lucide-react';
import type { OpsSnapshot } from '@/api/ops';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtBytes, fmtRelative } from '@/lib/opsFormat';
import { levelBadge } from './levelBadge';
import { Row } from './Row';

export function BackupCard({ data }: { data: OpsSnapshot['backups'] }) {
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
