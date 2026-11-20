import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { monteOreApi, type MonteOreSlot, type MonteOreTeacherActions } from '@/api/monteOre';
import { httpErrorMessage } from '@/lib/api';
import {
  invalidateMonteOreMyAmendments,
  invalidateMonteOreMyPlan,
  invalidateMonteOreMySlots,
  invalidateMonteOreRegenerated,
  invalidateMonteOreYear,
} from '@/lib/invalidation';
import { groupSlotsByDate } from '@/lib/monteOreGrid';
import { activeHours } from '@/lib/monteOreProjection';
import { qk } from '@/lib/queryKeys';

export interface PeriodSelection {
  from: string;
  to: string;
  /** '' = tutti i giorni; altrimenti '1'..'6'. */
  day: string;
}

const EMPTY_PERIOD: PeriodSelection = { from: '', to: '', day: '' };

/**
 * Query (calendario, slot, variazioni) e mutazioni (rigenera, toggle, selezione
 * periodo) della griglia monte ore, più lo stato di UI condiviso: selezione
 * periodo, apertura dell'editor di richiesta e slot in spostamento.
 */
export function useMonteOreGridData(
  academicYear: string | undefined,
  actions: MonteOreTeacherActions,
) {
  const qc = useQueryClient();
  const [requestOpen, setRequestOpen] = useState(false);
  const [period, setPeriod] = useState<PeriodSelection>(EMPTY_PERIOD);
  // Slot selezionato per uno spostamento (change_time / change_room / move_to).
  const [movingSlot, setMovingSlot] = useState<MonteOreSlot | null>(null);

  const calendarQuery = useQuery({
    queryKey: qk.monteOre.meCalendarYear(academicYear),
    queryFn: () => monteOreApi.getCalendar(academicYear),
    retry: false,
  });

  const slotsQuery = useQuery({
    queryKey: qk.monteOre.meSlotsYear(academicYear),
    queryFn: () => monteOreApi.getMySlots(academicYear),
    enabled: !calendarQuery.isError,
  });

  const amendmentsQuery = useQuery({
    queryKey: qk.monteOre.meAmendmentsYear(academicYear),
    queryFn: () => monteOreApi.getMyAmendments(academicYear),
    enabled: !calendarQuery.isError && actions.viewAmendments,
  });

  const regenerateMutation = useMutation({
    mutationFn: (confirmRemoval: boolean) =>
      monteOreApi.regenerateSlots(academicYear, confirmRemoval),
    onSuccess: (data) => {
      if (data.result.requiresConfirmation) {
        if (
          window.confirm(
            `La modifica rimuove ${data.result.removedActive?.length ?? 0} date selezionate. Confermi?`,
          )
        )
          regenerateMutation.mutate(true);
        return;
      }
      toast.success(`Griglia rigenerata: ${data.result.created} celle`);
      // Regenerate riscrive tutti gli slot della proposta + aggiorna i
      // contatori sulla proposal. Niente impact su threshold/amendments.
      void invalidateMonteOreRegenerated(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: (slotId: number) => monteOreApi.toggleSlot(slotId),
    onSuccess: (data) => {
      if (data.amendment) {
        toast.success(
          data.amendment.status === 'auto_approved'
            ? 'Variazione applicata automaticamente'
            : 'Richiesta inviata al coordinatore',
        );
      }
      // Aggiornamento "ottimistico" mirato: patcho lo slot nella cache locale
      // invece di rifare un fetch completo. Questo riduce drasticamente le
      // richieste API quando il docente clicca rapidamente molte celle.
      if (data.slot) {
        const updatedSlot = data.slot;
        qc.setQueryData<{ slots: MonteOreSlot[] }>(qk.monteOre.meSlotsYear(academicYear), (old) =>
          old
            ? {
                ...old,
                slots: old.slots.map((s) => (s.id === updatedSlot.id ? updatedSlot : s)),
              }
            : old,
        );
      } else {
        // Fallback: amendment senza slot aggiornato → invalida lo slots query
        void invalidateMonteOreMySlots(qc);
      }
      void invalidateMonteOreYear(qc, academicYear);
      // Se è stato creato un amendment, refresha la lista (light)
      if (data.amendment) {
        void invalidateMonteOreMyAmendments(qc);
      }
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const selectMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      monteOreApi.selectSlots({
        academicYear,
        dateFrom: period.from,
        dateTo: period.to,
        dayOfWeek: period.day ? Number(period.day) : undefined,
        isActive,
      }),
    onSuccess: () => {
      void invalidateMonteOreMyPlan(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const slots = slotsQuery.data?.slots;
  const slotsByDate = useMemo(() => groupSlotsByDate(slots ?? []), [slots]);
  const activeTotal = useMemo(() => activeHours(slots ?? []), [slots]);

  // Callback stabili (identità invariata fra render consecutivi) → senza
  // queste, React.memo su WeekRow/DayCell sarebbe un no-op perché la prop
  // funzione cambierebbe ad ogni render del parent.
  const canToggleDirectly = actions.selectDates;
  const canRequestAmendment = actions.requestAmendment;
  const { mutate: toggleSlot } = toggleMutation;
  const handleToggle = useCallback(
    (slotId: number) => {
      if (canToggleDirectly) {
        toggleSlot(slotId);
        return;
      }
      if (canRequestAmendment) setRequestOpen(true);
    },
    [canToggleDirectly, canRequestAmendment, toggleSlot],
  );
  const handleRequestMove = useCallback((s: MonteOreSlot) => {
    setMovingSlot(s);
  }, []);

  return {
    calendarQuery,
    slotsQuery,
    amendmentsQuery,
    regenerateMutation,
    toggleMutation,
    selectMutation,
    slotsByDate,
    activeTotal,
    requestOpen,
    setRequestOpen,
    period,
    setPeriod,
    movingSlot,
    setMovingSlot,
    handleToggle,
    handleRequestMove,
    editable: canToggleDirectly || canRequestAmendment,
  };
}
