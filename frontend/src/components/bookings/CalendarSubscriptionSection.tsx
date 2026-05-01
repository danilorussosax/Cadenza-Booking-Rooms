import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Copy, Eye, EyeOff, LoaderCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/api/auth';
import { httpErrorMessage } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function CalendarSubscriptionSection() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  // Default revealed=true: senza il token visibile l'input mostrava
  // `webcal://…?token=••••••••` che alcuni utenti leggevano come un
  // placeholder ("il token non è stato generato") anziché come un
  // mascheramento. La sicurezza è già delegata all'Alert di warning.
  const [revealed, setRevealed] = useState(true);

  const tokenQuery = useQuery({
    queryKey: ['auth', 'ical-token'],
    queryFn: () => authApi.getIcalToken(),
    staleTime: Infinity,
    retry: 1,
  });

  const regenerateMutation = useMutation({
    mutationFn: () => authApi.regenerateIcalToken(),
    onSuccess: ({ token }) => {
      toast.success(t('calendar_subscription.regenerated'));
      qc.setQueryData(['auth', 'ical-token'], { token });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const token = tokenQuery.data?.token ?? '';

  // Costruisce due URL: webcal:// (sottoscrizione) e https:// (download diretto).
  const httpUrl = token ? `${window.location.origin}/api/bookings/ical?token=${token}` : '';
  const webcalUrl = httpUrl.replace(/^https?:/, 'webcal:');

  // Copia con fallback per HTTP / non-secure-context.
  //
  // navigator.clipboard.writeText richiede HTTPS o localhost (Secure Context).
  // In HTTP nudo (es. VPS esposto su IP, niente cert) `navigator.clipboard`
  // è `undefined` su Chromium/Firefox e l'await esplode → silent fail.
  // execCommand('copy') è deprecato ma è ancora l'unico fallback affidabile
  // in non-secure-context su browser moderni.
  const copy = async (value: string, label: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('execCommand copy returned false');
      }
      toast.success(t('calendar_subscription.copied', { label }));
    } catch {
      toast.error(t('calendar_subscription.copy_failed'));
    }
  };

  // Quando l'input è mascherato (revealed=false) il `value` contiene `••••••••`.
  // Se l'utente seleziona e fa Ctrl+C manualmente, copia i pallini → il backend
  // riceve `token=••••••••` (8 char) e risponde INVALID_TOKEN. Intercettiamo
  // l'evento onCopy e mettiamo nel clipboard il valore reale, indipendentemente
  // da cosa è selezionato a video.
  const handleMaskedCopy = (real: string) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (revealed) return; // input non mascherato: lascia il default del browser
    e.preventDefault();
    e.clipboardData.setData('text/plain', real);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <CalendarPlus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          {t('calendar_subscription.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('calendar_subscription.description')}</p>

        {tokenQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">{t('calendar_subscription.loading')}</p>
        ) : tokenQuery.isError ? (
          <Alert variant="destructive">
            <AlertDescription className="space-y-2 text-xs">
              <p>{httpErrorMessage(tokenQuery.error)}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void tokenQuery.refetch();
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('calendar_subscription.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ical-webcal" className="flex items-center gap-1.5">
                <CalendarPlus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                {t('calendar_subscription.webcal_label')}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ical-webcal"
                  readOnly
                  value={revealed ? webcalUrl : webcalUrl.replace(/token=.*/, 'token=••••••••')}
                  onFocus={(e) => {
                    e.target.select();
                  }}
                  onCopy={handleMaskedCopy(webcalUrl)}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRevealed((v) => !v);
                  }}
                  title={
                    revealed
                      ? t('calendar_subscription.hide_token')
                      : t('calendar_subscription.show_token')
                  }
                >
                  {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(webcalUrl, t('calendar_subscription.label_webcal'))}
                  title={t('calendar_subscription.copy_link')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t('calendar_subscription.webcal_help')}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ical-https">{t('calendar_subscription.https_label')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ical-https"
                  readOnly
                  value={revealed ? httpUrl : httpUrl.replace(/token=.*/, 'token=••••••••')}
                  onFocus={(e) => {
                    e.target.select();
                  }}
                  onCopy={handleMaskedCopy(httpUrl)}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(httpUrl, t('calendar_subscription.label_https'))}
                  title={t('calendar_subscription.copy_link')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <Alert variant="info">
              <AlertDescription className="text-xs">
                {t('calendar_subscription.warning')}
              </AlertDescription>
            </Alert>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (window.confirm(t('calendar_subscription.regenerate_confirm'))) {
                    regenerateMutation.mutate();
                  }
                }}
                disabled={regenerateMutation.isPending}
                className="text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-500/10"
              >
                {regenerateMutation.isPending ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {t('calendar_subscription.regenerate')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
