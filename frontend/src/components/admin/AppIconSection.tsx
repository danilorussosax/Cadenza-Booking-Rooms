import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, ImageIcon, RotateCcw, AlertCircle, LoaderCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { appIconsApi } from '@/api/appIcons';
import { institutesApi } from '@/api/institutes';
import { useAppIcon } from '@/hooks/useAppIcon';
import { cn } from '@/lib/utils';
import { httpErrorMessage } from '@/lib/api';

const DEFAULT_ICON = '/logo3.png';

/**
 * Sezione del profilo riservata agli admin: permette di scegliere l'icona
 * app fra i file PNG/SVG presenti in `frontend/public/logo-app/`.
 *
 * Persistenza: l'URL viene salvato in `Institute.appIconUrl` (admin-only via
 * PUT). Tutti gli utenti la leggono via l'endpoint pubblico, quindi la
 * modifica si propaga ovunque (login, sidebar, schermi di benvenuto).
 *
 * Il componente NON viene renderizzato per ruoli != admin (gating in
 * Profile.tsx). Comunque qui c'è una guard difensiva.
 */
export function AppIconSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const current = useAppIcon();

  const iconsQuery = useQuery({
    queryKey: ['app-icons'],
    queryFn: () => appIconsApi.list(),
    staleTime: 60 * 1000,
  });

  const instituteQuery = useQuery({
    queryKey: ['institute', 'public'],
    queryFn: () => institutesApi.public(),
    staleTime: 5 * 60 * 1000,
  });

  const updateMutation = useMutation({
    mutationFn: async (newIconUrl: string | null) => {
      const id = instituteQuery.data?.institute?.id;
      if (!id) throw new Error('Istituto non disponibile');
      return institutesApi.update(id, { appIconUrl: newIconUrl });
    },
    onSuccess: async () => {
      // La query pubblica è la stessa sorgente usata da useAppIcon ovunque
      // → invalidare la chiave aggiorna login, sidebar, ecc. in tempo reale.
      await qc.invalidateQueries({ queryKey: ['institute', 'public'] });
      toast.success(t('profile.app_icon.saved'));
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const icons = iconsQuery.data?.icons ?? [];
  const isCustom = current !== DEFAULT_ICON;
  const saving = updateMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <ImageIcon className="h-5 w-5 text-primary" />
          {t('profile.app_icon.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0 sm:pt-0">
        <p className="text-sm text-muted-foreground">{t('profile.app_icon.description')}</p>

        {iconsQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{httpErrorMessage(iconsQuery.error)}</AlertDescription>
          </Alert>
        )}

        {iconsQuery.isLoading && (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}

        {!iconsQuery.isLoading && icons.length === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{t('profile.app_icon.empty_folder')}</AlertDescription>
          </Alert>
        )}

        {icons.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {icons.map((icon) => {
              const selected = current === icon.url;
              return (
                <button
                  key={icon.name}
                  type="button"
                  disabled={saving || selected}
                  onClick={() => {
                    updateMutation.mutate(icon.url);
                  }}
                  className={cn(
                    'group relative flex aspect-square items-center justify-center rounded-lg border bg-background p-3 transition-all',
                    'hover:border-primary hover:shadow-md',
                    'disabled:cursor-not-allowed',
                    selected
                      ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'border-border',
                    saving && !selected ? 'opacity-50' : '',
                  )}
                  aria-label={icon.name}
                  aria-pressed={selected}
                >
                  <img
                    src={icon.url}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                    loading="lazy"
                  />
                  {selected && (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  <span className="pointer-events-none absolute inset-x-0 -bottom-5 truncate text-center text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    {icon.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">{t('profile.app_icon.add_hint')}</p>
          <div className="flex items-center gap-2">
            {saving && <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />}
            {isCustom && (
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  updateMutation.mutate(null);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('profile.app_icon.reset')}
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs italic text-muted-foreground">
          {t('profile.app_icon.admin_only_hint')}
        </p>
      </CardContent>
    </Card>
  );
}
