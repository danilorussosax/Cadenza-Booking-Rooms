import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clock, Guitar, Info, Package } from 'lucide-react';
import { toast } from 'sonner';
import { institutesApi, type ModuleSettings } from '@/api/institutes';
import { api, httpErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Pannello admin: tab "Moduli" della pagina Impostazioni Server.
 *
 * Da v2.x i toggle **non sono più solo presentazionali**: oltre a nascondere
 * il link in sidebar, disattivano davvero le rotte del modulo (il backend
 * ritorna 404 con codice `MODULE_DISABLED`). Le pagine corrispondenti
 * mostrano un placeholder "Modulo non attivo" invece di errori generici.
 *
 * I moduli sono caricati dinamicamente da `/api/structure/module-settings/registry`:
 * aggiungerne uno nuovo richiede solo una entry in `services/moduleFlags.js`
 * (no modifiche a questa UI).
 */

interface ModuleDef {
  key: string;
  column: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

// Icone Lucide ai moduli noti — niente icona = fallback "Package" generico.
const ICON_BY_KEY: Record<string, { icon: React.ReactNode; bg: string }> = {
  monteOre: {
    icon: <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
    bg: 'bg-amber-100 dark:bg-amber-500/15',
  },
  instrumentLoans: {
    icon: <Guitar className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />,
    bg: 'bg-emerald-100 dark:bg-emerald-500/15',
  },
};
const FALLBACK_ICON = {
  icon: <Package className="h-5 w-5 text-muted-foreground" />,
  bg: 'bg-muted',
};

export default function AdminModules() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Registry dei moduli disponibili — fonte di verità per icone, label,
  // descrizioni e ordine di visualizzazione.
  const registryQuery = useQuery({
    queryKey: ['admin', 'module-settings', 'registry'],
    queryFn: () => api<{ modules: ModuleDef[] }>('/api/structure/module-settings/registry'),
    staleTime: 5 * 60 * 1000,
  });

  // Valori correnti dei flag (booleani indicizzati per colonna DB).
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

  const settings = settingsQuery.data as Record<string, boolean> | undefined;
  const isLoading = registryQuery.isLoading || settingsQuery.isLoading;
  const modules = registryQuery.data?.modules ?? [];

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
        <CardContent className="space-y-4 pt-0 sm:pt-0">
          {isLoading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : (
            <>
              {modules.map((m) => {
                const visual = ICON_BY_KEY[m.key] ?? FALLBACK_ICON;
                const checked = settings ? settings[m.column] : m.defaultEnabled;
                return (
                  <ModuleRow
                    key={m.key}
                    icon={visual.icon}
                    iconBg={visual.bg}
                    label={m.label}
                    description={m.description}
                    checked={checked}
                    disabled={mutation.isPending}
                    onChange={(v) => {
                      mutation.mutate({ [m.column]: v });
                    }}
                  />
                );
              })}
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
