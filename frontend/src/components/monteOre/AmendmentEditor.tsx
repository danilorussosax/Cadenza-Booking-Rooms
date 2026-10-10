import { projectMonteOreHours } from '@/lib/monteOreProjection';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  monteOreApi,
  monteOreAdminApi,
  type AmendmentOperation,
  type MonteOreAmendment,
  type MonteOreSlot,
  type AmendmentKind,
} from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const kinds: AmendmentKind[] = [
  'change_time',
  'change_room',
  'move_to',
  'toggle_off',
  'toggle_on',
  'add_new_day',
];
const fresh = (): AmendmentOperation => ({ kind: 'change_time', payload: {} });

function OperationsEditor({
  operations,
  onChange,
  slots,
}: {
  operations: AmendmentOperation[];
  onChange: (value: AmendmentOperation[]) => void;
  slots: MonteOreSlot[];
}) {
  const { t } = useTranslation();
  const rooms = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
  });
  const update = (index: number, value: AmendmentOperation) =>
    onChange(operations.map((op, i) => (i === index ? value : op)));
  const label = (slot: MonteOreSlot) => `${slot.date} ${slot.startTime}–${slot.endTime}`;
  return (
    <div className="space-y-3">
      {operations.map((op, index) => (
        <div key={index} className="space-y-2 rounded-lg border p-3">
          <label className="block text-sm">
            {t('monteWorkflow.change')}
            <select
              className="mt-1 w-full rounded border bg-background p-2"
              value={op.kind}
              onChange={(e) =>
                update(index, { kind: e.target.value as AmendmentKind, payload: {} })
              }
            >
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`monteWorkflow.kinds.${kind}`)}
                </option>
              ))}
            </select>
          </label>
          {op.kind !== 'add_new_day' && (
            <label className="block text-sm">
              {t('monteWorkflow.occurrence')}
              <select
                className="mt-1 w-full rounded border bg-background p-2"
                value={op.slotId ?? ''}
                onChange={(e) => update(index, { ...op, slotId: Number(e.target.value) })}
              >
                <option value="">{t('monteWorkflow.choose')}</option>
                {slots
                  .filter(
                    (s) => !s.isLocked && (op.kind === 'toggle_on' ? !s.isActive : s.isActive),
                  )
                  .map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {label(slot)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {op.kind === 'add_new_day' && (
            <label className="block text-sm">
              {t('monteWorkflow.date')}
              <Input
                type="date"
                value={op.payload.date ?? ''}
                onChange={(e) =>
                  update(index, { ...op, payload: { ...op.payload, date: e.target.value } })
                }
              />
            </label>
          )}
          {['change_time', 'add_new_day'].includes(op.kind) && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                {t('monteWorkflow.start')}
                <Input
                  type="time"
                  value={op.payload.startTime ?? ''}
                  onChange={(e) =>
                    update(index, { ...op, payload: { ...op.payload, startTime: e.target.value } })
                  }
                />
              </label>
              <label className="text-sm">
                {t('monteWorkflow.end')}
                <Input
                  type="time"
                  value={op.payload.endTime ?? ''}
                  onChange={(e) =>
                    update(index, { ...op, payload: { ...op.payload, endTime: e.target.value } })
                  }
                />
              </label>
            </div>
          )}
          {['change_room', 'add_new_day'].includes(op.kind) && (
            <label className="block text-sm">
              {t('monteWorkflow.room')}
              <select
                className="mt-1 w-full rounded border bg-background p-2"
                value={op.payload.roomId ?? ''}
                onChange={(e) =>
                  update(index, {
                    ...op,
                    payload: { ...op.payload, roomId: Number(e.target.value) || null },
                  })
                }
              >
                <option value="">{t('monteWorkflow.choose')}</option>
                {(rooms.data?.rooms ?? []).map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {op.kind === 'move_to' && (
            <label className="block text-sm">
              {t('monteWorkflow.destination')}
              <select
                className="mt-1 w-full rounded border bg-background p-2"
                value={op.payload.targetSlotId ?? ''}
                onChange={(e) =>
                  update(index, { ...op, payload: { targetSlotId: Number(e.target.value) } })
                }
              >
                <option value="">{t('monteWorkflow.choose')}</option>
                {slots
                  .filter((s) => !s.isLocked && !s.isActive)
                  .map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {label(slot)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(operations.filter((_, i) => i !== index))}
          >
            {t('monteWorkflow.remove')}
          </Button>
        </div>
      ))}
      <Button variant="outline" onClick={() => onChange([...operations, fresh()])}>
        {t('monteWorkflow.addChange')}
      </Button>
    </div>
  );
}

export function AmendmentEditor({
  academicYear,
  slots,
  onClose,
  adminPlanId,
}: {
  academicYear?: string;
  slots: MonteOreSlot[];
  onClose: () => void;
  adminPlanId?: number;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [operations, setOperations] = useState<AmendmentOperation[]>([fresh()]);
  const [notes, setNotes] = useState('');
  const [requestKey] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: () =>
      adminPlanId
        ? monteOreAdminApi.revalidate(adminPlanId, { operations, reason: notes })
        : monteOreApi.requestAmendment({ academicYear, operations, notes, requestKey }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore'] });
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'me'] });
      toast.success(t('monteWorkflow.sent'));
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('monteWorkflow.request')}</DialogTitle>
          <DialogDescription>{t('monteWorkflow.requestHelp')}</DialogDescription>
        </DialogHeader>
        <OperationsEditor operations={operations} onChange={setOperations} slots={slots} />
        <p role="status" className="text-sm">
          {t('monteWorkflow.projectedHours', {
            hours: projectMonteOreHours(slots, operations)?.toFixed(2) ?? '…',
          })}
        </p>
        <label className="text-sm">
          {t('monteWorkflow.reason')}
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <Button
          disabled={mutation.isPending || !operations.length || !notes.trim()}
          onClick={() => mutation.mutate()}
        >
          {t('monteWorkflow.send')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function AmendmentReview({
  amendment,
  onClose,
  onDecided,
}: {
  amendment: MonteOreAmendment;
  onClose: () => void;
  onDecided: () => void;
}) {
  const { t } = useTranslation();
  const plan = useQuery({
    queryKey: ['admin', 'monte-ore', amendment.proposalId],
    queryFn: () => monteOreAdminApi.get(amendment.proposalId),
  });
  const initial: AmendmentOperation[] = amendment.operations ?? [
    {
      kind: amendment.kind,
      slotId: amendment.slotId ?? undefined,
      payload: amendment.payload,
    },
  ];
  const [operations, setOperations] = useState(initial);
  const [reason, setReason] = useState('');
  const changed = JSON.stringify(initial) !== JSON.stringify(operations);
  const mutation = useMutation({
    mutationFn: () =>
      monteOreAdminApi.approveAmendment(amendment.proposalId, amendment.id, { operations, reason }),
    onSuccess: () => {
      toast.success(t('monteWorkflow.decided'));
      onDecided();
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });
  const slots = plan.data?.proposal.slots ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('monteWorkflow.review')}</DialogTitle>
          <DialogDescription>
            {amendment.requestNotes ?? t('monteWorkflow.reviewHelp')}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded border bg-muted/30 p-3 text-sm">
          <p className="font-medium">{t('monteWorkflow.original')}</p>
          {initial.map((op, i) => {
            const slot = slots.find((s) => s.id === op.slotId);
            return (
              <p key={i}>
                {t(`monteWorkflow.kinds.${op.kind}`)} · {op.payload.date ?? slot?.date}{' '}
                {op.payload.startTime ?? slot?.startTime}–{op.payload.endTime ?? slot?.endTime}
              </p>
            );
          })}
        </div>
        <OperationsEditor operations={operations} onChange={setOperations} slots={slots} />
        <p role="status" className="text-sm">
          {t('monteWorkflow.projectedHours', {
            hours: projectMonteOreHours(slots, operations)?.toFixed(2) ?? '…',
          })}
        </p>
        <label className="text-sm">
          {t('monteWorkflow.reason')}
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <Button
          disabled={
            mutation.isPending ||
            plan.isPending ||
            !operations.length ||
            (changed && !reason.trim())
          }
          onClick={() => mutation.mutate()}
        >
          {changed ? t('monteWorkflow.modifyApprove') : t('monteWorkflow.approve')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
