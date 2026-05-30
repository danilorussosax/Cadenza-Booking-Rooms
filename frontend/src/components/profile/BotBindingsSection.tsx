import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bot, Copy, ExternalLink, LoaderCircle, MessagesSquare, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { botBindingsApi, type BotBinding, type MessagingChannel } from '@/api/messaging';
import { httpErrorMessage } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// =============================================================================
// /profile · Bot messaging
//
// Permette all'utente di:
//   - Vedere i bindings attivi (ChatId mascherato + ultimo accesso)
//   - Generare un OTP da inviare a un bot per collegare il proprio account
//   - Revocare un binding esistente
//
// Il binding effettivo avviene nel canale: l'utente apre la chat col bot e
// scrive `bind <OTP>`. Lato server `services/messaging` consuma la challenge
// e crea la riga BotBinding.
// =============================================================================

const CHANNEL_LABEL: Record<MessagingChannel, string> = {
  telegram: 'Telegram',
  whatsapp_cloud: 'WhatsApp',
  signal_cli: 'Signal',
  email_imap: 'Email',
};

const CHANNEL_ACCENT: Record<MessagingChannel, string> = {
  telegram: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  whatsapp_cloud: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  signal_cli: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  email_imap: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

export function BotBindingsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pendingOtp, setPendingOtp] = useState<{ otp: string; expiresInMinutes: number } | null>(
    null,
  );

  const listQuery = useQuery({
    queryKey: ['users', 'me', 'bot-bindings'],
    queryFn: () => botBindingsApi.list(),
    staleTime: 30_000,
  });

  const initMutation = useMutation({
    mutationFn: () => botBindingsApi.init(),
    onSuccess: (res) => {
      setPendingOtp(res);
      toast.success(t('profile.bot_bindings.toast.otp_generated'));
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => botBindingsApi.revoke(id),
    onSuccess: () => {
      toast.success(t('profile.bot_bindings.toast.revoked'));
      void qc.invalidateQueries({ queryKey: ['users', 'me', 'bot-bindings'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const bindings = listQuery.data?.bindings ?? [];

  const copyOtp = async () => {
    if (!pendingOtp) return;
    try {
      await navigator.clipboard.writeText(`bind ${pendingOtp.otp}`);
      toast.success(t('profile.bot_bindings.toast.copied'));
    } catch {
      toast.error(t('profile.bot_bindings.toast.copy_failed'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
          <span className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            {t('profile.bot_bindings.title')}
          </span>
          <Button
            size="sm"
            onClick={() => {
              initMutation.mutate();
            }}
            disabled={initMutation.isPending}
          >
            {initMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t('profile.bot_bindings.generate_code')}
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pt-0 sm:pt-0">
        <p className="text-sm text-muted-foreground">{t('profile.bot_bindings.subtitle')}</p>

        {/* OTP appena generato */}
        {pendingOtp && (
          <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <MessagesSquare className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-semibold">
                  {t('profile.bot_bindings.otp_title', { minutes: pendingOtp.expiresInMinutes })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('profile.bot_bindings.otp_help')}
                </p>
                <div className="flex flex-wrap items-center gap-3 rounded bg-background p-3">
                  <code className="select-all font-mono text-2xl font-bold tracking-widest text-primary">
                    bind {pendingOtp.otp}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void copyOtp();
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t('common.copy')}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t('profile.bot_bindings.otp_send_hint')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Bindings attivi */}
        {listQuery.isLoading && (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
        {!listQuery.isLoading && bindings.length === 0 && (
          <Alert variant="info">
            <AlertDescription>{t('profile.bot_bindings.empty')}</AlertDescription>
          </Alert>
        )}
        {bindings.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {bindings.map((b) => (
              <BindingRow
                key={b.id}
                binding={b}
                onRevoke={() => {
                  revokeMutation.mutate(b.id);
                }}
                busy={revokeMutation.isPending}
              />
            ))}
          </ul>
        )}

        {/* Link guida */}
        <p className="text-xs text-muted-foreground">
          <ExternalLink className="-mt-0.5 mr-1 inline h-3 w-3" />
          {t('profile.bot_bindings.guide_text')}
        </p>
      </CardContent>
    </Card>
  );
}

function BindingRow({
  binding,
  onRevoke,
  busy,
}: {
  binding: BotBinding;
  onRevoke: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
      <Badge className={CHANNEL_ACCENT[binding.channel]} variant="muted">
        {CHANNEL_LABEL[binding.channel]}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-foreground">{binding.externalIdMasked}</p>
        <p className="text-[11px] text-muted-foreground">
          {t('profile.bot_bindings.bound_at', { date: new Date(binding.boundAt).toLocaleString() })}
          {binding.lastSeenAt && (
            <>
              {' '}
              ·{' '}
              {t('profile.bot_bindings.last_seen', {
                date: new Date(binding.lastSeenAt).toLocaleString(),
              })}
            </>
          )}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        title={t('common.delete')}
        onClick={onRevoke}
        disabled={busy}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}
