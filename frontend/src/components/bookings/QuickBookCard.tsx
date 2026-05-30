import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bookmark, Loader2 as LoaderCircle, Star, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { bookingTemplatesApi, type BookingTemplate } from '@/api/bookingTemplates';
import { httpErrorMessage } from '@/lib/api';
import { dayjs } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// =============================================================================
// QuickBookCard — Dashboard
//
// Mostra fino a 3 template "favoriti" dell'utente. Un click crea una booking
// alla prossima occorrenza del dayOfWeek (calcolata server-side).
//
// Empty-silent: se non ci sono favoriti, la card NON viene renderizzata
// (evita rumore visivo per chi non usa la feature).
// =============================================================================

const FAV_LIMIT = 3;

function dayShort(t: ReturnType<typeof useTranslation>['t'], dow: number): string {
  // dow 0=Sun .. 6=Sat (convenzione Date.getDay())
  // dayjs lo formatta in funzione della locale del browser/i18n
  return dayjs().day(dow).format('ddd');
}

function fmtTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function QuickBookCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['booking-templates'],
    queryFn: () => bookingTemplatesApi.list(),
    staleTime: 60_000,
  });

  const quickBook = useMutation({
    mutationFn: (id: number) => bookingTemplatesApi.quickBook(id),
    onSuccess: (res) => {
      const start = dayjs(res.scheduled.startTime);
      toast.success(
        t('booking.template.quick_booked_toast', {
          when: start.format('ddd D MMM HH:mm'),
        }),
      );
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const favorites = (query.data?.templates ?? [])
    .filter((tpl) => tpl.isFavorite)
    .slice(0, FAV_LIMIT);

  if (query.isLoading) return null;
  if (favorites.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="inline-flex items-center gap-2 font-display text-lg">
            <Zap className="h-5 w-5 text-primary" />
            {t('booking.template.quick_book_title')}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('booking.template.quick_book_help')}
          </p>
        </div>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {favorites.map((tpl) => (
            <QuickBookButton
              key={tpl.id}
              template={tpl}
              loading={quickBook.isPending && quickBook.variables === tpl.id}
              onClick={() => {
                quickBook.mutate(tpl.id);
              }}
              dayLabel={dayShort(t, tpl.dayOfWeek)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function QuickBookButton({
  template,
  loading,
  onClick,
  dayLabel,
}: {
  template: BookingTemplate;
  loading: boolean;
  onClick: () => void;
  dayLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={loading}
      className="h-auto justify-start whitespace-normal py-3 text-left"
      title={t('booking.template.quick_book_action_title', { name: template.name })}
    >
      <div className="flex w-full items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
          {loading ? (
            <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Star className="h-4 w-4 text-primary" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-medium">{template.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {template.room?.name ?? '—'}
            {template.room?.building?.name ? ` · ${template.room.building.name}` : ''}
          </p>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bookmark className="h-3 w-3" />
            <span className="capitalize">{dayLabel}</span>
            <span>·</span>
            <span className="tabular-nums">{fmtTime(template.startMinutes)}</span>
            <span>·</span>
            <span>{template.durationMinutes} min</span>
          </p>
        </div>
      </div>
    </Button>
  );
}
