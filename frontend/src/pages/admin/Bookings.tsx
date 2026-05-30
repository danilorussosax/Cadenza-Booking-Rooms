import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeftRight, CalendarRange, Search, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { bookingsApi } from '@/api/bookings';
import { httpErrorMessage } from '@/lib/api';
import { dayjs, formatDate } from '@/lib/date';
import { BOOKING_TYPE_LABEL } from '@/lib/bookings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import type { Booking } from '@/types';

// Esportazione SOLO content (senza header h1): usato come tab dentro
// /admin/audit-log. Il default export resta un wrapper con header per
// retro-compatibilità di eventuali link diretti, ma la rotta è stata
// sostituita da un redirect verso /admin/audit-log (vedi App.tsx).
export function AdminBookingsContent() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');

  const query = useQuery({
    queryKey: ['admin', 'bookings', 'confirmed-future'],
    queryFn: () =>
      bookingsApi.list({
        from: new Date().toISOString(),
        status: 'confirmed',
      }),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const bookings = query.data?.bookings ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return bookings;
    return bookings.filter((b) => {
      const haystack = [
        b.room?.name,
        b.room?.building?.name,
        b.user?.firstName,
        b.user?.lastName,
        b.user?.email,
        b.purpose,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [query.data, search]);

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(filtered.map((b) => b.id)) : new Set());
  };
  const toggleOne = (id: number, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const allChecked = filtered.length > 0 && filtered.every((b) => selected.has(b.id));
  const someChecked = filtered.some((b) => selected.has(b.id)) && !allChecked;

  // Riepilogo selezione: N prenotazioni di M utenti distinti
  const selectionSummary = useMemo(() => {
    const sel = filtered.filter((b) => selected.has(b.id));
    const userIds = new Set(sel.map((b) => b.userId));
    return { count: sel.length, userCount: userIds.size };
  }, [filtered, selected]);

  const bulkCancelMutation = useMutation({
    mutationFn: () => bookingsApi.bulkCancel(Array.from(selected), reason.trim() || undefined),
    onSuccess: ({ cancelled, skipped }) => {
      toast.success(t('admin.bookings.toast.cancelled', { count: cancelled, skipped }));
      void qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      setSelected(new Set());
      setConfirmOpen(false);
      setReason('');
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  // Swap (Punto 1 ispirato a EasyRoom): scambio atomico room+orario tra
  // due prenotazioni selezionate. Disponibile solo quando ne sono
  // selezionate esattamente 2.
  const swapMutation = useMutation({
    mutationFn: () => {
      const ids = Array.from(selected);
      return bookingsApi.swap(ids[0], ids[1]);
    },
    onSuccess: () => {
      toast.success('Prenotazioni scambiate');
      void qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      setSelected(new Set());
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:p-6 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder={t('admin.bookings.search_placeholder')}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('admin.bookings.count', { count: filtered.length })}
          </p>
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium">
                {t('admin.bookings.selected_count', { count: selected.size })}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelected(new Set());
                  }}
                >
                  {t('admin.bookings.clear_selection')}
                </Button>
                {selected.size === 2 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          'Scambiare aula e orario tra le due prenotazioni selezionate?',
                        )
                      ) {
                        swapMutation.mutate();
                      }
                    }}
                    disabled={swapMutation.isPending}
                    title="Scambia atomicamente aula e orario tra le due prenotazioni"
                  >
                    <ArrowLeftRight className="h-4 w-4" />
                    Scambia
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {t('admin.bookings.bulk_cancel')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={allChecked || (someChecked ? 'indeterminate' : false)}
                    onCheckedChange={(v) => {
                      toggleAll(v === true);
                    }}
                    aria-label={t('admin.bookings.select_all')}
                  />
                </th>
                <th className="px-4 py-3 font-medium">{t('admin.bookings.table.user')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.bookings.table.room')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.bookings.table.when')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.bookings.table.type')}</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading &&
                [0, 1, 2, 3].map((i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td colSpan={5} className="px-4 py-3">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))}
              {!query.isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <CalendarRange className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">{t('admin.bookings.empty.title')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('admin.bookings.empty.subtitle')}
                    </p>
                  </td>
                </tr>
              )}
              {filtered.map((b) => (
                <BookingRow
                  key={b.id}
                  booking={b}
                  checked={selected.has(b.id)}
                  onToggle={(checked) => {
                    toggleOne(b.id, checked);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o);
          if (!o) setReason('');
        }}
        title={t('admin.bookings.confirm.title')}
        description={t('admin.bookings.confirm.description', {
          count: selectionSummary.count,
          users: selectionSummary.userCount,
        })}
        confirmLabel={t('admin.bookings.bulk_cancel')}
        loading={bulkCancelMutation.isPending}
        onConfirm={() => {
          bulkCancelMutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="bulk-cancel-reason">{t('admin.bookings.confirm.reason_label')}</Label>
          <Textarea
            id="bulk-cancel-reason"
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            placeholder={t('admin.bookings.confirm.reason_placeholder')}
          />
          <p className="text-[11px] text-muted-foreground">
            {t('admin.bookings.confirm.reason_help')}
          </p>
        </div>
      </ConfirmDeleteDialog>
    </div>
  );
}

// Default export: wrapper con header (per retro-compat di link diretti).
// La rotta /admin/bookings ora redirige a /admin/audit-log (vedi App.tsx).
export default function AdminBookings() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
          <CalendarRange className="h-6 w-6 text-primary" />
          {t('admin.bookings.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('admin.bookings.subtitle')}</p>
      </header>
      <AdminBookingsContent />
    </div>
  );
}

function BookingRow({
  booking,
  checked,
  onToggle,
}: {
  booking: Booking;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const room = booking.room;
  const user = booking.user;
  return (
    <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-b last:border-0">
      <td className="px-4 py-3">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => {
            onToggle(v === true);
          }}
        />
      </td>
      <td className="px-4 py-3">
        {user ? (
          <div>
            <p className="font-medium">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <p className="font-medium">{room?.name ?? '—'}</p>
        {room?.building?.name && (
          <p className="text-xs text-muted-foreground">{room.building.name}</p>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {formatDate(booking.startTime, 'ddd D MMM YYYY')}
        <br />
        {dayjs(booking.startTime).format('HH:mm')}–{dayjs(booking.endTime).format('HH:mm')}
      </td>
      <td className="px-4 py-3">
        <Badge variant="secondary">{t(BOOKING_TYPE_LABEL[booking.type])}</Badge>
      </td>
    </motion.tr>
  );
}
