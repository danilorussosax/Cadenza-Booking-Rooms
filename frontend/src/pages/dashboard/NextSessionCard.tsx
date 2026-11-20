import { CalendarPlus, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dayjs, formatDate } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Booking } from '@/types';

export function NextSessionCard({
  next,
  onNewBooking,
}: {
  next: Booking | undefined;
  onNewBooking: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card className="border-primary/20 bg-primary/5 lg:hidden">
      <CardContent className="p-4 sm:p-6">
        {next ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {t('dashboard.stats.next_session')}
            </div>
            <p className="font-display text-2xl font-medium">{dayjs(next.startTime).fromNow()}</p>
            <p className="text-sm">
              {formatDate(next.startTime, 'ddd D MMM · HH:mm')}
              {next.room ? ` · ${next.room.name}` : ''}
            </p>
            {next.room?.building && (
              <p className="text-xs text-muted-foreground">
                {next.room.building.name}
                {next.room.floor ? ` · ${next.room.floor}` : ''}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('dashboard.stats.next_session')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('dashboard.stats.next_session_none')}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => {
                onNewBooking();
              }}
            >
              <CalendarPlus className="h-4 w-4" />
              {t('my_bookings.new_booking')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
