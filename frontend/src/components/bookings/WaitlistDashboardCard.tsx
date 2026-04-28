import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Bell, Hourglass, ListChecks, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { waitlistApi } from '@/api/waitlist';
import { httpErrorMessage } from '@/lib/api';
import { dayjs, formatDate, formatTime } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { BookingWaitlistEntry } from '@/types';

/**
 * Card "Sei in coda" sulla Dashboard. Mostra le code attive dell'utente
 * separate in due gruppi:
 *   - notificate: turno attivo con countdown del claim window
 *   - in coda: posizione "Nº di N", senza azione immediata
 *
 * Aggiorna se stessa ogni 30s (per il countdown delle notificate) e
 * invalida le booking-related queries quando un claim succede.
 */
export function WaitlistDashboardCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Refresh ogni minuto: i timer contdown vanno aggiornati anche se la
  // server response non cambia (countdown lato client). Il useState below
  // forza re-render senza re-fetch via tick interno.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setTick((n) => n + 1);
    }, 30_000);
    return () => {
      clearInterval(id);
    };
  }, []);

  const query = useQuery({
    queryKey: ['waitlist', 'me'],
    queryFn: () => waitlistApi.mine(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const claimMutation = useMutation({
    mutationFn: (id: number) => waitlistApi.claim(id),
    onSuccess: () => {
      toast.success(t('waitlist.claim_success'));
      void qc.invalidateQueries({ queryKey: ['waitlist', 'me'] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => waitlistApi.cancel(id),
    onSuccess: () => {
      toast.success(t('waitlist.cancel_success'));
      void qc.invalidateQueries({ queryKey: ['waitlist', 'me'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = query.data?.entries ?? [];
  const { notified, queued } = useMemo(() => {
    const n: BookingWaitlistEntry[] = [];
    const q: BookingWaitlistEntry[] = [];
    for (const e of entries) {
      if (e.notifiedAt && e.expiresAt && new Date(e.expiresAt) > new Date()) n.push(e);
      else if (!e.notifiedAt) q.push(e);
    }
    return { notified: n, queued: q };
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 ring-1 ring-emerald-300 dark:bg-emerald-500/20 dark:ring-emerald-400/40">
              <ListChecks className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
            </span>
            <div>
              <p className="font-medium">{t('waitlist.dashboard_title')}</p>
              <p className="text-sm text-muted-foreground">
                {t(
                  entries.length === 1
                    ? 'waitlist.dashboard_subtitle_one'
                    : 'waitlist.dashboard_subtitle_other',
                  { count: entries.length },
                )}
              </p>
            </div>
          </div>

          {/* Notificate: turno attivo, countdown */}
          {notified.length > 0 && (
            <div className="space-y-2">
              {notified.map((e) => (
                <NotifiedRow
                  key={e.id}
                  entry={e}
                  onClaim={() => {
                    claimMutation.mutate(e.id);
                  }}
                  onCancel={() => {
                    cancelMutation.mutate(e.id);
                  }}
                  loading={claimMutation.isPending || cancelMutation.isPending}
                />
              ))}
            </div>
          )}

          {/* In coda: posizione */}
          {queued.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {queued.map((e) => (
                <QueuedRow
                  key={e.id}
                  entry={e}
                  onCancel={() => {
                    cancelMutation.mutate(e.id);
                  }}
                  loading={cancelMutation.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function NotifiedRow({
  entry,
  onClaim,
  onCancel,
  loading,
}: {
  entry: BookingWaitlistEntry;
  onClaim: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const minutesLeft = entry.expiresAt
    ? Math.max(0, Math.round(dayjs(entry.expiresAt).diff(dayjs(), 'second') / 60))
    : 0;
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
          <Bell className="h-3.5 w-3.5" />
          {t('waitlist.your_turn')} · {t('waitlist.expires_in', { count: minutesLeft })}
        </p>
        <p className="mt-1 truncate font-medium">
          {entry.room?.name}
          {entry.room?.building?.name ? ` · ${entry.room.building.name}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDate(entry.startTime, 'ddd D MMM')}
          {' · '}
          {formatTime(entry.startTime)}–{formatTime(entry.endTime)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onClaim}
          disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {t('waitlist.claim')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={loading}
          className="text-muted-foreground"
        >
          <X className="h-4 w-4" />
          {t('waitlist.cancel')}
        </Button>
      </div>
    </div>
  );
}

function QueuedRow({
  entry,
  onCancel,
  loading,
}: {
  entry: BookingWaitlistEntry;
  onCancel: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background p-2 text-sm">
      <Hourglass className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{entry.room?.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatDate(entry.startTime, 'D MMM')} {formatTime(entry.startTime)}–
          {formatTime(entry.endTime)} · {t('waitlist.position', { n: entry.position + 1 })}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onCancel}
        disabled={loading}
        className="text-muted-foreground hover:text-destructive"
        title={t('waitlist.cancel')}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
