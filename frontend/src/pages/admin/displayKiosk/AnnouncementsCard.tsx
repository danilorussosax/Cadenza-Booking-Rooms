import type { Dispatch, SetStateAction } from 'react';
import { Hash, Megaphone, Pin, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AnnouncementsCfg } from '@/lib/displayKioskConfig';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

interface AnnouncementsCardProps {
  announcements: AnnouncementsCfg;
  setAnnouncements: Dispatch<SetStateAction<AnnouncementsCfg>>;
}

/**
 * Card annunci: impostazioni globali della rotazione annunci.
 * Replica gli stessi valori su tutti gli edifici al salvataggio.
 */
export function AnnouncementsCard({ announcements, setAnnouncements }: AnnouncementsCardProps) {
  const { t } = useTranslation();
  return (
    <Card className={cn(!announcements.enabled && 'opacity-90')}>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-100 ring-1 ring-rose-300/60 dark:bg-rose-500/15 dark:ring-rose-400/30">
              <Megaphone className="h-5 w-5 text-rose-700 dark:text-rose-300" />
            </span>
            <div>
              <h2 className="text-base font-semibold">
                {t('admin.display.announcements_card.title')}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('admin.display.announcements_card.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={announcements.enabled}
              onCheckedChange={(v) => {
                setAnnouncements((c) => ({ ...c, enabled: v }));
              }}
            />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {announcements.enabled
                ? t('admin.display.concerts_on')
                : t('admin.display.concerts_off')}
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Hash className="h-4 w-4 text-muted-foreground" />
              {t('admin.display.announcements_card.count_label')}
            </div>
            <Input
              type="number"
              min={0}
              max={30}
              value={announcements.count}
              onChange={(e) => {
                setAnnouncements((c) => ({ ...c, count: Number(e.target.value) || 0 }));
              }}
              disabled={!announcements.enabled}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('admin.display.announcements_card.count_help')}
            </p>
          </div>

          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Timer className="h-4 w-4 text-muted-foreground" />
              {t('admin.display.announcements_card.interval_label')}
            </div>
            <Input
              type="number"
              min={5}
              max={600}
              value={announcements.intervalSec}
              onChange={(e) => {
                setAnnouncements((c) => ({ ...c, intervalSec: Number(e.target.value) || 0 }));
              }}
              disabled={!announcements.enabled}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('admin.display.announcements_card.interval_help')}
            </p>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-start gap-3">
            <Pin className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {t('admin.display.announcements_card.pinned_only_label')}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t('admin.display.announcements_card.pinned_only_help')}
              </p>
            </div>
          </div>
          <Switch
            checked={announcements.pinnedOnly}
            onCheckedChange={(v) => {
              setAnnouncements((c) => ({ ...c, pinnedOnly: v }));
            }}
            disabled={!announcements.enabled}
          />
        </div>
      </CardContent>
    </Card>
  );
}
