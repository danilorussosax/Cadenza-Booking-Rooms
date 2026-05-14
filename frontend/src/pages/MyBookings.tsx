import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CalendarPlus, ClipboardList, Download, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { bookingsApi } from '@/api/bookings';
import { dayjs } from '@/lib/date';
import { tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookingListItem } from '@/components/bookings/BookingListItem';
import { BookingFormDialog } from '@/components/bookings/BookingFormDialog';
import { CancelBookingDialog } from '@/components/bookings/CancelBookingDialog';
import { CalendarSubscriptionSection } from '@/components/bookings/CalendarSubscriptionSection';
import type { Booking } from '@/types';

type Tab = 'future' | 'past' | 'cancelled' | 'all';

export default function MyBookings() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('future');
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  // Quick-action "Duplica" (gap #1 EasyRoom parity): apre lo stesso dialog
  // di creazione ma pre-fillato dai dati di una booking esistente +7gg.
  const [duplicateTarget, setDuplicateTarget] = useState<Booking | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useQuery({
    queryKey: ['bookings', 'mine', 'all'],
    // limit alto per MyBookings: l'utente vede TUTTE le sue bookings (storico
    // completo) classificate poi client-side in future/past/cancelled. Senza
    // limit alto, le bookings recenti sparivano per utenti con storico esteso
    // (P1-2 ha portato il default backend a 100, ma per "le mie" serve il max).
    queryFn: () => bookingsApi.list({ mine: true, limit: 500 }),
  });

  // Scarica il file .ics autenticandosi con il JWT corrente (no token in querystring).
  const handleExportIcal = async () => {
    setExporting(true);
    try {
      const token = tokenStore.get();
      if (!token) throw new Error(t('my_bookings.toast.session_expired'));
      const res = await fetch('/api/bookings/ical', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg =
          res.status === 401
            ? t('errors.session_expired')
            : `${t('errors.generic')} (${res.status})`;
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cadenza-${dayjs().format('YYYY-MM-DD')}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t('my_bookings.toast.ical_downloaded'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('my_bookings.toast.export_failed'));
    } finally {
      setExporting(false);
    }
  };

  const grouped = useMemo(() => {
    const list = query.data?.bookings ?? [];
    const now = dayjs();
    const future = list
      .filter((b) => b.status === 'confirmed' && dayjs(b.endTime).isAfter(now))
      .sort((a, b) => dayjs(a.startTime).valueOf() - dayjs(b.startTime).valueOf());
    const past = list
      .filter(
        (b) =>
          b.status === 'completed' ||
          b.status === 'no_show' ||
          (b.status === 'confirmed' && dayjs(b.endTime).isBefore(now)),
      )
      .sort((a, b) => dayjs(b.startTime).valueOf() - dayjs(a.startTime).valueOf());
    const cancelled = list
      .filter((b) => b.status === 'cancelled')
      .sort((a, b) => dayjs(b.startTime).valueOf() - dayjs(a.startTime).valueOf());
    const all = [...list].sort(
      (a, b) => dayjs(b.startTime).valueOf() - dayjs(a.startTime).valueOf(),
    );
    return { future, past, cancelled, all };
  }, [query.data]);

  const counts = {
    future: grouped.future.length,
    past: grouped.past.length,
    cancelled: grouped.cancelled.length,
    all: grouped.all.length,
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-medium">{t('my_bookings.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('my_bookings.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExportIcal}
            disabled={exporting || query.isLoading}
            title={t('my_bookings.export_ical_title')}
          >
            {exporting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t('my_bookings.export_ical')}
          </Button>
          <Button
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            <CalendarPlus className="h-4 w-4" />
            {t('my_bookings.new_booking')}
          </Button>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as Tab);
        }}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="future">
            {t('my_bookings.tabs.future')} · {counts.future}
          </TabsTrigger>
          <TabsTrigger value="past">
            {t('my_bookings.tabs.past')} · {counts.past}
          </TabsTrigger>
          <TabsTrigger value="cancelled">
            {t('my_bookings.tabs.cancelled')} · {counts.cancelled}
          </TabsTrigger>
          <TabsTrigger value="all">
            {t('my_bookings.tabs.all')} · {counts.all}
          </TabsTrigger>
        </TabsList>

        {(['future', 'past', 'cancelled', 'all'] as Tab[]).map((key) => (
          <TabsContent key={key} value={key} className="space-y-3">
            {query.isLoading ? (
              <>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </>
            ) : grouped[key].length === 0 ? (
              <EmptyState
                tab={key}
                onCreate={
                  key === 'future'
                    ? () => {
                        setCreateOpen(true);
                      }
                    : undefined
                }
              />
            ) : (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                {grouped[key].map((b) => (
                  <BookingListItem
                    key={b.id}
                    booking={b}
                    onCancel={(book) => {
                      setCancelTarget(book);
                    }}
                    onDuplicate={(book) => {
                      setDuplicateTarget(book);
                    }}
                  />
                ))}
              </motion.div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <CalendarSubscriptionSection />

      <BookingFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <BookingFormDialog
        open={duplicateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicateTarget(null);
        }}
        duplicateFrom={duplicateTarget}
      />
      <CancelBookingDialog
        booking={cancelTarget}
        onClose={() => {
          setCancelTarget(null);
        }}
      />
    </div>
  );
}

function EmptyState({ tab, onCreate }: { tab: Tab; onCreate?: () => void }) {
  const { t } = useTranslation();
  const title = t(`my_bookings.empty.${tab}_title`);
  const subtitle = t(`my_bookings.empty.${tab}_subtitle`);
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <ClipboardList className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {onCreate && (
          <Button onClick={onCreate}>
            <CalendarPlus className="h-4 w-4" />
            {t('my_bookings.empty.create')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
