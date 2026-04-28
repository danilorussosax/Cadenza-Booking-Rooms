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
  History,
  Loader2,
  ShieldAlert,
  Upload,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { httpErrorMessage } from '@/lib/api';
import {
  integrationsApi,
  type ExternalUser,
  type PreviewResponse,
  type ToOrphanItem,
  type ToUpdateItem,
} from '@/api/integrations';
import { dayjs } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

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
 */
export function IsidataImportContent() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [overridesText, setOverridesText] = useState('');
  const [overridesError, setOverridesError] = useState<string | null>(null);
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [filter, setFilter] = useState<'all' | 'create' | 'update' | 'orphan'>('all');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewMutation = useMutation({
    mutationFn: (input: { file: File; overrides?: Record<string, string> }) =>
      integrationsApi.preview(input.file, input.overrides),
    onSuccess: (data) => {
      setPreview(data);
      setStep('preview');
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('no preview');
      return integrationsApi.apply({
        token: preview.token,
        confirmedDiffHash: preview.hash,
      });
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
    queryKey: ['admin', 'integrations', 'runs', 'isidata'],
    queryFn: () => integrationsApi.runs({ provider: 'isidata', limit: 20 }),
  });

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };
  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
  };

  const parsedOverrides = useMemo(() => {
    if (!overridesText.trim()) return undefined;
    try {
      const obj = JSON.parse(overridesText);
      if (typeof obj !== 'object' || Array.isArray(obj) || obj === null) {
        throw new Error('non è un oggetto JSON');
      }
      return obj as Record<string, string>;
    } catch {
      return null;
    }
  }, [overridesText]);

  const handlePreview = () => {
    setOverridesError(null);
    if (!file) return;
    if (overridesText.trim() && parsedOverrides === null) {
      setOverridesError(t('integrations.isidata.overrides_invalid'));
      return;
    }
    previewMutation.mutate({ file, overrides: parsedOverrides ?? undefined });
  };

  const reset = () => {
    setFile(null);
    setOverridesText('');
    setPreview(null);
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

            <div className="rounded-lg border bg-muted/20 p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-sm font-medium"
                onClick={() => setOverridesOpen((v) => !v)}
              >
                <span className="flex items-center gap-2">
                  {overridesOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {t('integrations.isidata.overrides_title')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('integrations.isidata.overrides_hint_short')}
                </span>
              </button>
              {overridesOpen && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {t('integrations.isidata.overrides_help')}
                  </p>
                  <Label htmlFor="overrides">{t('integrations.isidata.overrides_label')}</Label>
                  <Input
                    id="overrides"
                    placeholder='{"externalId": "Numero matricola", "email": "Email istituzionale"}'
                    value={overridesText}
                    onChange={(e) => setOverridesText(e.target.value)}
                  />
                  {overridesError && <p className="text-xs text-destructive">{overridesError}</p>}
                </div>
              )}
            </div>

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
        <PreviewView
          preview={preview}
          filter={filter}
          onFilterChange={setFilter}
          onBack={reset}
          onApply={() => applyMutation.mutate()}
          applying={applyMutation.isPending}
        />
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
                  <RunStatusBadge status={r.status} />
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
}: {
  preview: PreviewResponse;
  filter: 'all' | 'create' | 'update' | 'orphan';
  onFilterChange: (f: 'all' | 'create' | 'update' | 'orphan') => void;
  onBack: () => void;
  onApply: () => void;
  applying: boolean;
}) {
  const { t } = useTranslation();
  const { summary, diff } = preview;
  const showCreate = filter === 'all' || filter === 'create';
  const showUpdate = filter === 'all' || filter === 'update';
  const showOrphan = filter === 'all' || filter === 'orphan';
  const [confirmed, setConfirmed] = useState(false);

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

        <div className="rounded-lg border bg-muted/30 p-3">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>{t('integrations.isidata.confirm_label')}</span>
          </label>
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
              disabled={
                !confirmed ||
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

function changedSummary(u: ToUpdateItem): string {
  const items: string[] = [];
  for (const f of u.fieldsChanged) {
    const before = String((u.local as Record<string, unknown>)[f] ?? '—');
    const after = String((u.external as unknown as Record<string, unknown>)[f] ?? '—');
    items.push(`${f}: ${before} → ${after}`);
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

// Used by ExternalUser row ordering — silences ESLint about unused imports
// in some test environments. Safe to keep.
export type _IsidataPreviewRow = ExternalUser | ToOrphanItem;
