import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Megaphone, Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { announcementsApi, type Announcement } from '@/api/announcements';
import { dayjs } from '@/lib/date';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Card "Bacheca avvisi" sulla Dashboard utente.
 *
 * Mostra i 3 avvisi più recenti pinned/non scaduti che matchano l'audience
 * dell'utente. Click "Tutti" → modal con la lista completa (50 avvisi max).
 *
 * Si nasconde se l'utente non ha alcun avviso (no rumore visivo).
 */
export function AnnouncementsCard() {
  const { t } = useTranslation();
  const [allOpen, setAllOpen] = useState(false);

  const query = useQuery({
    queryKey: ['announcements', 'mine'],
    queryFn: () => announcementsApi.listMine(),
    staleTime: 60 * 1000,
  });

  const all = query.data?.announcements ?? [];

  if (query.isLoading) {
    return <Skeleton className="h-28 w-full" />;
  }
  if (all.length === 0) return null;

  const top = all.slice(0, 3);

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-rose-200/60 bg-rose-50/30 dark:border-rose-500/20 dark:bg-rose-500/5">
          <CardContent className="space-y-3 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-2 font-display text-lg font-medium">
                <Megaphone className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                {t('announcements.dashboard_title')}
              </h2>
              {all.length > 3 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAllOpen(true);
                  }}
                >
                  {t('announcements.see_all', { count: all.length })}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <ul className="space-y-2">
              {top.map((a) => (
                <AnnouncementItem key={a.id} announcement={a} />
              ))}
            </ul>
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('announcements.all_title')}</DialogTitle>
            <DialogDescription>{t('announcements.all_subtitle')}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-3">
            {all.map((a) => (
              <AnnouncementItem key={a.id} announcement={a} expanded />
            ))}
          </ul>
          <div className="flex justify-end pt-2">
            <Button asChild variant="outline" size="sm">
              <Link
                to="/announcements"
                onClick={() => {
                  setAllOpen(false);
                }}
              >
                {t('announcements.open_full_page')}
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AnnouncementItem({
  announcement,
  expanded = false,
}: {
  announcement: Announcement;
  expanded?: boolean;
}) {
  return (
    <li className="rounded-lg border bg-background/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {announcement.isPinned && (
              <Badge variant="default" className="gap-1 text-[10px]">
                <Pin className="h-3 w-3" />
              </Badge>
            )}
            <h3 className="font-medium leading-tight">{announcement.title}</h3>
          </div>
          <p
            className={`mt-1 whitespace-pre-wrap text-sm text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}
          >
            {announcement.body}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {dayjs(announcement.publishedAt).format('DD MMM YYYY · HH:mm')}
          </p>
        </div>
      </div>
    </li>
  );
}
