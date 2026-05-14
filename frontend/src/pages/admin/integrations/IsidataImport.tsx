import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  GitCompare,
  History,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Upload,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { httpErrorMessage } from '@/lib/api';
import {
  integrationsApi,
  type CompareRunsResponse,
  type EffectiveMapping,
  type ExternalUser,
  type IntegrationSource,
  type PreviewResponse,
  type ToOrphanItem,
  type ToUpdateItem,
} from '@/api/integrations';
import { dayjs } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Target field canonici esposti dal backend (TARGET_FIELDS lato fieldMapping.js).
 * Mantenuti in sync manualmente: una stringa estranea qui produce solo righe
 * "non risolte" (fallback null), niente crash.
 */
const TARGET_FIELDS = [
  'matricola',
  'externalId',
  'email',
  'firstName',
  'lastName',
  'role',
  'courseCode',
  'courseName',
  'status',
  'contractType',
] as const;
type TargetField = (typeof TARGET_FIELDS)[number];

// Target obbligatori per applicare l'import: il backend richiede matricola
// OPPURE email per matchare/creare. Replichiamo il check qui per disabilitare
// il bottone "Ricarica anteprima" prima di sprecare una request.
const REQUIRED_FIELDS: TargetField[] = ['matricola', 'email'];

// Chiave localStorage per la persistenza opzionale dell'ultimo mapping admin.
// Salva un Record<TargetField,string|null> — al reopen, se TUTTI gli header
// referenziati sono presenti nel nuovo file, prepopoliamo. Altrimenti no.
const MAPPING_LS_KEY = 'isidata.lastMapping';

function readSavedMapping(): EffectiveMapping | null {
  try {
    const raw = localStorage.getItem(MAPPING_LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return obj as EffectiveMapping;
  } catch {
    return null;
  }
}

function saveMappingToLs(map: EffectiveMapping) {
  try {
    localStorage.setItem(MAPPING_LS_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled — silently ignore */
  }
}

/**
 * Restituisce true se TUTTI gli header non-null in `saved` sono presenti in
 * `available`. Usato per decidere se prepopolare la UI da localStorage.
 */
function savedMappingApplicable(
  saved: EffectiveMapping | null,
  available: string[] | undefined,
): boolean {
  if (!saved || !Array.isArray(available)) return false;
  const set = new Set(available);
  for (const v of Object.values(saved)) {
    if (v && !set.has(v)) return false;
  }
  return true;
}

/**
 * Calcola gli `mappingOverrides` da spedire al backend: per ogni target dove
 * la UI differisce da `autoDetected`, includiamo l'header scelto (o stringa
 * vuota se l'admin ha esplicitamente disattivato il mapping su un target che
 * l'auto-detect aveva risolto — il backend filtra stringhe vuote, quindi
 * sostanzialmente "demappiamo" rimuovendo dal payload).
 *
 * Restituisce `undefined` se non ci sono delta (così il caller può evitare di
 * spedire il campo del tutto).
 */
function computeDelta(
  current: EffectiveMapping,
  auto: EffectiveMapping,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const target of TARGET_FIELDS) {
    const cur = current[target] ?? null;
    const a = auto[target] ?? null;
    if (cur !== a && cur) {
      out[target] = cur;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function emptyMapping(): EffectiveMapping {
  const out: EffectiveMapping = {};
  for (const t of TARGET_FIELDS) out[t] = null;
  return out;
}

type Step = 'upload' | 'preview' | 'done';

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
      <div>
        <h1 className="font-display text-3xl font-medium">{t('integrations.isidata.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('integrations.isidata.subtitle')}</p>
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
 * e il filtro `provider` per la sezione storico run. Le etichette i18n
 * rimangono "Isidata" — futuro: tradurre quando ESSE3 sarà GA.
 */
export function IsidataImportContent({ source = 'isidata' }: { source?: IntegrationSource } = {}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [filter, setFilter] = useState<'all' | 'create' | 'update' | 'orphan'>('all');
  // Mapping "live" — può essere ≠ da preview.effectiveMapping quando l'admin
  // ha modificato il dropdown ma non ha ancora rilanciato la preview. Una
  // volta cliccato "Ricarica anteprima", il backend ricalcola e la nuova
  // response sovrascrive lo stato locale via `useEffect`.
  const [currentMapping, setCurrentMapping] = useState<EffectiveMapping | null>(null);
  // Compare dialog (Miglioria 2)
  const [compareRunId, setCompareRunId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewMutation = useMutation({
    mutationFn: (input: { file: File; overrides?: Record<string, string> }) =>
      integrationsApi.preview(input.file, input.overrides, source),
    onSuccess: (data) => {
      setPreview(data);
      // Sincronizza il mapping "live" con la response più recente. Se in
      // localStorage c'è un mapping precedente e gli header del nuovo file
      // lo supportano, lo prepopoliamo "over" l'effective.
      const eff = data.effectiveMapping ?? emptyMapping();
      const saved = readSavedMapping();
      if (saved && savedMappingApplicable(saved, data.detectedHeaders)) {
        // Merge: per i target dove `saved` ha un valore presente nei nuovi
        // headers, lo usiamo; altrimenti fallback sull'effective.
        const merged: EffectiveMapping = { ...eff };
        for (const k of TARGET_FIELDS) {
          if (k in saved) merged[k] = saved[k];
        }
        setCurrentMapping(merged);
      } else {
        setCurrentMapping(eff);
      }
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
        t('integrations.isidata.toast.applied', {
          created: data.summary.created,
          updated: data.summary.updated,
          orphaned: data.summary.orphaned,
        }),
      );
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'integrations'] });
      setStep('done');
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const runsQuery = useQuery({
    queryKey: ['admin', 'integrations', 'runs', source],
    queryFn: () => integrationsApi.runs({ provider: source, limit: 20 }),
  });

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files.item(0);
    if (f) setFile(f);
  };
  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
  };

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

  return (
    <div className="space-y-6">
      {step === 'upload' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {t('integrations.isidata.step1_title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <label
              htmlFor="isidata-file"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/30 p-10 text-center transition-colors hover:border-primary/60 hover:bg-primary/5',
                file && 'border-primary/70 bg-primary/10',
              )}
            >
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">
                {file ? file.name : t('integrations.isidata.dropzone_label')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('integrations.isidata.dropzone_hint')}
              </p>
              <input
                id="isidata-file"
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                }}
              />
            </label>

            <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
              {t('integrations.isidata.mapping_upload_hint')}
            </p>

            <div className="flex justify-end gap-2">
              <Button onClick={handlePreview} disabled={!file || previewMutation.isPending}>
                {previewMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('integrations.isidata.preview_action')}
              </Button>
            </div>
          </CardContent>
        </Card>
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
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <p className="text-xl font-medium">{t('integrations.isidata.done_title')}</p>
            <p className="text-sm text-muted-foreground">{t('integrations.isidata.done_hint')}</p>
            <Button onClick={reset}>{t('integrations.isidata.import_another')}</Button>
          </CardContent>
        </Card>
      )}

      <CompareRunDialog runId={compareRunId} onClose={() => setCompareRunId(null)} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {t('integrations.isidata.history_title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (runsQuery.data?.runs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('integrations.isidata.history_empty')}
            </p>
          ) : (
            <ul className="divide-y">
              {(runsQuery.data?.runs ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {dayjs(r.createdAt).format('D MMM YYYY · HH:mm')}
                      {r.actor && (
                        <span className="ml-2 text-muted-foreground">
                          · {r.actor.firstName} {r.actor.lastName}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.isidata.run_summary', {
                        fetched: r.fetched,
                        created: r.created,
                        updated: r.updated,
                        orphaned: r.orphaned,
                        errors: r.errors,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCompareRunId(r.id)}
                      data-testid={`compare-run-${r.id}`}
                      aria-label={t('integrations.isidata.compare_action')}
                    >
                      <GitCompare className="h-4 w-4" />
                      <span className="hidden sm:inline">
                        {t('integrations.isidata.compare_action')}
                      </span>
                    </Button>
                    <RunStatusBadge status={r.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================
// Preview view: 3 sezioni colorate (verde/blu/ambra) + filtro per categoria
// =====================================================
function PreviewView({
  preview,
  filter,
  onFilterChange,
  onBack,
  onApply,
  applying,
  mappingValid,
}: {
  preview: PreviewResponse;
  filter: 'all' | 'create' | 'update' | 'orphan';
  onFilterChange: (f: 'all' | 'create' | 'update' | 'orphan') => void;
  onBack: () => void;
  onApply: () => void;
  applying: boolean;
  mappingValid: boolean;
}) {
  const { t } = useTranslation();
  const { summary, diff, safetyChecks, softWarnings } = preview;
  const showCreate = filter === 'all' || filter === 'create';
  const showUpdate = filter === 'all' || filter === 'update';
  const showOrphan = filter === 'all' || filter === 'orphan';
  const [confirmed, setConfirmed] = useState(false);
  // Seconda checkbox di conferma per i warning critici. Mostrata solo quando
  // `safetyChecks.warnings` contiene almeno una voce `level=critical`. Il
  // bottone Applica resta disabilitato finché entrambe le checkbox sono
  // spuntate — defense-in-depth oltre al gate backend `confirmCriticalWarnings`.
  const [criticalAck, setCriticalAck] = useState(false);
  const safetyWarnings = safetyChecks?.warnings ?? [];
  const criticalWarnings = safetyWarnings.filter((w) => w.level === 'critical');
  const nonCriticalSafety = safetyWarnings.filter((w) => w.level !== 'critical');
  const softWarn = softWarnings ?? [];
  const [softOpen, setSoftOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{t('integrations.isidata.step2_title')}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('integrations.isidata.preview_hint')}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> {t('common.back')}
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile
            color="emerald"
            icon={UserPlus}
            value={summary.toCreate}
            label={t('integrations.isidata.kpi.create')}
            onClick={() => onFilterChange('create')}
            active={filter === 'create'}
          />
          <SummaryTile
            color="sky"
            icon={UserCheck}
            value={summary.toUpdate}
            label={t('integrations.isidata.kpi.update')}
            onClick={() => onFilterChange('update')}
            active={filter === 'update'}
          />
          <SummaryTile
            color="amber"
            icon={UserX}
            value={summary.toOrphan}
            label={t('integrations.isidata.kpi.orphan')}
            onClick={() => onFilterChange('orphan')}
            active={filter === 'orphan'}
          />
          <SummaryTile
            color="muted"
            icon={FileSpreadsheet}
            value={summary.fetched}
            label={t('integrations.isidata.kpi.fetched')}
            onClick={() => onFilterChange('all')}
            active={filter === 'all'}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {criticalWarnings.length > 0 && (
          <div
            className="rounded-lg border-2 border-rose-400 bg-rose-50 p-4 text-sm dark:border-rose-500/50 dark:bg-rose-500/10"
            data-testid="safety-critical"
            role="alert"
          >
            <p className="flex items-center gap-2 font-semibold text-rose-900 dark:text-rose-200">
              <AlertTriangle className="h-5 w-5" />
              {t('integrations.isidata.safety.critical_title')}
            </p>
            <ul className="mt-2 space-y-1 pl-7 text-rose-900 dark:text-rose-100">
              {criticalWarnings.map((w, i) => (
                <li key={i} className="list-disc">
                  <span className="font-mono text-xs uppercase opacity-70">{w.code}</span> —{' '}
                  {w.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {nonCriticalSafety.length > 0 && (
          <div
            className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10"
            data-testid="safety-warning"
          >
            <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              {t('integrations.isidata.safety.warning_title')}
            </p>
            <ul className="mt-2 space-y-1 pl-7 text-amber-900 dark:text-amber-100">
              {nonCriticalSafety.map((w, i) => (
                <li key={i} className="list-disc">
                  <span className="font-mono text-xs uppercase opacity-70">{w.code}</span> —{' '}
                  {w.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              {t('integrations.isidata.warnings_count', { count: summary.warnings.length })}
            </p>
            <ul className="mt-2 max-h-32 list-disc space-y-1 overflow-auto pl-5 text-xs text-amber-900 dark:text-amber-200">
              {summary.warnings.slice(0, 50).map((w, i) => (
                <li key={i}>
                  {w.row ? (
                    <span className="font-semibold">
                      {t('integrations.isidata.row', { row: w.row })}:{' '}
                    </span>
                  ) : null}
                  {w.msg}
                </li>
              ))}
            </ul>
          </div>
        )}

        {showCreate && diff.toCreate.length > 0 && (
          <Section
            title={t('integrations.isidata.create_section')}
            count={diff.toCreate.length}
            accent="emerald"
          >
            <DiffTable
              rows={diff.toCreate.map((u) => ({
                key: u.externalId ?? u.email ?? `${u.lastName}-${u.firstName}`,
                cells: [
                  u.matricola ?? u.externalId ?? '—',
                  `${u.lastName} ${u.firstName}`,
                  u.email ?? '—',
                  roleLabel(u.role, t),
                  u.courseCode ?? u.courseName ?? '—',
                ],
              }))}
              headers={[
                t('integrations.isidata.col.matricola'),
                t('integrations.isidata.col.name'),
                t('integrations.isidata.col.email'),
                t('integrations.isidata.col.role'),
                t('integrations.isidata.col.course'),
              ]}
            />
          </Section>
        )}

        {showUpdate && diff.toUpdate.length > 0 && (
          <Section
            title={t('integrations.isidata.update_section')}
            count={diff.toUpdate.length}
            accent="sky"
          >
            <DiffTable
              rows={diff.toUpdate.map((u) => ({
                key: `${u.local.id}`,
                cells: [
                  u.local.matricola ?? u.local.email ?? `#${u.local.id}`,
                  `${u.local.lastName} ${u.local.firstName}`,
                  changedSummary(u),
                ],
              }))}
              headers={[
                t('integrations.isidata.col.matricola'),
                t('integrations.isidata.col.name'),
                t('integrations.isidata.col.changes'),
              ]}
            />
          </Section>
        )}

        {showOrphan && diff.toOrphan.length > 0 && (
          <Section
            title={t('integrations.isidata.orphan_section')}
            count={diff.toOrphan.length}
            accent="amber"
            warning
          >
            <DiffTable
              rows={diff.toOrphan.map((u) => ({
                key: `${u.id}`,
                cells: [
                  u.matricola ?? u.email ?? `#${u.id}`,
                  `${u.lastName} ${u.firstName}`,
                  u.email ?? '—',
                  roleLabel(u.role, t),
                  u.isActive
                    ? t('integrations.isidata.orphan_will_disable')
                    : t('integrations.isidata.orphan_already_disabled'),
                ],
              }))}
              headers={[
                t('integrations.isidata.col.matricola'),
                t('integrations.isidata.col.name'),
                t('integrations.isidata.col.email'),
                t('integrations.isidata.col.role'),
                t('integrations.isidata.col.action'),
              ]}
            />
          </Section>
        )}

        {summary.toCreate + summary.toUpdate + summary.toOrphan === 0 && (
          <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            {t('integrations.isidata.nothing_to_apply')}
          </div>
        )}

        {softWarn.length > 0 && (
          <section
            className="rounded-lg border border-muted-foreground/20 bg-muted/30 p-3 text-sm"
            data-testid="soft-warnings"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between font-medium"
              onClick={() => setSoftOpen((v) => !v)}
              aria-expanded={softOpen}
            >
              <span className="flex items-center gap-2">
                {softOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                {t('integrations.isidata.soft_warnings_title', { count: softWarn.length })}
              </span>
            </button>
            {softOpen && (
              <ul className="mt-2 list-disc space-y-1 pl-7 text-xs text-muted-foreground">
                {softWarn.map((w, i) => (
                  <li key={i}>{w.msg}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>{t('integrations.isidata.confirm_label')}</span>
          </label>
          {criticalWarnings.length > 0 && (
            <label
              className="flex cursor-pointer items-start gap-3 border-t border-rose-300/40 pt-2 text-sm font-medium text-rose-900 dark:text-rose-200"
              data-testid="critical-ack-label"
            >
              <input
                type="checkbox"
                checked={criticalAck}
                onChange={(e) => setCriticalAck(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input"
                data-testid="critical-ack-checkbox"
              />
              <span>{t('integrations.isidata.confirm_critical_label')}</span>
            </label>
          )}
        </div>

        <div className="flex flex-col-reverse items-stretch justify-between gap-2 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground">
            {t('integrations.isidata.hash_label')}:{' '}
            <code className="font-mono">{preview.hash.slice(0, 12)}…</code>
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack} disabled={applying}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={onApply}
              data-testid="apply-button"
              disabled={
                !confirmed ||
                !mappingValid ||
                (criticalWarnings.length > 0 && !criticalAck) ||
                applying ||
                summary.toCreate + summary.toUpdate + summary.toOrphan === 0
              }
            >
              {applying && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('integrations.isidata.apply_action')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// I campi in `local`/`external` sono primitivi (string/number/boolean/null).
// `formatPrimitive` proietta a stringa solo i primitivi: se per errore
// arrivasse un oggetto annidato (mai oggi, ma robusto a evoluzioni schema)
// emette '?' invece di '[object Object]'.
function formatPrimitive(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return v.toString();
  }
  return '?';
}

function changedSummary(u: ToUpdateItem): string {
  const localRec = u.local as unknown as Record<string, unknown>;
  const externalRec = u.external as unknown as Record<string, unknown>;
  const items: string[] = [];
  for (const f of u.fieldsChanged) {
    items.push(`${f}: ${formatPrimitive(localRec[f])} → ${formatPrimitive(externalRec[f])}`);
  }
  if (u.linkChanged) items.push('externalId');
  return items.length > 0 ? items.join(' · ') : '—';
}

function roleLabel(role: string, t: ReturnType<typeof useTranslation>['t']) {
  if (role === 'docente') return t('integrations.isidata.role.docente');
  if (role === 'studente') return t('integrations.isidata.role.studente');
  return role;
}

function SummaryTile({
  icon: Icon,
  value,
  label,
  color,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  color: 'emerald' | 'sky' | 'amber' | 'muted';
  active: boolean;
  onClick: () => void;
}) {
  const tones = {
    emerald:
      'bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200/70 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30',
    amber:
      'bg-amber-50 text-amber-800 ring-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30',
    muted: 'bg-muted text-foreground/80 ring-muted-foreground/20',
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition',
        tones[color],
        active && 'ring-2 ring-offset-2',
      )}
    >
      <Icon className="h-5 w-5" />
      <div>
        <p className="font-display text-2xl font-medium leading-none">{value}</p>
        <p className="mt-1 text-[0.625rem] uppercase tracking-wider opacity-80">{label}</p>
      </div>
    </button>
  );
}

function Section({
  title,
  count,
  accent,
  warning,
  children,
}: {
  title: string;
  count: number;
  accent: 'emerald' | 'sky' | 'amber';
  warning?: boolean;
  children: React.ReactNode;
}) {
  const accents = {
    emerald:
      'border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/5',
    sky: 'border-sky-300/60 bg-sky-50/40 dark:border-sky-500/30 dark:bg-sky-500/5',
    amber: 'border-amber-300/60 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-500/5',
  } as const;
  return (
    <section className={cn('rounded-xl border p-4', accents[accent])}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-lg font-medium">
          {title} <span className="ml-2 text-sm text-muted-foreground">({count})</span>
        </h3>
        {warning && (
          <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
            <ShieldAlert className="mr-1 h-3 w-3" /> soft-disable
          </Badge>
        )}
      </div>
      {children}
    </section>
  );
}

function DiffTable({
  rows,
  headers,
}: {
  rows: { key: string; cells: (string | number)[] }[];
  headers: string[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r) => (
            <tr key={r.key} className="border-t">
              {r.cells.map((c, i) => (
                <td key={i} className="px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 && (
        <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          + {rows.length - 200} righe ulteriori non mostrate
        </p>
      )}
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
    partial: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    failed: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
    in_progress: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
    preview: 'bg-muted text-foreground/70',
  };
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[0.625rem] font-medium uppercase',
        map[status] ?? map.preview,
      )}
    >
      {status}
    </span>
  );
}

// =====================================================
// MappingCard (Miglioria 1): tabella di mapping campo-per-campo.
// Sostituisce il vecchio Textarea JSON con dropdown per ciascun target
// canonico. L'admin può modificare e rilanciare la preview "live".
// =====================================================
function MappingCard({
  preview,
  currentMapping,
  onChange,
  onReload,
  onResetAuto,
  reloading,
}: {
  preview: PreviewResponse;
  currentMapping: EffectiveMapping;
  onChange: (m: EffectiveMapping) => void;
  onReload: () => void;
  onResetAuto: () => void;
  reloading: boolean;
}) {
  const { t } = useTranslation();
  const auto = preview.autoDetected ?? emptyMapping();
  const headers = preview.detectedHeaders ?? preview.headers;

  const setField = (target: TargetField, header: string | null) => {
    onChange({ ...currentMapping, [target]: header });
  };

  // Calcola "dirty": l'admin ha modificato qualcosa rispetto al mapping
  // che il backend sta effettivamente usando. Usiamo effectiveMapping (non
  // autoDetected) per non confondere "ho cambiato manualmente" con "uso
  // override già spediti".
  const effective = preview.effectiveMapping ?? auto;
  const dirty = useMemo(() => {
    for (const k of TARGET_FIELDS) {
      if ((currentMapping[k] ?? null) !== (effective[k] ?? null)) return true;
    }
    return false;
  }, [currentMapping, effective]);

  return (
    <Card data-testid="mapping-card">
      <CardHeader>
        <CardTitle className="text-base">{t('integrations.isidata.mapping_title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('integrations.isidata.mapping_hint')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t('integrations.isidata.mapping_col.target')}</th>
                <th className="px-3 py-2">{t('integrations.isidata.mapping_col.header')}</th>
                <th className="px-3 py-2">{t('integrations.isidata.mapping_col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {TARGET_FIELDS.map((target) => {
                const value = currentMapping[target] ?? '';
                const autoVal = auto[target] ?? null;
                const isRequired = REQUIRED_FIELDS.includes(target);
                const status: MappingRowStatus = computeRowStatus({
                  value: value || null,
                  autoVal,
                  isRequired,
                });
                return (
                  <tr key={target} className="border-t" data-testid={`mapping-row-${target}`}>
                    <td className="px-3 py-2 align-middle">
                      <span className="font-medium">
                        {t(`integrations.isidata.target.${target}`)}
                      </span>
                      {isRequired && (
                        <span className="ml-1 text-xs text-rose-700 dark:text-rose-300">*</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {/* Native select: i radix select non supportano value="" e
                       *  per la UI di mapping è una sciocchezza implementarci
                       *  un componente custom. Stile minimo per coerenza. */}
                      <select
                        aria-label={t('integrations.isidata.mapping_aria_select', {
                          target: t(`integrations.isidata.target.${target}`),
                        })}
                        data-testid={`mapping-select-${target}`}
                        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-sm shadow-xs focus:outline-hidden focus:ring-2 focus:ring-ring"
                        value={value}
                        onChange={(e) => setField(target, e.target.value || null)}
                      >
                        <option value="">{t('integrations.isidata.mapping_unmapped')}</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 align-middle text-xs">
                      <MappingStatusBadge status={status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col items-stretch justify-end gap-2 sm:flex-row sm:items-center">
          <Button variant="ghost" size="sm" onClick={onResetAuto} data-testid="mapping-reset-auto">
            <RotateCcw className="h-4 w-4" /> {t('integrations.isidata.mapping_reset_auto')}
          </Button>
          <Button
            size="sm"
            onClick={onReload}
            disabled={!dirty || reloading}
            data-testid="mapping-reload"
          >
            {reloading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('integrations.isidata.mapping_reload')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type MappingRowStatus = 'auto' | 'manual' | 'missing' | 'optional';

function computeRowStatus({
  value,
  autoVal,
  isRequired,
}: {
  value: string | null;
  autoVal: string | null;
  isRequired: boolean;
}): MappingRowStatus {
  if (!value) {
    return isRequired ? 'missing' : 'optional';
  }
  return value === autoVal ? 'auto' : 'manual';
}

function MappingStatusBadge({ status }: { status: MappingRowStatus }) {
  const { t } = useTranslation();
  const tones: Record<MappingRowStatus, string> = {
    auto: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
    manual: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
    missing: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
    optional: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[0.625rem] font-medium uppercase',
        tones[status],
      )}
    >
      {t(`integrations.isidata.mapping_status.${status}`)}
    </span>
  );
}

// =====================================================
// CompareRunDialog (Miglioria 2): apre un dialog con il diff di
// "ultimi 2 run". Carica via API on-demand (mount con runId valorizzato).
// =====================================================
function CompareRunDialog({ runId, onClose }: { runId: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const open = runId !== null;
  const query = useQuery({
    queryKey: ['admin', 'integrations', 'compare', runId],
    queryFn: () => {
      if (runId === null) throw new Error('runId required');
      return integrationsApi.comparePrevious(runId);
    },
    enabled: open,
    // Niente refetch automatico: il run è immutabile, la comparison anche.
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent data-testid="compare-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" />
            {t('integrations.isidata.compare_title')}
          </DialogTitle>
          <DialogDescription>{t('integrations.isidata.compare_subtitle')}</DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : query.isError ? (
          <p className="text-sm text-rose-700 dark:text-rose-300">
            {httpErrorMessage(query.error)}
          </p>
        ) : query.data ? (
          <CompareRunBody data={query.data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CompareRunBody({ data }: { data: CompareRunsResponse }) {
  const { t } = useTranslation();
  if (!data.hasPrevious || !data.changes) {
    return (
      <p className="rounded-lg border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        {t('integrations.isidata.compare_empty')}
      </p>
    );
  }
  const { changes, previous, current } = data;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">
        <p>
          {t('integrations.isidata.compare_header', {
            current: current.id,
            previous: previous?.id ?? '?',
            date: previous ? dayjs(previous.startedAt).format('D MMM YYYY · HH:mm') : '',
          })}
        </p>
      </div>
      <section
        data-testid="compare-delta"
        className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/20 p-3"
      >
        <DeltaTile
          label={t('integrations.isidata.compare_delta_create')}
          value={changes.delta.create}
        />
        <DeltaTile
          label={t('integrations.isidata.compare_delta_update')}
          value={changes.delta.update}
        />
        <DeltaTile
          label={t('integrations.isidata.compare_delta_deactivate')}
          value={changes.delta.deactivate}
        />
      </section>
      <MatricolaList
        title={t('integrations.isidata.compare_newly_created', {
          count: changes.newlyCreatedMatricole.length,
        })}
        accent="emerald"
        items={changes.newlyCreatedMatricole}
        testId="compare-newly-created"
      />
      <MatricolaList
        title={t('integrations.isidata.compare_newly_deactivated', {
          count: changes.newlyDeactivatedMatricole.length,
        })}
        accent="rose"
        items={changes.newlyDeactivatedMatricole}
        testId="compare-newly-deactivated"
      />
      <MatricolaList
        title={t('integrations.isidata.compare_repeat_updates', {
          count: changes.repeatUpdatesMatricole.length,
        })}
        accent="amber"
        items={changes.repeatUpdatesMatricole}
        hint={t('integrations.isidata.compare_repeat_updates_hint')}
        testId="compare-repeat-updates"
      />
      <MatricolaList
        title={t('integrations.isidata.compare_recovered', {
          count: changes.recoveredMatricole.length,
        })}
        accent="violet"
        items={changes.recoveredMatricole}
        testId="compare-recovered"
      />
    </div>
  );
}

function DeltaTile({ label, value }: { label: string; value: number }) {
  const sign = value > 0 ? '+' : '';
  const tone =
    value > 0
      ? 'text-emerald-700 dark:text-emerald-300'
      : value < 0
        ? 'text-rose-700 dark:text-rose-300'
        : 'text-muted-foreground';
  return (
    <div className="rounded-md bg-card p-2 text-center">
      <p className={cn('font-display text-xl font-medium', tone)}>
        {sign}
        {value}
      </p>
      <p className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function MatricolaList({
  title,
  accent,
  items,
  hint,
  testId,
}: {
  title: string;
  accent: 'emerald' | 'rose' | 'amber' | 'violet';
  items: string[];
  hint?: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const accents: Record<typeof accent, string> = {
    emerald: 'border-emerald-300/60',
    rose: 'border-rose-300/60',
    amber: 'border-amber-300/60',
    violet: 'border-violet-300/60',
  };
  return (
    <section className={cn('rounded-lg border p-3 text-sm', accents[accent])} data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-center justify-between font-medium"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {title}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {hint && <p className="text-xs italic text-muted-foreground">{hint}</p>}
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">—</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {items.slice(0, 200).map((m) => (
                <li
                  key={m}
                  className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground/80"
                >
                  {m}
                </li>
              ))}
              {items.length > 200 && (
                <li className="text-xs text-muted-foreground">+{items.length - 200}…</li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// Used by ExternalUser row ordering — silences ESLint about unused imports
// in some test environments. Safe to keep.
export type _IsidataPreviewRow = ExternalUser | ToOrphanItem;
