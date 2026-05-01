import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clock, Guitar, Info } from 'lucide-react';
import { toast } from 'sonner';
import { institutesApi, type ModuleSettings } from '@/api/institutes';
import { httpErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Pannello admin: tab "Moduli" della pagina Impostazioni Server.
 *
 * I toggle sono **puramente di presentazione**: il backend espone sempre
 * tutte le rotte (Monte Ore + Prestito strumenti). Disattivando il
 * modulo si nasconde solo il link nella sidebar — i bookmark, le API e
 * i dati esistenti continuano a funzionare.
 */
export default function AdminModules() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['admin', 'module-settings'],
    queryFn: () => institutesApi.getModuleSettings(),
  });

  const mutation = useMutation({
    mutationFn: (body: Partial<ModuleSettings>) => institutesApi.updateModuleSettings(body),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'module-settings'], data);
      // La sidebar legge i flag dall'institute "public": invalidalo per
      // far sparire/comparire i link senza dover ricaricare la pagina.
      void qc.invalidateQueries({ queryKey: ['institute', 'public'] });
      toast.success(t('admin.server_settings.modules.saved'));
    },
    onError: (err) => {
      toast.error(t('admin.server_settings.modules.save_failed'), {
        description: httpErrorMessage(err),
      });
    },
  });

  const settings = settingsQuery.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base font-medium">
            {t('admin.server_settings.modules.title')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('admin.server_settings.modules.subtitle')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsQuery.isLoading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : (
            <>
              <ModuleRow
                icon={<Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
                iconBg="bg-amber-100 dark:bg-amber-500/15"
                label={t('admin.server_settings.modules.monte_ore_label')}
                description={t('admin.server_settings.modules.monte_ore_description')}
                checked={!!settings?.moduleMonteOreEnabled}
                disabled={mutation.isPending}
                onChange={(v) => {
                  mutation.mutate({ moduleMonteOreEnabled: v });
                }}
              />
              <ModuleRow
                icon={<Guitar className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
                iconBg="bg-emerald-100 dark:bg-emerald-500/15"
                label={t('admin.server_settings.modules.instrument_loans_label')}
                description={t('admin.server_settings.modules.instrument_loans_description')}
                checked={!!settings?.moduleInstrumentLoansEnabled}
                disabled={mutation.isPending}
                onChange={(v) => {
                  mutation.mutate({ moduleInstrumentLoansEnabled: v });
                }}
              />
              <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{t('admin.server_settings.modules.backend_note')}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ModuleRow({
  icon,
  iconBg,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4 rounded-lg border bg-card p-4">
      <div className={`shrink-0 rounded-lg p-2.5 ${iconBg}`}>{icon}</div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium leading-tight">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
