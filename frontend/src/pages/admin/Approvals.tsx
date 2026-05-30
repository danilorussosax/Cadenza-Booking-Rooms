import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Clock,
  GitPullRequest,
  LoaderCircle,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { bookingsApi } from '@/api/bookings';
import { monteOreAdminApi } from '@/api/monteOre';
import { httpErrorMessage } from '@/lib/api';
import { dayjs, formatDate, formatTime } from '@/lib/date';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Booking } from '@/types';

export default function AdminApprovals() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<Booking | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const query = useQuery({
    queryKey: ['admin', 'bookings', 'pending'],
    queryFn: () => bookingsApi.pending(),
    staleTime: 15_000,
  });

  const amendmentsPendingQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'amendments', 'pending-count'],
    queryFn: () => monteOreAdminApi.pendingAmendmentsCount(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const amendmentsCount = amendmentsPendingQuery.data?.count ?? 0;

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'bookings', 'pending'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'bookings', 'pending', 'count'] });
    void qc.invalidateQueries({ queryKey: ['bookings'] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: number) => bookingsApi.approve(id),
    onSuccess: () => {
      toast.success(t('admin.approvals.toast.approved'));
      invalidateAll();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => bookingsApi.reject(id, reason),
    onSuccess: () => {
      toast.success(t('admin.approvals.toast.rejected'));
      invalidateAll();
      setRejectTarget(null);
      setRejectReason('');
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const pending = query.data?.bookings ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          {t('admin.approvals.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('admin.approvals.subtitle')}</p>
      </header>

      {/* Variazioni monte ore: coda separata, link diretto a /admin/monte-ore. */}
      <Link
        to="/admin/monte-ore"
        className="block rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Card className="transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/20">
          <CardContent className="flex items-center gap-3 p-4 sm:p-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-400">
              <GitPullRequest className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{t('admin.approvals.amendments_link.title')}</p>
                {amendmentsCount > 0 && (
                  <Badge variant="secondary">
                    {t('admin.approvals.amendments_link.badge', { count: amendmentsCount })}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('admin.approvals.amendments_link.subtitle')}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      {query.isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && pending.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Clock className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t('admin.approvals.empty_title')}</p>
            <p className="text-sm text-muted-foreground">{t('admin.approvals.empty_subtitle')}</p>
          </CardContent>
        </Card>
      )}

      {!query.isLoading && pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((b) => (
            <ApprovalRow
              key={b.id}
              booking={b}
              busy={approveMutation.isPending || rejectMutation.isPending}
              onApprove={() => {
                approveMutation.mutate(b.id);
              }}
              onReject={() => {
                setRejectTarget(b);
                setRejectReason('');
              }}
            />
          ))}
        </div>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.approvals.reject_dialog.title')}</DialogTitle>
            <DialogDescription>{t('admin.approvals.reject_dialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">{t('admin.approvals.reject_dialog.reason_label')}</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
              }}
              placeholder={t('admin.approvals.reject_dialog.reason_placeholder')}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (rejectTarget)
                  rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason.trim() });
              }}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {t('admin.approvals.action.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApprovalRow({
  booking,
  busy,
  onApprove,
  onReject,
}: {
  booking: Booking;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const room = booking.room;
  const buildingName = room?.building?.name ?? '';
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{t('bookings.status.pending_approval')}</Badge>
              {booking.user && (
                <span className="text-sm font-medium">
                  {booking.user.firstName} {booking.user.lastName}
                </span>
              )}
              {booking.user?.role && (
                <Badge variant="muted">{t(`roles.${booking.user.role}`)}</Badge>
              )}
            </div>
            <p className="text-sm">
              <span className="font-medium">{room?.name ?? '—'}</span>
              {buildingName && <span className="text-muted-foreground"> · {buildingName}</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDate(booking.startTime, 'dddd D MMMM YYYY')} · {formatTime(booking.startTime)}–
              {formatTime(booking.endTime)}
              {' · '}
              {dayjs(booking.endTime).diff(dayjs(booking.startTime), 'minute')} min
            </p>
            {booking.purpose && (
              <p className="text-xs italic text-muted-foreground">"{booking.purpose}"</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onReject}
              disabled={busy}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-4 w-4" />
              {t('admin.approvals.action.reject')}
            </Button>
            <Button size="sm" onClick={onApprove} disabled={busy}>
              <Check className="h-4 w-4" />
              {t('admin.approvals.action.approve')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
