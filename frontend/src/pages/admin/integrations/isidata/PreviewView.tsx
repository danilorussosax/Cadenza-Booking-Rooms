import { changedSummary, roleLabel } from '@/pages/admin/integrations/isidata/isidataHelpers';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { type PreviewResponse } from '@/api/integrations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildProviderTk } from '@/pages/admin/integrations/isidata/isidataHelpers';
import { SummaryTile, Section, DiffTable } from '@/pages/admin/integrations/isidata/PreviewParts';
// =====================================================
// Preview view: 3 sezioni colorate (verde/blu/ambra) + filtro per categoria
// =====================================================
export function PreviewView({
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
  // PreviewView serve sia isidata che esse3: per ora le stringhe della
  // preview sono comuni, ma usiamo tk per consentire override per-provider
  // se necessario in futuro (es. dropzone_label, kpi.* personalizzate).
  const tk = buildProviderTk(t, 'isidata');
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
            <CardTitle>{tk('step2_title')}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{tk('preview_hint')}</p>
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
            label={tk('kpi.create')}
            onClick={() => onFilterChange('create')}
            active={filter === 'create'}
          />
          <SummaryTile
            color="sky"
            icon={UserCheck}
            value={summary.toUpdate}
            label={tk('kpi.update')}
            onClick={() => onFilterChange('update')}
            active={filter === 'update'}
          />
          <SummaryTile
            color="amber"
            icon={UserX}
            value={summary.toOrphan}
            label={tk('kpi.orphan')}
            onClick={() => onFilterChange('orphan')}
            active={filter === 'orphan'}
          />
          <SummaryTile
            color="muted"
            icon={FileSpreadsheet}
            value={summary.fetched}
            label={tk('kpi.fetched')}
            onClick={() => onFilterChange('all')}
            active={filter === 'all'}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-0 sm:pt-0">
        {criticalWarnings.length > 0 && (
          <div
            className="rounded-lg border-2 border-rose-400 bg-rose-50 p-4 text-sm dark:border-rose-500/50 dark:bg-rose-500/10"
            data-testid="safety-critical"
            role="alert"
          >
            <p className="flex items-center gap-2 font-semibold text-rose-900 dark:text-rose-200">
              <AlertTriangle className="h-5 w-5" />
              {tk('safety.critical_title')}
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
              {tk('safety.warning_title')}
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
              {tk('warnings_count', { count: summary.warnings.length })}
            </p>
            <ul className="mt-2 max-h-32 list-disc space-y-1 overflow-auto pl-5 text-xs text-amber-900 dark:text-amber-200">
              {summary.warnings.slice(0, 50).map((w, i) => (
                <li key={i}>
                  {w.row ? (
                    <span className="font-semibold">{tk('row', { row: w.row })}: </span>
                  ) : null}
                  {w.msg}
                </li>
              ))}
            </ul>
          </div>
        )}

        {showCreate && diff.toCreate.length > 0 && (
          <Section title={tk('create_section')} count={diff.toCreate.length} accent="emerald">
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
                tk('col.matricola'),
                tk('col.name'),
                tk('col.email'),
                tk('col.role'),
                tk('col.course'),
              ]}
            />
          </Section>
        )}

        {showUpdate && diff.toUpdate.length > 0 && (
          <Section title={tk('update_section')} count={diff.toUpdate.length} accent="sky">
            <DiffTable
              rows={diff.toUpdate.map((u) => ({
                key: `${u.local.id}`,
                cells: [
                  u.local.matricola ?? u.local.email ?? `#${u.local.id}`,
                  `${u.local.lastName} ${u.local.firstName}`,
                  changedSummary(u),
                ],
              }))}
              headers={[tk('col.matricola'), tk('col.name'), tk('col.changes')]}
            />
          </Section>
        )}

        {showOrphan && diff.toOrphan.length > 0 && (
          <Section title={tk('orphan_section')} count={diff.toOrphan.length} accent="amber" warning>
            <DiffTable
              rows={diff.toOrphan.map((u) => ({
                key: `${u.id}`,
                cells: [
                  u.matricola ?? u.email ?? `#${u.id}`,
                  `${u.lastName} ${u.firstName}`,
                  u.email ?? '—',
                  roleLabel(u.role, t),
                  u.isActive ? tk('orphan_will_disable') : tk('orphan_already_disabled'),
                ],
              }))}
              headers={[
                tk('col.matricola'),
                tk('col.name'),
                tk('col.email'),
                tk('col.role'),
                tk('col.action'),
              ]}
            />
          </Section>
        )}

        {summary.toCreate + summary.toUpdate + summary.toOrphan === 0 && (
          <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            {tk('nothing_to_apply')}
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
                {tk('soft_warnings_title', { count: softWarn.length })}
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
            <span>{tk('confirm_label')}</span>
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
              <span>{tk('confirm_critical_label')}</span>
            </label>
          )}
        </div>

        <div className="flex flex-col-reverse items-stretch justify-between gap-2 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground">
            {tk('hash_label')}: <code className="font-mono">{preview.hash.slice(0, 12)}…</code>
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
              {tk('apply_action')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
