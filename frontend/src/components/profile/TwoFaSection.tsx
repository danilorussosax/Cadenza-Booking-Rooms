import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  Mail,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { authApi } from '@/api/auth';
import { httpErrorMessage } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { User } from '@/types';

// =============================================================================
// Sezione "Sicurezza · Verifica in due passaggi (codice via email)" del profilo.
//
// Stati UX:
//   - DISABLED      : utente senza 2FA → toggle "Attiva" che fa /2fa/setup
//                     (il backend manda subito un codice 6 cifre via email).
//                     UI mostra "Codice inviato a m***@example.it" + input.
//   - ENABLED       : 2FA attivo → mostra "Attivato il …", recovery codes
//                     residui, bottoni "Rigenera recovery codes" e "Disattiva"
//                     (entrambi richiedono un nuovo codice email).
//
// I recovery codes plain-text sono restituiti UNA volta (post enrollment o
// post rigenerazione): la UI li mostra in un blocco con "Copia" e "Stampa".
// =============================================================================

interface Props {
  user: User;
  updateUser: (u: Partial<User>) => void;
}

export function TwoFaSection({ user, updateUser }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [setupSent, setSetupSent] = useState<{ sentTo: string; expiresInMinutes: number } | null>(
    null,
  );
  const [confirmCode, setConfirmCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // "Pre-flight" per le azioni che richiedono un codice email mentre il 2FA
  // è già attivo (rigenera recovery / disabilita): l'utente cliccando il
  // bottone manda un nuovo codice via email e poi lo inserisce.
  const [secureFlow, setSecureFlow] = useState<'regen' | 'disable' | null>(null);
  const [secureCode, setSecureCode] = useState('');
  const [secureError, setSecureError] = useState<string | null>(null);
  const [secureSent, setSecureSent] = useState<{ sentTo: string; expiresInMinutes: number } | null>(
    null,
  );

  const statusQuery = useQuery({
    queryKey: ['auth', '2fa', 'status'],
    queryFn: () => authApi.twoFaStatus(),
    staleTime: 30_000,
  });

  const setupMutation = useMutation({
    mutationFn: () => authApi.twoFaSetup(),
    onSuccess: (res) => {
      setSetupSent(res);
      setConfirmCode('');
      toast.success(t('profile.twofa.toast.code_sent', { email: res.sentTo }));
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const resendMutation = useMutation({
    mutationFn: () => authApi.twoFaResend(),
    onSuccess: (res) => {
      setSetupSent(res);
      setConfirmCode('');
      toast.success(t('profile.twofa.toast.code_resent'));
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const confirmMutation = useMutation({
    mutationFn: (code: string) => authApi.twoFaConfirmSetup(code),
    onSuccess: ({ recoveryCodes: codes }) => {
      setRecoveryCodes(codes);
      setSetupSent(null);
      setConfirmCode('');
      updateUser({ twoFaEnabled: true });
      void qc.invalidateQueries({ queryKey: ['auth', '2fa', 'status'] });
      toast.success(t('profile.twofa.toast.enabled'));
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const regenerateMutation = useMutation({
    mutationFn: (code: string) => authApi.twoFaRegenerateRecovery(code),
    onSuccess: ({ recoveryCodes: codes }) => {
      setRecoveryCodes(codes);
      setSecureFlow(null);
      setSecureCode('');
      setSecureSent(null);
      toast.success(t('profile.twofa.toast.recovery_regenerated'));
      void qc.invalidateQueries({ queryKey: ['auth', '2fa', 'status'] });
    },
    onError: (err) => {
      setSecureError(httpErrorMessage(err));
    },
  });

  const disableMutation = useMutation({
    mutationFn: (code: string) => authApi.twoFaDisable(code),
    onSuccess: () => {
      setSecureFlow(null);
      setSecureCode('');
      setSecureSent(null);
      setRecoveryCodes(null);
      updateUser({ twoFaEnabled: false });
      void qc.invalidateQueries({ queryKey: ['auth', '2fa', 'status'] });
      toast.success(t('profile.twofa.toast.disabled'));
    },
    onError: (err) => {
      setSecureError(httpErrorMessage(err));
    },
  });

  const sendSecureCode = useMutation({
    mutationFn: () => authApi.twoFaResend(),
    onSuccess: (res) => {
      setSecureSent(res);
      setSecureCode('');
      setSecureError(null);
    },
    onError: (err) => {
      setSecureError(httpErrorMessage(err));
    },
  });

  const enabled = statusQuery.data?.enabled ?? user.twoFaEnabled ?? false;
  const recoveryRemaining = statusQuery.data?.recoveryCodesRemaining ?? 0;
  const activatedAt = statusQuery.data?.activatedAt ?? user.twoFaActivatedAt ?? null;
  const userEmail = statusQuery.data?.email ?? '';

  const handleToggle = (next: boolean) => {
    if (next) {
      // Avvia setup: backend manda il codice via email.
      setupMutation.mutate();
    } else {
      // Disattivazione: serve un codice email valido.
      setSecureFlow('disable');
      setSecureError(null);
      sendSecureCode.mutate();
    }
  };

  const startRegenerateFlow = () => {
    setSecureFlow('regen');
    setSecureError(null);
    sendSecureCode.mutate();
  };

  const submitSecureFlow = () => {
    if (!secureFlow) return;
    if (secureFlow === 'regen') regenerateMutation.mutate(secureCode.trim());
    else disableMutation.mutate(secureCode.trim());
  };

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      toast.success(t('profile.twofa.recovery.copied'));
    } catch {
      toast.error(t('profile.twofa.recovery.copy_failed'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {t('profile.twofa.title')}
          </span>
          <div className="flex items-center gap-3">
            {enabled && (
              <Badge variant="success">
                <Check className="mr-1 h-3 w-3" />
                {t('profile.twofa.badge.enabled')}
              </Badge>
            )}
            <Switch
              checked={enabled || !!setupSent}
              onCheckedChange={handleToggle}
              aria-label={t('profile.twofa.toggle_aria')}
              disabled={
                setupMutation.isPending || disableMutation.isPending || sendSecureCode.isPending
              }
            />
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('profile.twofa.subtitle_email', { email: userEmail || user.email })}
        </p>

        {user.role === 'admin' && !enabled && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{t('profile.twofa.admin_required')}</AlertDescription>
          </Alert>
        )}

        {/* Stage: setup avviato (codice email inviato) */}
        {setupSent && !enabled && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="space-y-1">
                <p className="font-medium">
                  {t('profile.twofa.setup.sent_title', { email: setupSent.sentTo })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('profile.twofa.setup.sent_help', { minutes: setupSent.expiresInMinutes })}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-code">{t('profile.twofa.setup.code_label')}</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="confirm-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="••• •••"
                  value={confirmCode}
                  onChange={(e) => {
                    setConfirmCode(e.target.value);
                  }}
                  className="font-mono tracking-widest"
                  autoFocus
                />
                <Button
                  onClick={() => {
                    confirmMutation.mutate(confirmCode.trim());
                  }}
                  disabled={confirmMutation.isPending || !/^\d{6}$/.test(confirmCode.trim())}
                >
                  {confirmMutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  {t('profile.twofa.setup.confirm')}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  resendMutation.mutate();
                }}
                disabled={resendMutation.isPending}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {resendMutation.isPending
                  ? t('profile.twofa.setup.resending')
                  : t('profile.twofa.setup.resend')}
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSetupSent(null);
                  setConfirmCode('');
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* Stage: 2FA attivo */}
        {enabled && !secureFlow && (
          <div className="space-y-3">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">{t('profile.twofa.activated_at')}</p>
                <p className="font-medium">
                  {activatedAt ? new Date(activatedAt).toLocaleString() : '—'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('profile.twofa.recovery.remaining')}</p>
                <p className="font-medium">{recoveryRemaining}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={startRegenerateFlow}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('profile.twofa.recovery.regenerate')}
            </Button>
          </div>
        )}

        {/* Recovery codes appena generati / rigenerati: visibili UNA volta */}
        {recoveryCodes && (
          <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  {t('profile.twofa.recovery.title')}
                </p>
                <p className="text-xs text-amber-900 dark:text-amber-200">
                  {t('profile.twofa.recovery.help')}
                </p>
                <ul className="grid grid-cols-1 gap-1 rounded bg-background p-3 font-mono text-xs sm:grid-cols-2">
                  {recoveryCodes.map((c) => (
                    <li key={c} className="select-all">
                      {c}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void copyRecoveryCodes();
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t('profile.twofa.recovery.copy')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      window.print();
                    }}
                  >
                    {t('profile.twofa.recovery.print')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setRecoveryCodes(null);
                    }}
                  >
                    {t('profile.twofa.recovery.saved')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Secure flow (rigenera recovery o disattiva): richiede codice email */}
        {secureFlow && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              {secureFlow === 'disable' ? (
                <ShieldOff className="mt-0.5 h-5 w-5 text-destructive" />
              ) : (
                <RefreshCw className="mt-0.5 h-5 w-5 text-primary" />
              )}
              <div>
                <p className="font-semibold">
                  {secureFlow === 'disable'
                    ? t('profile.twofa.disable.title')
                    : t('profile.twofa.recovery.regenerate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {secureFlow === 'disable'
                    ? t('profile.twofa.disable.help')
                    : t('profile.twofa.recovery.regenerate_help')}
                </p>
                {secureSent && (
                  <p className="mt-1 text-xs text-primary">
                    {t('profile.twofa.setup.sent_title', { email: secureSent.sentTo })}
                  </p>
                )}
              </div>
            </div>
            {secureError && (
              <Alert variant="destructive">
                <AlertDescription>{secureError}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="••• •••"
                value={secureCode}
                onChange={(e) => {
                  setSecureCode(e.target.value);
                  setSecureError(null);
                }}
                className="font-mono tracking-widest"
                autoFocus
              />
              <Button
                variant={secureFlow === 'disable' ? 'destructive' : 'default'}
                onClick={submitSecureFlow}
                disabled={
                  regenerateMutation.isPending ||
                  disableMutation.isPending ||
                  !/^\d{6}$/.test(secureCode.trim())
                }
              >
                {(regenerateMutation.isPending || disableMutation.isPending) && (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                )}
                {secureFlow === 'disable'
                  ? t('profile.twofa.disable.confirm')
                  : t('profile.twofa.recovery.regenerate')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSecureFlow(null);
                  setSecureCode('');
                  setSecureError(null);
                  setSecureSent(null);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => {
                sendSecureCode.mutate();
              }}
              disabled={sendSecureCode.isPending}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {sendSecureCode.isPending
                ? t('profile.twofa.setup.resending')
                : t('profile.twofa.setup.resend')}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
