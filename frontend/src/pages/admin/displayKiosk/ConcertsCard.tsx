import type { Dispatch, SetStateAction } from 'react';
import { CalendarDays, Hash, Music4, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConcertsCfg } from '@/lib/displayKioskConfig';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

interface ConcertsCardProps {
  concerts: ConcertsCfg;
  setConcerts: Dispatch<SetStateAction<ConcertsCfg>>;
}

/**
 * Card concerti: impostazioni globali della rotazione concerti.
 * Replica gli stessi valori su tutti gli edifici al salvataggio.
 */
export function ConcertsCard({ concerts, setConcerts }: ConcertsCardProps) {
  const { t } = useTranslation();
  return (
    <Card className={cn(!concerts.enabled && 'opacity-90')}>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 ring-1 ring-amber-300/60 dark:bg-amber-500/15 dark:ring-amber-400/30">
              <Music4 className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </span>
            <div>
              <h2 className="text-base font-semibold">{t('admin.display.concerts_card.title')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('admin.display.concerts_card.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={concerts.enabled}
              onCheckedChange={(v) => {
                setConcerts((c) => ({ ...c, enabled: v }));
              }}
            />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {concerts.enabled ? t('admin.display.concerts_on') : t('admin.display.concerts_off')}
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              {t('admin.display.concerts_card.days_label')}
            </div>
            <Input
              type="number"
              min={0}
              max={365}
              value={concerts.days}
              onChange={(e) => {
                setConcerts((c) => ({ ...c, days: Number(e.target.value) || 0 }));
              }}
              disabled={!concerts.enabled}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('admin.display.concerts_card.days_help')}
            </p>
          </div>

          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Hash className="h-4 w-4 text-muted-foreground" />
              {t('admin.display.concerts_card.count_label')}
            </div>
            <Input
              type="number"
              min={0}
              max={50}
              value={concerts.count}
              onChange={(e) => {
                setConcerts((c) => ({ ...c, count: Number(e.target.value) || 0 }));
              }}
              disabled={!concerts.enabled}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('admin.display.concerts_card.count_help')}
            </p>
          </div>

          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Timer className="h-4 w-4 text-muted-foreground" />
              {t('admin.display.concerts_card.interval_label')}
            </div>
            <Input
              type="number"
              min={5}
              max={600}
              value={concerts.intervalSec}
              onChange={(e) => {
                setConcerts((c) => ({ ...c, intervalSec: Number(e.target.value) || 0 }));
              }}
              disabled={!concerts.enabled}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('admin.display.concerts_card.interval_help')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
