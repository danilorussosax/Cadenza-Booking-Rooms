import { useTranslation } from 'react-i18next';
import { IsidataLogo } from '@/components/icons/IsidataLogo';
import { type IntegrationSource } from '@/api/integrations';
import { REQUIRED_FIELDS, emptyMapping } from '@/lib/isidataMapping';
import { MappingCard } from '@/pages/admin/integrations/isidata/MappingCard';
import { PreviewView } from '@/pages/admin/integrations/isidata/PreviewView';
import { CompareRunDialog } from '@/pages/admin/integrations/isidata/CompareRunDialog';
import { UploadStep } from '@/pages/admin/integrations/isidata/UploadStep';
import { DoneStep } from '@/pages/admin/integrations/isidata/DoneStep';
import { RunHistoryCard } from '@/pages/admin/integrations/isidata/RunHistoryCard';
import { useIsidataImport } from '@/pages/admin/integrations/isidata/useIsidataImport';

/**
 * Wrapper "page": header + contenuto. Usato dalla rotta diretta
 * /admin/integrations/isidata (mantenuta per backward compat e deep-link)
 * ma non più linkata in sidebar — il punto d'ingresso primario è la card
 * dentro Admin → Utenti.
 */
export default function IsidataImport() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <IsidataLogo className="h-10 w-10 shrink-0" />
        <div>
          <h1 className="font-display text-3xl font-medium">{t('integrations.isidata.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('integrations.isidata.subtitle')}</p>
        </div>
      </div>
      <IsidataImportContent />
    </div>
  );
}

/**
 * Contenuto del wizard senza header — riusabile sia come pagina sia
 * dentro un Dialog/Sheet (vedi IsidataImportCard nella pagina Utenti).
 *
 * Il prop `source` permette di riusare lo stesso wizard per altri provider
 * (es. ESSE3 CINECA): il backend è parametrico su `source` e l'unica
 * differenza visibile è la URL chiamata (`/api/admin/integrations/{source}-csv/...`)
 * e il filtro `provider` per la sezione storico run.
 *
 * Le stringhe i18n sono dinamiche: l'helper `tk(suffix)` cerca prima la
 * chiave specifica del provider (`integrations.esse3.<suffix>`), poi
 * ricade sulla base isidata (`integrations.isidata.<suffix>`). Permette di
 * definire solo le chiavi che cambiano davvero (es. dropzone_label che
 * cita il nome del provider) lasciando il resto condiviso.
 */
export function IsidataImportContent({ source = 'isidata' }: { source?: IntegrationSource } = {}) {
  const {
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
  } = useIsidataImport(source);

  return (
    <div className="space-y-6">
      {step === 'upload' && (
        <UploadStep
          tk={tk}
          file={file}
          onFileChange={setFile}
          previewing={previewMutation.isPending}
          onPreview={handlePreview}
        />
      )}

      {step === 'preview' && preview && (
        <>
          <MappingCard
            preview={preview}
            currentMapping={currentMapping ?? preview.effectiveMapping ?? emptyMapping()}
            onChange={setCurrentMapping}
            onReload={handleReloadWithMapping}
            onResetAuto={handleResetAuto}
            reloading={previewMutation.isPending}
          />
          <PreviewView
            preview={preview}
            filter={filter}
            onFilterChange={setFilter}
            onBack={reset}
            onApply={() => applyMutation.mutate()}
            applying={applyMutation.isPending}
            // Blocca l'applicazione se neanche un campo "obbligatorio" è
            // mappato (matricola/email): replica defensive del check backend.
            mappingValid={REQUIRED_FIELDS.some(
              (f) => !!(currentMapping?.[f] ?? preview.effectiveMapping?.[f]),
            )}
          />
        </>
      )}

      {step === 'done' && (
        <DoneStep
          tk={tk}
          createdUserIds={lastApply?.createdUserIds ?? []}
          onReset={reset}
          setupDialogOpen={setupDialogOpen}
          onSetupDialogOpenChange={setSetupDialogOpen}
          sending={setupLinksMutation.isPending}
          onSendSetupLinks={(ids) => {
            setupLinksMutation.mutate(ids);
          }}
        />
      )}

      <CompareRunDialog runId={compareRunId} onClose={() => setCompareRunId(null)} />

      <RunHistoryCard
        tk={tk}
        loading={runsQuery.isLoading}
        runs={runsQuery.data?.runs ?? []}
        onCompare={setCompareRunId}
      />
    </div>
  );
}
