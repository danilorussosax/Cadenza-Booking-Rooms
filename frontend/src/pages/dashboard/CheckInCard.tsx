import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Booking } from '@/types';

export function CheckInCard({ bookings }: { bookings: Booking[] }) {
  const { t } = useTranslation();
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
        <CardContent className="flex flex-col gap-3 p-5 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 ring-1 ring-amber-300 dark:bg-amber-500/20 dark:ring-amber-400/40">
              <CheckCircle2 className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </span>
            <div className="space-y-0.5">
              <p className="font-medium">{t('check_in.dashboard_card_title')}</p>
              <p className="text-sm text-muted-foreground">
                {t(
                  bookings.length === 1
                    ? 'check_in.dashboard_card_help_one'
                    : 'check_in.dashboard_card_help_other',
                  { count: bookings.length },
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {bookings.slice(0, 2).map((b) => (
              <Button
                key={b.id}
                asChild
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Link to={`/check-in/room/${b.roomId}`}>
                  <CheckCircle2 className="h-4 w-4" />
                  {b.room?.name ?? t('check_in.dashboard_card_action')}
                </Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
