import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Save,
  Send,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  messagingSettingsApi,
  SECRET_PLACEHOLDER,
  type ChannelSettingsRow,
  type ChannelSettingsUpdate,
  type MessagingChannel,
  type TelegramAutoConfigureResult,
} from '@/api/messaging';
import { httpErrorMessage } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

// =============================================================================
// /admin/messaging — configurazione dei 4 canali bot.
//
// Per ogni canale: card con toggle on/off + form credenziali (secret placeholder
// per non rileggere mai i valori sensibili) + pulsante test connessione.
// =============================================================================

interface ChannelDef {
  channel: MessagingChannel;
  label: string;
  helpKey: string;
  /** Campi credenziali necessari (chiave secret + tipo password/text). */
  fields: { key: string; labelKey: string; type: 'text' | 'password'; placeholder?: string }[];
  /** Campi non-secret in `settings` (visibili in chiaro). */
  settingsFields?: { key: string; labelKey: string; placeholder?: string }[];
  setupGuideKey: string;
}

const CHANNELS: ChannelDef[] = [
  {
    channel: 'telegram',
    label: 'Telegram',
    helpKey: 'admin.messaging.telegram.help',
    fields: [
      {
        key: 'botToken',
        labelKey: 'admin.messaging.telegram.bot_token',
        type: 'password',
        placeholder: '12345:AAAA…',
      },
      {
        key: 'webhookSecret',
        labelKey: 'admin.messaging.telegram.webhook_secret',
        type: 'password',
        placeholder: 'random hex 32 char',
      },
    ],
    setupGuideKey: 'admin.messaging.telegram.setup_guide',
  },
  {
    channel: 'whatsapp_cloud',
    label: 'WhatsApp Cloud API',
    helpKey: 'admin.messaging.whatsapp.help',
    fields: [
      { key: 'accessToken', labelKey: 'admin.messaging.whatsapp.access_token', type: 'password' },
      { key: 'phoneNumberId', labelKey: 'admin.messaging.whatsapp.phone_id', type: 'text' },
      { key: 'verifyToken', labelKey: 'admin.messaging.whatsapp.verify_token', type: 'password' },
      { key: 'appSecret', labelKey: 'admin.messaging.whatsapp.app_secret', type: 'password' },
    ],
    setupGuideKey: 'admin.messaging.whatsapp.setup_guide',
  },
  {
    channel: 'signal_cli',
    label: 'Signal',
    helpKey: 'admin.messaging.signal.help',
    fields: [
      { key: 'webhookSecret', labelKey: 'admin.messaging.signal.webhook_secret', type: 'password' },
    ],
    settingsFields: [
      {
        key: 'phoneNumber',
        labelKey: 'admin.messaging.signal.phone_number',
        placeholder: '+39333…',
      },
      {
        key: 'daemonUrl',
        labelKey: 'admin.messaging.signal.daemon_url',
        placeholder: 'http://signal:8080',
      },
    ],
    setupGuideKey: 'admin.messaging.signal.setup_guide',
  },
  {
    channel: 'email_imap',
    label: 'Email (IMAP)',
    helpKey: 'admin.messaging.email.help',
    fields: [{ key: 'pass', labelKey: 'admin.messaging.email.password', type: 'password' }],
    settingsFields: [
      { key: 'host', labelKey: 'admin.messaging.email.host', placeholder: 'imap.example.it' },
      { key: 'port', labelKey: 'admin.messaging.email.port', placeholder: '993' },
      { key: 'user', labelKey: 'admin.messaging.email.user', placeholder: 'book@conservatorio.it' },
    ],
    setupGuideKey: 'admin.messaging.email.setup_guide',
  },
];

export default function AdminMessagingSettings() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['admin', 'messaging-settings'],
    queryFn: () => messagingSettingsApi.list(),
  });
  const byChannel = new Map(query.data?.settings.map((r) => [r.channel, r]) ?? []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />
          {t('admin.messaging.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('admin.messaging.subtitle')}</p>
      </header>

      {query.isLoading && <Skeleton className="h-96 w-full" />}

      {!query.isLoading &&
        CHANNELS.map((ch) => (
          <ChannelCard
            key={ch.channel}
            def={ch}
            row={byChannel.get(ch.channel) ?? defaultRow(ch.channel)}
          />
        ))}
    </div>
  );
}

function defaultRow(channel: MessagingChannel): ChannelSettingsRow {
  return { channel, isEnabled: false, settings: {}, credentialsSet: {} };
}

function ChannelCard({ def, row }: { def: ChannelDef; row: ChannelSettingsRow }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(row.isEnabled);
  const [creds, setCreds] = useState<Record<string, string>>(() => {
    // Inizializza con SECRET_PLACEHOLDER per i campi già configurati
    const out: Record<string, string> = {};
    for (const f of def.fields) {
      out[f.key] = row.credentialsSet[f.key] ? SECRET_PLACEHOLDER : '';
    }
    return out;
  });
  const [settings, setSettings] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of def.settingsFields ?? []) {
      const v = row.settings[f.key];
      // Solo valori scalari finiscono nei form (gli admin configurano stringhe).
      out[f.key] = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
    }
    return out;
  });
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    error?: string;
    info?: Record<string, unknown>;
  } | null>(null);

  const saveMutation = useMutation({
    mutationFn: (payload: ChannelSettingsUpdate) =>
      messagingSettingsApi.update(def.channel, payload),
    onSuccess: () => {
      toast.success(t('admin.messaging.toast.saved'));
      void qc.invalidateQueries({ queryKey: ['admin', 'messaging-settings'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const testMutation = useMutation({
    mutationFn: () => messagingSettingsApi.test(def.channel),
    onSuccess: (res) => {
      setTestResult(res);
    },
    onError: (err) => {
      setTestResult({ ok: false, error: httpErrorMessage(err) });
    },
  });

  const [autoResult, setAutoResult] = useState<TelegramAutoConfigureResult | null>(null);
  const autoConfigureMutation = useMutation({
    mutationFn: () => messagingSettingsApi.autoConfigureTelegram(),
    onSuccess: (res) => {
      setAutoResult(res);
      setEnabled(res.isEnabled);
      void qc.invalidateQueries({ queryKey: ['admin', 'messaging-settings'] });
      const warn = res.warnings?.length ? ` · ${res.warnings.length} warning` : '';
      toast.success(
        t('admin.messaging.telegram.auto.toast_ok', { username: res.bot?.username ?? '' }) + warn,
      );
    },
    onError: (err) => {
      toast.error(httpErrorMessage(err));
      setAutoResult(null);
    },
  });

  const handleSave = () => {
    // Filtra credenziali: skip i SECRET_PLACEHOLDER (mantengono il valore precedente).
    const credsPayload: Record<string, string> = {};
    for (const [k, v] of Object.entries(creds)) {
      if (v && v !== SECRET_PLACEHOLDER) credsPayload[k] = v;
      else if (v === SECRET_PLACEHOLDER) credsPayload[k] = SECRET_PLACEHOLDER;
      else credsPayload[k] = ''; // svuota
    }
    saveMutation.mutate({ isEnabled: enabled, settings, credentials: credsPayload });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
          <span className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            {def.label}
          </span>
          <div className="flex items-center gap-3">
            {row.isEnabled && (
              <Badge variant="success">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                {t('admin.messaging.badge.enabled')}
              </Badge>
            )}
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label={t('admin.messaging.toggle_aria', { channel: def.label })}
            />
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pt-0 sm:pt-0">
        <p className="text-sm text-muted-foreground">{t(def.helpKey)}</p>

        {/* Settings non-secret */}
        {def.settingsFields && def.settingsFields.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {def.settingsFields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`${def.channel}-${f.key}`}>{t(f.labelKey)}</Label>
                <Input
                  id={`${def.channel}-${f.key}`}
                  value={settings[f.key] ?? ''}
                  onChange={(e) => {
                    setSettings((s) => ({ ...s, [f.key]: e.target.value }));
                  }}
                  placeholder={f.placeholder}
                />
              </div>
            ))}
          </div>
        )}

        {/* Credenziali (secret) */}
        <div className="grid gap-3 sm:grid-cols-2">
          {def.fields.map((f) => {
            const isPlaceholder = creds[f.key] === SECRET_PLACEHOLDER;
            const visible = showSecret[f.key] ?? false;
            return (
              <div key={f.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`${def.channel}-${f.key}`} className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    {t(f.labelKey)}
                  </Label>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      setShowSecret((s) => ({ ...s, [f.key]: !visible }));
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {visible ? (
                      <EyeOff className="inline h-3.5 w-3.5" />
                    ) : (
                      <Eye className="inline h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <Input
                  id={`${def.channel}-${f.key}`}
                  type={f.type === 'password' && !visible ? 'password' : 'text'}
                  value={isPlaceholder ? '' : (creds[f.key] ?? '')}
                  onChange={(e) => {
                    setCreds((c) => ({ ...c, [f.key]: e.target.value }));
                  }}
                  placeholder={
                    isPlaceholder
                      ? t('admin.messaging.secret_configured')
                      : (f.placeholder ?? t('admin.messaging.secret_enter'))
                  }
                />
              </div>
            );
          })}
        </div>

        {/* Setup guide */}
        <Alert variant="info">
          <AlertDescription className="whitespace-pre-line text-xs">
            {t(def.setupGuideKey)}
          </AlertDescription>
        </Alert>

        {/* Test result */}
        {testResult && (
          <Alert variant={testResult.ok ? 'info' : 'destructive'}>
            {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            <AlertDescription>
              {testResult.ok
                ? t('admin.messaging.test.ok', { info: JSON.stringify(testResult.info ?? {}) })
                : t('admin.messaging.test.error', { error: testResult.error })}
            </AlertDescription>
          </Alert>
        )}

        {/* Telegram auto-configure result */}
        {def.channel === 'telegram' && autoResult && <TelegramAutoResult result={autoResult} />}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {def.channel === 'telegram' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                autoConfigureMutation.mutate();
              }}
              disabled={
                autoConfigureMutation.isPending ||
                // Disabilita se il botToken non è ancora salvato (placeholder o vuoto)
                (!row.credentialsSet.botToken && creds.botToken === '')
              }
              title={t('admin.messaging.telegram.auto.button_title')}
            >
              {autoConfigureMutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t('admin.messaging.telegram.auto.button')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              testMutation.mutate();
            }}
            disabled={testMutation.isPending || !row.isEnabled}
          >
            {testMutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
            <Send className="h-4 w-4" />
            {t('admin.messaging.test_button')}
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t('common.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Pannello esito auto-configure Telegram: una checklist di step + warning.
// =============================================================================
function TelegramAutoResult({ result }: { result: TelegramAutoConfigureResult }) {
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
