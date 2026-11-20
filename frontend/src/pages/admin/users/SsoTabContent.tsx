import { useEffect, useMemo, useState } from 'react';
import { parseAllowedDomains } from '@/lib/emailDomains';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, Globe, KeyRound, LoaderCircle, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  oauthSettingsApi,
  SECRET_PLACEHOLDER,
  type UpsertOAuthSettings,
} from '@/api/oauthSettings';
import { OAuthGroupGateSection } from '@/components/admin/OAuthGroupGateSection';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { qk } from '@/lib/queryKeys';

import { IsidataImportCard, Esse3ImportCard } from './SsoImportCards';
import { GoogleBadge, MicrosoftBadge } from './SsoBadges';

// =====================================================
// Tab "SSO": configurazione provider OAuth (Google/Microsoft), whitelist
// domini email consentiti al login OAuth e importazione anagrafica Isidata.
// I secret sono cifrati a DB; in UI mostriamo solo lo stato "configurato"
// e un campo per inserirne uno nuovo. Provider ID/secret/callback richiedono
// riavvio del backend; la whitelist domini ha invece effetto immediato
// (verificata a ogni login OAuth via DB read).
// =====================================================
interface OAuthFormState {
  // Google
  googleEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string; // SECRET_PLACEHOLDER finché non modificato
  googleCallbackUrl: string;
  // Microsoft
  microsoftEnabled: boolean;
  microsoftClientId: string;
  microsoftClientSecret: string;
  microsoftCallbackUrl: string;
  microsoftTenant: string;
  // Whitelist domini (CSV editabile dall'admin)
  allowedEmailDomains: string;
}

export function SsoTabContent() {
  const qc = useQueryClient();
  const [showGoogleSecret, setShowGoogleSecret] = useState(false);
  const [showMsSecret, setShowMsSecret] = useState(false);
  const [restartHint, setRestartHint] = useState(false);

  const query = useQuery({
    queryKey: qk.admin.oauthSettings(),
    queryFn: () => oauthSettingsApi.get(),
  });

  const [form, setForm] = useState<OAuthFormState | null>(null);
  const [initial, setInitial] = useState<OAuthFormState | null>(null);

  useEffect(() => {
    if (query.data) {
      const s = query.data.settings;
      const next: OAuthFormState = {
        googleEnabled: s.googleEnabled,
        googleClientId: s.googleClientId,
        googleClientSecret: s.googleClientSecretSet ? SECRET_PLACEHOLDER : '',
        googleCallbackUrl: s.googleCallbackUrl,
        microsoftEnabled: s.microsoftEnabled,
        microsoftClientId: s.microsoftClientId,
        microsoftClientSecret: s.microsoftClientSecretSet ? SECRET_PLACEHOLDER : '',
        microsoftCallbackUrl: s.microsoftCallbackUrl,
        microsoftTenant: s.microsoftTenant || 'common',
        allowedEmailDomains: s.allowedEmailDomainsList.join(', '),
      };
      setForm(next);
      setInitial(next);
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (payload: UpsertOAuthSettings) => oauthSettingsApi.update(payload),
    onSuccess: (data) => {
      toast.success('Impostazioni OAuth salvate');
      void qc.invalidateQueries({ queryKey: qk.admin.oauthSettings() });
      // restartRequired = false solo se ho toccato esclusivamente la whitelist.
      if (data.restartRequired) setRestartHint(true);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  // Anteprima domini normalizzati: utile per dare un feedback all'utente che
  // virgole/spazi/case verranno comunque ripuliti lato server. Calcolato prima
  // dell'early return per rispettare le regole degli hook (no chiamate condizionali).
  const rawDomainsInput = form?.allowedEmailDomains ?? '';
  const normalizedDomains = useMemo(() => parseAllowedDomains(rawDomainsInput), [rawDomainsInput]);

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Impossibile caricare le impostazioni SSO: {httpErrorMessage(query.error)}. Verifica che il
          backend sia stato riavviato dopo l'ultimo aggiornamento.
        </AlertDescription>
      </Alert>
    );
  }
  if (query.isLoading || !form || !initial) {
    return <Skeleton className="h-72 w-full" />;
  }

  const isGoogleDirty =
    form.googleEnabled !== initial.googleEnabled ||
    form.googleClientId !== initial.googleClientId ||
    form.googleClientSecret !== initial.googleClientSecret ||
    form.googleCallbackUrl !== initial.googleCallbackUrl;

  const isMsDirty =
    form.microsoftEnabled !== initial.microsoftEnabled ||
    form.microsoftClientId !== initial.microsoftClientId ||
    form.microsoftClientSecret !== initial.microsoftClientSecret ||
    form.microsoftCallbackUrl !== initial.microsoftCallbackUrl ||
    form.microsoftTenant !== initial.microsoftTenant;

  const isDomainsDirty = form.allowedEmailDomains !== initial.allowedEmailDomains;

  const saveGoogle = () => {
    mutation.mutate({
      googleEnabled: form.googleEnabled,
      googleClientId: form.googleClientId.trim(),
      googleClientSecret: form.googleClientSecret,
      googleCallbackUrl: form.googleCallbackUrl.trim(),
    });
  };

  const saveMicrosoft = () => {
    mutation.mutate({
      microsoftEnabled: form.microsoftEnabled,
      microsoftClientId: form.microsoftClientId.trim(),
      microsoftClientSecret: form.microsoftClientSecret,
      microsoftCallbackUrl: form.microsoftCallbackUrl.trim(),
      microsoftTenant: form.microsoftTenant.trim() || 'common',
    });
  };

  const saveDomains = () => {
    // Inviamo l'array già normalizzato (il backend ri-normalizza comunque).
    mutation.mutate({ allowedEmailDomains: normalizedDomains });
  };

  return (
    <div className="space-y-4">
      {restartHint && (
        <Alert variant="info">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Riavvia il backend per applicare le nuove impostazioni OAuth (client ID, secret,
            callback, tenant). La whitelist domini è invece già attiva.
          </AlertDescription>
        </Alert>
      )}

      {/* DOMINI CONSENTITI: card full-width in cima. Si applica sia a Google
          che a Microsoft. Lista vuota = nessuna restrizione (qualunque
          account OAuth viene accettato). Modifiche immediate, no riavvio. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
            <span className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              Domini email consentiti
            </span>
            {normalizedDomains.length === 0 ? (
              <Badge variant="muted">Nessuna restrizione</Badge>
            ) : (
              <Badge variant="secondary">
                {normalizedDomains.length} domin{normalizedDomains.length === 1 ? 'io' : 'i'}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0 sm:pt-0">
          <p className="text-sm text-muted-foreground">
            Limita il login Google/Microsoft agli utenti la cui email appartiene a uno dei domini
            indicati. Lascia vuoto per accettare qualunque account.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="allowed-domains">
              Domini autorizzati (separati da virgola o spazio)
            </Label>
            <Input
              id="allowed-domains"
              value={form.allowedEmailDomains}
              onChange={(e) => {
                setForm({ ...form, allowedEmailDomains: e.target.value });
              }}
              placeholder="studenti.unimi.it, docenti.unimi.it"
            />
          </div>
          {normalizedDomains.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {normalizedDomains.map((d) => (
                <Badge key={d} variant="secondary" className="font-mono text-xs">
                  @{d}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted-foreground">
              Match esatto, case-insensitive. Le modifiche hanno effetto al prossimo login.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={saveDomains}
              disabled={!isDomainsDirty || mutation.isPending}
            >
              {mutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Salva domini
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {/* GOOGLE */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
              <span className="flex items-center gap-2">
                <GoogleBadge />
                Google OAuth
              </span>
              <Switch
                checked={form.googleEnabled}
                onCheckedChange={(v) => {
                  setForm({ ...form, googleEnabled: v });
                }}
                aria-label="Abilita Google OAuth"
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 sm:pt-0">
            <div className="space-y-1.5">
              <Label htmlFor="g-cid">Client ID</Label>
              <Input
                id="g-cid"
                value={form.googleClientId}
                onChange={(e) => {
                  setForm({ ...form, googleClientId: e.target.value });
                }}
                placeholder="xxxxxxx.apps.googleusercontent.com"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="g-cs" className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Client Secret
                </Label>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    setShowGoogleSecret((s) => !s);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showGoogleSecret ? (
                    <EyeOff className="inline h-3.5 w-3.5" />
                  ) : (
                    <Eye className="inline h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <Input
                id="g-cs"
                type={showGoogleSecret ? 'text' : 'password'}
                value={
                  form.googleClientSecret === SECRET_PLACEHOLDER ? '' : form.googleClientSecret
                }
                placeholder={
                  form.googleClientSecret === SECRET_PLACEHOLDER
                    ? '•••••••• (configurato — lascia vuoto per non modificare)'
                    : 'Inserisci il Client Secret'
                }
                onChange={(e) => {
                  setForm({ ...form, googleClientSecret: e.target.value });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-cb">Callback URL</Label>
              <Input
                id="g-cb"
                value={form.googleCallbackUrl}
                onChange={(e) => {
                  setForm({ ...form, googleCallbackUrl: e.target.value });
                }}
                placeholder="https://tuodominio/api/auth/google/callback"
              />
            </div>
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                size="sm"
                onClick={saveGoogle}
                disabled={!isGoogleDirty || mutation.isPending}
              >
                {mutation.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Salva
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* MICROSOFT */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
              <span className="flex items-center gap-2">
                <MicrosoftBadge />
                Microsoft OAuth
              </span>
              <Switch
                checked={form.microsoftEnabled}
                onCheckedChange={(v) => {
                  setForm({ ...form, microsoftEnabled: v });
                }}
                aria-label="Abilita Microsoft OAuth"
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 sm:pt-0">
            <div className="space-y-1.5">
              <Label htmlFor="m-cid">Client ID (Application ID)</Label>
              <Input
                id="m-cid"
                value={form.microsoftClientId}
                onChange={(e) => {
                  setForm({ ...form, microsoftClientId: e.target.value });
                }}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="m-cs" className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Client Secret
                </Label>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    setShowMsSecret((s) => !s);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showMsSecret ? (
                    <EyeOff className="inline h-3.5 w-3.5" />
                  ) : (
                    <Eye className="inline h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <Input
                id="m-cs"
                type={showMsSecret ? 'text' : 'password'}
                value={
                  form.microsoftClientSecret === SECRET_PLACEHOLDER
                    ? ''
                    : form.microsoftClientSecret
                }
                placeholder={
                  form.microsoftClientSecret === SECRET_PLACEHOLDER
                    ? '•••••••• (configurato — lascia vuoto per non modificare)'
                    : 'Inserisci il Client Secret'
                }
                onChange={(e) => {
                  setForm({ ...form, microsoftClientSecret: e.target.value });
                }}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="m-tenant">Tenant</Label>
                <Input
                  id="m-tenant"
                  value={form.microsoftTenant}
                  onChange={(e) => {
                    setForm({ ...form, microsoftTenant: e.target.value });
                  }}
                  placeholder="common"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-cb">Callback URL</Label>
                <Input
                  id="m-cb"
                  value={form.microsoftCallbackUrl}
                  onChange={(e) => {
                    setForm({ ...form, microsoftCallbackUrl: e.target.value });
                  }}
                  placeholder="https://tuodominio/api/auth/microsoft/callback"
                />
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                size="sm"
                onClick={saveMicrosoft}
                disabled={!isMsDirty || mutation.isPending}
              >
                {mutation.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Salva
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ISIDATA: import anagrafica via XLSX/CSV. La card è un punto
            d'ingresso compatto: il wizard completo (drop file → preview →
            apply) si apre dentro un Dialog modale (vedi IsidataImportCard). */}
        <IsidataImportCard />

        {/* ESSE3 (CINECA): stesso wizard, parametrizzato sul `source`. Riusa
            l'engine Isidata con alias header CINECA (CodiceCdS, DescrizioneCdS,
            StatoIscrizione) ed externalSource='esse3' separato. */}
        <Esse3ImportCard />
      </div>

      {/* Gate gruppi M365: toggle + nomi gruppo + mapping editabile + utenti risolti */}
      <OAuthGroupGateSection />
    </div>
  );
}
