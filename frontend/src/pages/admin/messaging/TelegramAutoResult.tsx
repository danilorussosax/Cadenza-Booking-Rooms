import { useTranslation } from 'react-i18next';
import { CheckCircle2, Sparkles, XCircle } from 'lucide-react';
import type { TelegramAutoConfigureResult } from '@/api/messaging';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

// =============================================================================
// Pannello esito auto-configure Telegram: una checklist di step + warning.
// =============================================================================
export function TelegramAutoResult({ result }: { result: TelegramAutoConfigureResult }) {
  const { t } = useTranslation();
  const stepEntries: { key: keyof TelegramAutoConfigureResult['steps']; labelKey: string }[] = [
    { key: 'getMe', labelKey: 'admin.messaging.telegram.auto.step_getMe' },
    { key: 'setWebhook', labelKey: 'admin.messaging.telegram.auto.step_setWebhook' },
    { key: 'setMyCommands', labelKey: 'admin.messaging.telegram.auto.step_setMyCommands' },
    { key: 'setMyDescription', labelKey: 'admin.messaging.telegram.auto.step_setMyDescription' },
    {
      key: 'setMyShortDescription',
      labelKey: 'admin.messaging.telegram.auto.step_setMyShortDescription',
    },
    { key: 'getWebhookInfo', labelKey: 'admin.messaging.telegram.auto.step_getWebhookInfo' },
  ];

  return (
    <Alert variant="info" className="space-y-2">
      <Sparkles className="h-4 w-4" />
      <AlertDescription>
        <div className="space-y-2">
          <p className="text-sm">
            <strong>
              {t('admin.messaging.telegram.auto.summary', {
                username: result.bot?.username ?? '?',
              })}
            </strong>
          </p>
          <p className="text-xs text-muted-foreground">
            {t('admin.messaging.telegram.auto.webhook_url')}{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{result.webhookUrl}</code>
            {result.secretGenerated && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {t('admin.messaging.telegram.auto.secret_generated')}
              </Badge>
            )}
          </p>
          <ul className="space-y-1 text-xs">
            {stepEntries.map(({ key, labelKey }) => {
              const step = result.steps[key];
              if (!step) return null;
              return (
                <li key={key} className="flex items-center gap-2">
                  {step.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  )}
                  <span className={step.ok ? '' : 'text-muted-foreground'}>{t(labelKey)}</span>
                  {key === 'setMyCommands' && 'count' in step && step.count != null && (
                    <Badge variant="outline" className="text-[10px]">
                      {step.count}
                    </Badge>
                  )}
                  {!step.ok && 'error' in step && step.error && (
                    <span className="text-[11px] text-muted-foreground">— {step.error}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {result.warnings && result.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs text-amber-700 dark:text-amber-300">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
