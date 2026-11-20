import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { monteOreApi } from '@/api/monteOre';
import { httpErrorMessage } from '@/lib/api';
import { invalidateMonteOreYear, invalidateMonteOreYearAndSlots } from '@/lib/invalidation';
import { qk } from '@/lib/queryKeys';
import { NO_TEACHER_ACTIONS } from './constants';

/**
 * Stato server della pagina Monte ore docente: AA target, proposta, soglia,
 * azioni/blocchi calcolati dal server e mutazioni (aggiorna, elimina riga, invia).
 */
export function useMonteOreProposal() {
  const qc = useQueryClient();

  // Risolve l'AA target del docente (current vs next a finestra aperta).
  // È l'autorità per tutte le query della pagina: tutti i fetch passano
  // `?year={target}` per evitare race su rollover anno (1 nov, finestra
  // submission aperta, ecc.).
  const targetYearQuery = useQuery({
    queryKey: qk.monteOre.academicYearMe(),
    queryFn: () => monteOreApi.getAcademicYearForTeacher(),
  });
  const targetItem = targetYearQuery.data?.items[0];
  const yearUnavailable = targetItem?.status === 'draft' || targetItem?.status === 'archived';
  const targetYear = yearUnavailable ? undefined : targetItem?.academicYear;

  const proposalQuery = useQuery({
    queryKey: qk.monteOre.meYear(targetYear),
    queryFn: () => monteOreApi.getMine(targetYear),
    enabled: !!targetYear,
  });

  // Soglia personalizzata (override) — null se l'utente non è un docente.
  // Il banner viene mostrato solo se l'admin ha impostato un override (source
  // === 'user_override') o se il bypass del vincolo 2-4 giorni è attivo.
  const thresholdQuery = useQuery({
    queryKey: qk.monteOre.meThresholdYear(targetYear),
    queryFn: () => monteOreApi.getMyThreshold(targetYear),
    enabled: !!targetYear,
  });

  const proposal = proposalQuery.data?.proposal;
  // Le azioni le decide il server (`workflow` e' sempre presente in GET /me);
  // senza risposta si negano tutte.
  const teacherActions = proposal?.workflow?.actions.teacher ?? NO_TEACHER_ACTIONS;
  const isEditable = teacherActions.editPattern;
  const threshold =
    proposal?.contractSnapshot && !isEditable ? proposal.contractSnapshot : thresholdQuery.data;
  const hasIndividualOverride =
    threshold?.source === 'user_override' || threshold?.bypassDayConstraint === true;
  const isLocked = proposal !== undefined && !isEditable;

  // Blocchi e azioni arrivano dal server (proposal.workflow): le regole di
  // invio vivono solo nel backend (services/monteOreWorkflowService.js).
  const submitBlockers: string[] = proposal?.workflow?.blockers.map((b) => b.message) ?? [];

  const updateMutation = useMutation({
    mutationFn: (payload: {
      notes?: string | null;
      totalHoursRequested?: number;
      validFrom?: string;
      validTo?: string;
    }) => monteOreApi.updateMine({ ...payload, academicYear: targetYear }),
    onSuccess: () => {
      // Aggiorno solo la proposal (campi notes/hours/range); threshold e
      // slots non sono toccati da questa mutation.
      void invalidateMonteOreYear(qc, targetYear);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => monteOreApi.removeMySchedule(id, targetYear),
    onSuccess: () => {
      toast.success('Riga eliminata');
      // La rimozione di una schedule cambia proposal.schedules e rende stantii
      // gli slot legati a quella schedule (verranno rigenerati al prossimo
      // regenerate-slots o submit).
      void invalidateMonteOreYearAndSlots(qc, targetYear);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const submitMutation = useMutation({
    mutationFn: () => monteOreApi.submitMine(targetYear),
    onSuccess: () => {
      toast.success('Proposta inviata al coordinatore');
      // Cambia solo proposal.status (e timestamp): basta proposal.
      void invalidateMonteOreYear(qc, targetYear);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return {
    targetYearQuery,
    proposalQuery,
    thresholdQuery,
    targetItem,
    yearUnavailable,
    targetYear,
    proposal,
    teacherActions,
    isEditable,
    isLocked,
    threshold,
    hasIndividualOverride,
    submitBlockers,
    canSubmit: teacherActions.submit,
    updateMutation,
    removeMutation,
    submitMutation,
  };
}
