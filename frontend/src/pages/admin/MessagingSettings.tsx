import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
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
  type TelegramAutoConfigureResult,
  type TelegramWebhookInfo,
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
import {
  buildCredentialsPayload,
  fieldError,
  initialCreds,
  initialSettings,
} from '@/lib/messagingForm';
import { qk } from '@/lib/queryKeys';
import { invalidateMessagingSettings } from '@/lib/invalidation';

import { CHANNELS, defaultRow, type ChannelDef } from './messaging/channels';
import { GuidedSteps } from './messaging/GuidedSteps';
import { TelegramAutoResult } from './messaging/TelegramAutoResult';

// =============================================================================
// /admin/messaging — configurazione dei 4 canali bot.
//
// Per ogni canale: card con toggle on/off + form credenziali (secret placeholder
// per non rileggere mai i valori sensibili) + pulsante test connessione.
// =============================================================================

export default function AdminMessagingSettings() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: qk.admin.messagingSettings(),
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

function ChannelCard({ def, row }: { def: ChannelDef; row: ChannelSettingsRow }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Baseline derivata dal salvato: ri-usata per inizializzare E per resettare
  // il form dopo un salvataggio riuscito (così `dirty` torna false e i secret
  // tornano a placeholder invece di restare in chiaro nello state).
  // Baseline derivata dal salvato: ri-usata per inizializzare E per resettare
  // il form dopo un salvataggio riuscito (così `dirty` torna false e i secret
  // tornano a placeholder invece di restare in chiaro nello state).
  const credsBaseline = (r: ChannelSettingsRow) => initialCreds(def.fields, r);
  const settingsBaseline = (r: ChannelSettingsRow) => initialSettings(def.settingsFields ?? [], r);

  const [enabled, setEnabled] = useState(row.isEnabled);
  const [creds, setCreds] = useState<Record<string, string>>(() => credsBaseline(row));
  const [settings, setSettings] = useState<Record<string, string>>(() => settingsBaseline(row));
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  // `dirty`: ci sono modifiche non salvate. Gate dell'auto-configure (che usa il
  // token SALVATO nel DB) → impedisce di configurare con un token solo digitato.
  const [dirty, setDirty] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    error?: string;
    info?: Record<string, unknown>;
  } | null>(null);

  const saveMutation = useMutation({
    mutationFn: (payload: ChannelSettingsUpdate) =>
      messagingSettingsApi.update(def.channel, payload),
    onSuccess: (res) => {
      toast.success(t('admin.messaging.toast.saved'));
      setEnabled(res.isEnabled);
      setCreds(credsBaseline(res));
      setSettings(settingsBaseline(res));
      setDirty(false);
      void invalidateMessagingSettings(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  // Errori di validazione campo (es. formato botToken). Blocca Salva.
  const fieldErrors = def.fields
    .map((f) => ({ key: f.key, err: fieldError(f.validate, creds[f.key] ?? '') }))
    .filter((x) => x.err);
  const hasFieldError = fieldErrors.length > 0;

  // Verifica stato webhook (Telegram getWebhookInfo) — solo canali `guided`.
  const [webhookInfo, setWebhookInfo] = useState<TelegramWebhookInfo | null>(null);
  const webhookInfoMutation = useMutation({
    mutationFn: () => messagingSettingsApi.telegramWebhookInfo(),
    onSuccess: (res) => setWebhookInfo(res),
    onError: (err) => setWebhookInfo({ ok: false, error: httpErrorMessage(err) }),
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
      setDirty(false);
      // Rinfresca lo stato webhook reale così il pannello passaggi si aggiorna.
      webhookInfoMutation.mutate();
      void invalidateMessagingSettings(qc);
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
    const credsPayload = buildCredentialsPayload(creds);
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
              onCheckedChange={(v) => {
                setEnabled(v);
                setDirty(true);
              }}
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
                    setDirty(true);
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
            const err = fieldError(f.validate, creds[f.key] ?? '');
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
                    setDirty(true);
                  }}
                  aria-invalid={err ? true : undefined}
                  className={err ? 'border-destructive focus-visible:ring-destructive' : undefined}
                  placeholder={
                    isPlaceholder
                      ? t('admin.messaging.secret_configured')
                      : (f.placeholder ?? t('admin.messaging.secret_enter'))
                  }
                />
                {err === 'invalid_token' && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    {t('admin.messaging.telegram.token_invalid')}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Credenziali auto-generate (read-only): es. webhook secret Telegram */}
        {def.autoGeneratedKeys && def.autoGeneratedKeys.length > 0 && (
          <div className="space-y-1.5">
            {def.autoGeneratedKeys.map((g) => {
              const present = Boolean(row.credentialsSet[g.key]);
              return (
                <div
                  key={g.key}
                  className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs"
                >
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">{t(g.labelKey)}</span>
                  {present ? (
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {t('admin.messaging.telegram.autogen_present')}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      {t('admin.messaging.telegram.autogen_missing')}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Setup guide */}
        <Alert variant="info">
          <AlertDescription className="whitespace-pre-line text-xs">
            {t(def.setupGuideKey)}
          </AlertDescription>
        </Alert>

        {/* Passaggi guidati + verifica webhook (Telegram) */}
        {def.guided && (
          <GuidedSteps
            tokenSaved={Boolean(row.credentialsSet.botToken)}
            dirty={dirty}
            enabled={row.isEnabled}
            webhookInfo={webhookInfo}
            verifying={webhookInfoMutation.isPending}
            onVerify={() => {
              webhookInfoMutation.mutate();
            }}
          />
        )}

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

        {/* Motivo per cui auto-configure è bloccato (Telegram) */}
        {def.channel === 'telegram' &&
          (() => {
            const tokenSaved = Boolean(row.credentialsSet.botToken);
            const blockMsg = !tokenSaved
              ? t('admin.messaging.telegram.gate_no_token')
              : dirty
                ? t('admin.messaging.telegram.gate_dirty')
                : hasFieldError
                  ? t('admin.messaging.telegram.gate_invalid')
                  : null;
            return blockMsg ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {blockMsg}
              </p>
            ) : null;
          })()}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {def.channel === 'telegram' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                autoConfigureMutation.mutate();
              }}
              disabled={
                autoConfigureMutation.isPending ||
                // Serve un token GIÀ salvato (auto-configure usa il DB, non il
                // campo), nessuna modifica pendente e nessun errore di formato.
                !row.credentialsSet.botToken ||
                dirty ||
                hasFieldError
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
          <Button onClick={handleSave} disabled={saveMutation.isPending || !dirty || hasFieldError}>
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
