import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Megaphone, Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { announcementsApi } from '@/api/announcements';
import { dayjs } from '@/lib/date';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Pagina "Bacheca avvisi" — elenco completo per l'utente loggato.
 * Sorgente: /api/announcements (filtrato lato server per audience match).
 */
export default function AnnouncementsPage() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['announcements', 'mine'],
    queryFn: () => announcementsApi.listMine(),
    staleTime: 60 * 1000,
  });

  const all = query.data?.announcements ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="inline-flex items-center gap-2 font-display text-3xl font-medium">
          <Megaphone className="h-7 w-7 text-rose-600 dark:text-rose-400" />
          {t('announcements.page_title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('announcements.page_subtitle')}</p>
      </header>

      {query.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && all.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Megaphone className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t('announcements.empty_title')}</p>
            <p className="text-sm text-muted-foreground">{t('announcements.empty_subtitle')}</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {all.map((a) => (
          <motion.div key={a.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
            <Card>
              <CardContent className="space-y-2 p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.isPinned && (
                    <Badge variant="default" className="gap-1">
                      <Pin className="h-3 w-3" />
                      {t('announcements.pinned')}
                    </Badge>
                  )}
                </div>
                <h2 className="font-display text-xl font-medium leading-tight">{a.title}</h2>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{a.body}</p>
                <p className="text-[11px] text-muted-foreground">
                  {dayjs(a.publishedAt).format('dddd D MMMM YYYY · HH:mm')}
                  {a.expiresAt && (
                    <>
                      {' '}
                      · {t('announcements.expires')} {dayjs(a.expiresAt).format('DD MMM YYYY')}
                    </>
                  )}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
