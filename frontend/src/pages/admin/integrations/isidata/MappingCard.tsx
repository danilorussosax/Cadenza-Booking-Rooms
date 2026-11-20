import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RotateCcw } from 'lucide-react';
import { type EffectiveMapping, type PreviewResponse } from '@/api/integrations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  TARGET_FIELDS,
  REQUIRED_FIELDS,
  computeRowStatus,
  emptyMapping,
  type MappingRowStatus,
  type TargetField,
} from '@/lib/isidataMapping';
import { buildProviderTk } from '@/pages/admin/integrations/isidata/isidataHelpers';
// =====================================================
// MappingCard (Miglioria 1): tabella di mapping campo-per-campo.
// Sostituisce il vecchio Textarea JSON con dropdown per ciascun target
// canonico. L'admin può modificare e rilanciare la preview "live".
// =====================================================
export function MappingCard({
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
  const tk = buildProviderTk(t, 'isidata');
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
        <CardTitle className="text-base">{tk('mapping_title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{tk('mapping_hint')}</p>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 sm:pt-0">
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{tk('mapping_col.target')}</th>
                <th className="px-3 py-2">{tk('mapping_col.header')}</th>
                <th className="px-3 py-2">{tk('mapping_col.status')}</th>
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
                        aria-label={tk('mapping_aria_select', {
                          target: t(`integrations.isidata.target.${target}`),
                        })}
                        data-testid={`mapping-select-${target}`}
                        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-sm shadow-xs focus:outline-hidden focus:ring-2 focus:ring-ring"
                        value={value}
                        onChange={(e) => setField(target, e.target.value || null)}
                      >
                        <option value="">{tk('mapping_unmapped')}</option>
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
            <RotateCcw className="h-4 w-4" /> {tk('mapping_reset_auto')}
          </Button>
          <Button
            size="sm"
            onClick={onReload}
            disabled={!dirty || reloading}
            data-testid="mapping-reload"
          >
            {reloading && <Loader2 className="h-4 w-4 animate-spin" />}
            {tk('mapping_reload')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function MappingStatusBadge({ status }: { status: MappingRowStatus }) {
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
