import {
  buildProviderTk,
  type Step,
  readSavedMapping,
  saveMappingToLs,
  mergeSavedMapping,
} from '@/pages/admin/integrations/isidata/isidataHelpers';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { httpErrorMessage } from '@/lib/api';
import { usersApi } from '@/api/users';
import {
  integrationsApi,
  type ApplyResponse,
  type EffectiveMapping,
  type IntegrationSource,
  type PreviewResponse,
} from '@/api/integrations';
import { qk } from '@/lib/queryKeys';
import { invalidateUsersImported } from '@/lib/invalidation';
import { computeDelta, emptyMapping } from '@/lib/isidataMapping';

/** Stato, query e mutazioni del wizard di import (isidata / esse3). */
export function useIsidataImport(source: IntegrationSource) {
  const { t } = useTranslation();
  const tk = buildProviderTk(t, source);
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  // Risultato dell'ultimo apply: serve a propagare `createdUserIds` al
  // banner post-import che propone il bulk-invio del magic-link.
  const [lastApply, setLastApply] = useState<ApplyResponse | null>(null);
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'create' | 'update' | 'orphan'>('all');
  // Mapping "live" — può essere ≠ da preview.effectiveMapping quando l'admin
  // ha modificato il dropdown ma non ha ancora rilanciato la preview. Una
  // volta cliccato "Ricarica anteprima", il backend ricalcola e la nuova
  // response sovrascrive lo stato locale via `useEffect`.
  const [currentMapping, setCurrentMapping] = useState<EffectiveMapping | null>(null);
  // Compare dialog (Miglioria 2)
  const [compareRunId, setCompareRunId] = useState<number | null>(null);

  const previewMutation = useMutation({
    mutationFn: (input: { file: File; overrides?: Record<string, string> }) =>
      integrationsApi.preview(input.file, input.overrides, source),
    onSuccess: (data) => {
      setPreview(data);
      // Sincronizza il mapping "live" con la response più recente. Se in
      // localStorage c'è un mapping precedente e gli header del nuovo file
      // lo supportano, lo prepopoliamo "over" l'effective.
      const eff = data.effectiveMapping ?? emptyMapping();
      setCurrentMapping(mergeSavedMapping(eff, readSavedMapping(), data.detectedHeaders));
      setStep('preview');
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('no preview');
      // Se la preview ha emesso warning critici, propaghiamo
      // `confirmCriticalWarnings: true` al backend (il gate richiede il
      // flag esplicito). La UI ha già forzato la doppia checkbox prima
      // di abilitare il bottone — vedi PreviewView.
      const hasCritical = (preview.safetyChecks?.warnings ?? []).some(
        (w) => w.level === 'critical',
      );
      return integrationsApi.apply(
        {
          token: preview.token,
          confirmedDiffHash: preview.hash,
          ...(hasCritical ? { confirmCriticalWarnings: true } : {}),
        },
        source,
      );
    },
    onSuccess: (data) => {
      toast.success(
        tk('toast.applied', {
          created: data.summary.created,
          updated: data.summary.updated,
          orphaned: data.summary.orphaned,
        }),
      );
      void invalidateUsersImported(qc);
      setLastApply(data);
      setStep('done');
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  // Bulk-invio del magic-link "imposta password" agli utenti appena creati
  // dall'import. Servito da POST /api/users/send-setup-links-bulk: il
  // service backend si occupa di invalidare token precedenti + enqueue
  // outbox idempotente.
  const setupLinksMutation = useMutation({
    mutationFn: (userIds: number[]) =>
      usersApi.sendSetupLinksBulk({ userIds, onlyMissingPassword: true }),
    onSuccess: (data) => {
      setSetupDialogOpen(false);
      toast.success(
        tk('toast.setup_links_sent', {
          sent: data.sent,
          skipped: data.skipped,
        }),
      );
      // Dopo l'invio, "spegniamo" il banner per evitare doppio invio:
      // un re-click non triggera più la modale fino a un nuovo apply.
      setLastApply((prev) => (prev ? { ...prev, createdUserIds: [] } : prev));
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const runsQuery = useQuery({
    queryKey: qk.admin.integrationsRuns(source),
    queryFn: () => integrationsApi.runs({ provider: source, limit: 20 }),
  });

  const handlePreview = () => {
    if (!file) return;
    // Prima preview: nessun override → auto-detect lato backend.
    previewMutation.mutate({ file });
  };

  // Rilancia la preview applicando il `currentMapping` come overrides
  // (delta vs autoDetected così non rispediamo header già auto-risolti).
  const handleReloadWithMapping = () => {
    if (!file || !preview) return;
    const auto = preview.autoDetected ?? emptyMapping();
    const cur = currentMapping ?? auto;
    const overrides = computeDelta(cur, auto);
    // Persistenza locale: salva l'ultimo mapping scelto.
    saveMappingToLs(cur);
    previewMutation.mutate({ file, overrides });
  };

  // Reset del mapping ai valori auto-detected.
  const handleResetAuto = () => {
    if (!preview) return;
    setCurrentMapping(preview.autoDetected ?? emptyMapping());
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setCurrentMapping(null);
    setStep('upload');
  };

  return {
    tk,
    step,
    file,
    setFile,
    preview,
    lastApply,
    setupDialogOpen,
    setSetupDialogOpen,
    filter,
    setFilter,
    currentMapping,
    setCurrentMapping,
    compareRunId,
    setCompareRunId,
    previewMutation,
    applyMutation,
    setupLinksMutation,
    runsQuery,
    handlePreview,
    handleReloadWithMapping,
    handleResetAuto,
    reset,
  };
}
