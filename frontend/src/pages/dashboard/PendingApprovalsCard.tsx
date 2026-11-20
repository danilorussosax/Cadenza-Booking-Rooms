import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dayjs, formatDate } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Booking } from '@/types';

export function PendingApprovalsCard({ bookings }: { bookings: Booking[] }) {
  const { t } = useTranslation();
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
        <CardContent className="flex flex-col gap-3 p-5 sm:p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 ring-1 ring-amber-300 dark:bg-amber-500/20 dark:ring-amber-400/40">
              <Clock className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </span>
            <div className="space-y-1">
              <p className="font-medium">{t('dashboard.pending_approvals.title')}</p>
              <p className="text-sm text-muted-foreground">
                {t('dashboard.pending_approvals.subtitle', {
                  count: bookings.length,
                })}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {bookings.slice(0, 3).map((b) => (
                  <li key={b.id} className="truncate">
                    <span className="font-medium text-foreground">{b.room?.name ?? '—'}</span>
                    {b.room?.building?.name && <span> · {b.room.building.name}</span>}
                    <span>
                      {' '}
                      · {formatDate(b.startTime, 'ddd D MMM')} {dayjs(b.startTime).format('HH:mm')}–
                      {dayjs(b.endTime).format('HH:mm')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/my-bookings">
              {t('dashboard.pending_approvals.see_all')}
              <ArrowRight className="h-3.5 w-3.5 text-primary" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
