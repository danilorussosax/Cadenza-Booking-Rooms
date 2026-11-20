import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Circle,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type { TelegramWebhookInfo } from '@/api/messaging';
import { Button } from '@/components/ui/button';
import { displayWebhookUrl } from '@/lib/messagingForm';

// =============================================================================
// Pannello passaggi guidati Telegram: checklist dell'ordine corretto
// (token → salva → configura → verifica) con stato live + verifica webhook.
// =============================================================================
export function GuidedSteps({
  tokenSaved,
  dirty,
  enabled,
  webhookInfo,
  verifying,
  onVerify,
}: {
  tokenSaved: boolean;
  dirty: boolean;
  enabled: boolean;
  webhookInfo: TelegramWebhookInfo | null;
  verifying: boolean;
  onVerify: () => void;
}) {
  const { t } = useTranslation();
  const webhookOk = webhookInfo?.ok === true && webhookInfo.matches === true;

  const steps: { labelKey: string; done: boolean; warn?: boolean }[] = [
    { labelKey: 'admin.messaging.telegram.steps.token', done: tokenSaved },
    { labelKey: 'admin.messaging.telegram.steps.save', done: tokenSaved && !dirty, warn: dirty },
    { labelKey: 'admin.messaging.telegram.steps.configure', done: webhookOk },
    { labelKey: 'admin.messaging.telegram.steps.enable', done: enabled },
  ];

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t('admin.messaging.telegram.steps.title')}
      </p>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.labelKey} className="flex items-center gap-2 text-xs">
            {s.done ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : s.warn ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            )}
            <span className={s.done ? 'text-foreground' : 'text-muted-foreground'}>
              <span className="mr-1 font-medium">{i + 1}.</span>
              {t(s.labelKey)}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onVerify}
          disabled={verifying || !tokenSaved}
          title={t('admin.messaging.telegram.verify.button_title')}
        >
          {verifying ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t('admin.messaging.telegram.verify.button')}
        </Button>
      </div>

      {webhookInfo && (
        <div className="rounded-md border bg-background px-3 py-2 text-xs">
          {!webhookInfo.ok ? (
            <p className="flex items-center gap-1.5 text-destructive">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              {t('admin.messaging.telegram.verify.error', { error: webhookInfo.error ?? '' })}
            </p>
          ) : (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5">
                {webhookInfo.matches ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-medium text-emerald-700 dark:text-emerald-300">
                      {t('admin.messaging.telegram.verify.active')}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="font-medium text-amber-700 dark:text-amber-300">
                      {webhookInfo.hasWebhook
                        ? t('admin.messaging.telegram.verify.mismatch')
                        : t('admin.messaging.telegram.verify.none')}
                    </span>
                  </>
                )}
              </p>
              <p className="text-muted-foreground">
                {t('admin.messaging.telegram.verify.url')}{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                  {displayWebhookUrl(webhookInfo)}
                </code>
              </p>
              {!webhookInfo.matches && webhookInfo.expectedUrl && (
                <p className="text-muted-foreground">
                  {t('admin.messaging.telegram.verify.expected')}{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                    {webhookInfo.expectedUrl}
                  </code>
                </p>
              )}
              <p className="text-muted-foreground">
                {t('admin.messaging.telegram.verify.pending', {
                  count: webhookInfo.pendingUpdateCount ?? 0,
                })}
                {webhookInfo.lastErrorMessage
                  ? ` · ${t('admin.messaging.telegram.verify.last_error', {
                      error: webhookInfo.lastErrorMessage,
                    })}`
                  : ''}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
