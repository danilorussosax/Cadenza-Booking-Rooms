import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { monteOreAdminApi } from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export default function PlanApproval({
  proposalId,
  onClose,
  onApproved,
}: {
  proposalId: number;
  onClose: () => void;
  onApproved: () => void;
}) {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<Partial<Record<number, number>>>({});
  const preview = useQuery({
    queryKey: ['admin', 'monte-ore', proposalId, 'preview'],
    queryFn: () => monteOreAdminApi.preview(proposalId),
  });
  const rooms = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
  });
  const changes = Object.entries(assignments).map(([id, roomId]) => ({
    slotId: Number(id),
    roomId: roomId ?? 0,
  }));
  const check = useMutation({
    mutationFn: () => monteOreAdminApi.checkApproval(proposalId, changes),
    onError: (e) => toast.error(httpErrorMessage(e)),
  });
  const approval = useMutation({
    mutationFn: () => monteOreAdminApi.approve(proposalId, undefined, changes),
    onSuccess: () => {
      onApproved();
      onClose();
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });
  const result = check.data ?? preview.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('monteWorkflow.preview')}</DialogTitle>
          <DialogDescription>
            {result?.totalHours.toFixed(2)} h · {result?.activeCount} lezioni
          </DialogDescription>
        </DialogHeader>
        <label className="block text-sm">
          {t('monteWorkflow.room')}: tutte le lezioni
          <select
            className="m-2 rounded border bg-background p-2"
            defaultValue=""
            onChange={(e) => {
              const roomId = Number(e.target.value);
              if (roomId)
                setAssignments(
                  Object.fromEntries(
                    (preview.data?.slots ?? [])
                      .filter((s) => s.isActive)
                      .map((s) => [s.id, roomId]),
                  ),
                );
              check.reset();
            }}
          >
            <option value="">{t('monteWorkflow.choose')}</option>
            {(rooms.data?.rooms ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="max-h-72 overflow-y-auto space-y-1">
          {(preview.data?.slots ?? [])
            .filter((s) => s.isActive)
            .map((s) => (
              <label
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"
              >
                <span>
                  {s.date} {s.startTime}–{s.endTime}
                </span>
                <select
                  className="rounded border bg-background p-2"
                  value={assignments[s.id] ?? s.roomId ?? ''}
                  onChange={(e) => {
                    setAssignments((old) => ({ ...old, [s.id]: Number(e.target.value) }));
                    check.reset();
                  }}
                >
                  <option value="">{t('monteWorkflow.choose')}</option>
                  {(rooms.data?.rooms ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
        <div role="status" className="text-sm">
          {result?.issues.length
            ? result.issues.map((issue, i) => (
                <p key={i} className="text-destructive">
                  {issue.message}
                </p>
              ))
            : result
              ? t('monteWorkflow.noConflicts')
              : '…'}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => check.mutate()}
            disabled={check.isPending || preview.isPending}
          >
            {t('monteWorkflow.preview')}
          </Button>
          <Button
            onClick={() => approval.mutate()}
            disabled={
              approval.isPending ||
              check.isPending ||
              !result ||
              result.issues.length > 0 ||
              (changes.length > 0 && !check.data)
            }
          >
            {t('monteWorkflow.approvePlan')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
