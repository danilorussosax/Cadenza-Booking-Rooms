import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { monteOreApi, type MonteOreSlot } from '@/api/monteOre';
import { httpErrorMessage } from '@/lib/api';
import { invalidateMonteOreMyPlan } from '@/lib/invalidation';
import { useTranslation } from 'react-i18next';

interface MoveForm {
  newStart: string;
  newEnd: string;
  newRoomId: number | null;
  targetSlotId: number | null;
  notes: string;
}

/**
 * Le tre mutazioni di spostamento di uno slot (cambio orario / aula / sposta a…).
 * Amendment su slot → cambia lo slot e crea un amendment: non tocca proposal,
 * threshold o calendar.
 */
export function useSlotMoveMutations(slot: MonteOreSlot, form: MoveForm, onClose: () => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { newStart, newEnd, newRoomId, targetSlotId, notes } = form;

  const refresh = () => {
    void invalidateMonteOreMyPlan(qc);
  };

  const changeTime = useMutation({
    mutationFn: () =>
      monteOreApi.changeSlotTime(slot.id, {
        startTime: newStart,
        endTime: newEnd,
        notes: notes || undefined,
      }),
    onSuccess: (data) => {
      toast.success(
        data.amendment.status === 'auto_approved'
          ? t('toasts.monte_ore.time_updated')
          : t('toasts.monte_ore.time_request_sent'),
      );
      refresh();
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const changeRoom = useMutation({
    mutationFn: () => {
      if (newRoomId == null) throw new Error('roomId mancante');
      return monteOreApi.changeSlotRoom(slot.id, {
        roomId: newRoomId,
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      toast.success(t('toasts.monte_ore.room_request_sent'));
      refresh();
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const moveTo = useMutation({
    mutationFn: () => {
      if (targetSlotId == null) throw new Error('targetSlotId mancante');
      return monteOreApi.moveSlotTo(slot.id, {
        targetSlotId,
        notes: notes || undefined,
      });
    },
    onSuccess: (data) => {
      toast.success(
        data.amendment.status === 'auto_approved'
          ? t('toasts.monte_ore.lesson_moved')
          : t('toasts.monte_ore.move_request_sent'),
      );
      refresh();
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return {
    changeTime,
    changeRoom,
    moveTo,
    isPending: changeTime.isPending || changeRoom.isPending || moveTo.isPending,
  };
}
