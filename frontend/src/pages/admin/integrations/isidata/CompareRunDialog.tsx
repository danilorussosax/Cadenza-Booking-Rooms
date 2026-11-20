import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, GitCompare } from 'lucide-react';
import { httpErrorMessage } from '@/lib/api';
import { integrationsApi, type CompareRunsResponse } from '@/api/integrations';
import { dayjs } from '@/lib/date';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { qk } from '@/lib/queryKeys';
import { buildProviderTk } from '@/pages/admin/integrations/isidata/isidataHelpers';
// =====================================================
// CompareRunDialog (Miglioria 2): apre un dialog con il diff di
// "ultimi 2 run". Carica via API on-demand (mount con runId valorizzato).
// =====================================================
export function CompareRunDialog({
  runId,
  onClose,
}: {
  runId: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // CompareRunDialog non riceve `source` esplicito (è sempre invocato dal
  // wizard isidata/esse3 ma i contenuti del dialog non variano fra i due
  // provider): usiamo i18n isidata come baseline.
  const tk = buildProviderTk(t, 'isidata');
  const open = runId !== null;
  const query = useQuery({
    queryKey: qk.admin.integrationsCompare(runId),
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
            {tk('compare_title')}
          </DialogTitle>
          <DialogDescription>{tk('compare_subtitle')}</DialogDescription>
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

export function CompareRunBody({ data }: { data: CompareRunsResponse }) {
  const { t } = useTranslation();
  const tk = buildProviderTk(t, 'isidata');
  if (!data.hasPrevious || !data.changes) {
    return (
      <p className="rounded-lg border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        {tk('compare_empty')}
      </p>
    );
  }
  const { changes, previous, current } = data;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">
        <p>
          {tk('compare_header', {
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
        <DeltaTile label={tk('compare_delta_create')} value={changes.delta.create} />
        <DeltaTile label={tk('compare_delta_update')} value={changes.delta.update} />
        <DeltaTile label={tk('compare_delta_deactivate')} value={changes.delta.deactivate} />
      </section>
      <MatricolaList
        title={tk('compare_newly_created', {
          count: changes.newlyCreatedMatricole.length,
        })}
        accent="emerald"
        items={changes.newlyCreatedMatricole}
        testId="compare-newly-created"
      />
      <MatricolaList
        title={tk('compare_newly_deactivated', {
          count: changes.newlyDeactivatedMatricole.length,
        })}
        accent="rose"
        items={changes.newlyDeactivatedMatricole}
        testId="compare-newly-deactivated"
      />
      <MatricolaList
        title={tk('compare_repeat_updates', {
          count: changes.repeatUpdatesMatricole.length,
        })}
        accent="amber"
        items={changes.repeatUpdatesMatricole}
        hint={tk('compare_repeat_updates_hint')}
        testId="compare-repeat-updates"
      />
      <MatricolaList
        title={tk('compare_recovered', {
          count: changes.recoveredMatricole.length,
        })}
        accent="violet"
        items={changes.recoveredMatricole}
        testId="compare-recovered"
      />
    </div>
  );
}

export function DeltaTile({ label, value }: { label: string; value: number }) {
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

export function MatricolaList({
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
