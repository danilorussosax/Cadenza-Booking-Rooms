import { useTranslation } from 'react-i18next';
import { Activity, Cpu, HardDrive, Server } from 'lucide-react';
import type { OpsSnapshot } from '@/api/ops';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtBytes, fmtDuration } from '@/lib/opsFormat';
import { levelBadge } from './levelBadge';
import { Row } from './Row';

export function VpsCard({ data }: { data: OpsSnapshot['vps'] }) {
  const { t } = useTranslation();
  const memPct = data.memory.usedPercent ?? 0;
  const diskPct = data.disk?.usedPercent ?? 0;
  const load1 = data.loadAvg[0];
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
