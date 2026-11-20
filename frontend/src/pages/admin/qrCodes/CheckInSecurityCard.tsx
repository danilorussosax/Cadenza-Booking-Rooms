import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Plus, ShieldAlert, ShieldCheck, Trash2, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { qrcodesApi } from '@/api/qrcodes';
import { httpErrorMessage } from '@/lib/api';
import { isLoopbackIp as isLoopbackAddress } from '@/lib/ipAddress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { qk } from '@/lib/queryKeys';

// =====================================================
// 1) Sicurezza check-in: toggle + CIDR allowlist
// =====================================================
export function CheckInSecurityCard() {
  const qc = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: qk.admin.checkinSettings(),
    queryFn: () => qrcodesApi.getCheckInSettings(),
  });

  const [enabled, setEnabled] = useState(false);
  const [cidrs, setCidrs] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  // Sincronizza local state con dati server al primo load.
  useEffect(() => {
    if (settingsQuery.data) {
      setEnabled(settingsQuery.data.checkInRequireInstituteNetwork);
      setCidrs(settingsQuery.data.instituteNetworkCidrs);
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      qrcodesApi.saveCheckInSettings({
        checkInRequireInstituteNetwork: enabled,
        instituteNetworkCidrs: cidrs,
      }),
    onSuccess: (data) => {
      toast.success('Impostazioni check-in salvate');
      void qc.invalidateQueries({ queryKey: qk.admin.checkinSettings() });
      if (data.warnings.length > 0) {
        for (const w of data.warnings) toast.warning(w);
      }
      setServerError(null);
    },
    onError: (err) => {
      const msg = httpErrorMessage(err);
      setServerError(msg);
      toast.error(msg);
    },
  });

  const callerIp = settingsQuery.data?.callerIp;
  const isLoopbackIp = isLoopbackAddress(callerIp);
  const isDirty =
    enabled !== (settingsQuery.data?.checkInRequireInstituteNetwork ?? false) ||
    JSON.stringify(cidrs) !== JSON.stringify(settingsQuery.data?.instituteNetworkCidrs ?? []);

  const addDraftCidr = () => {
    const v = draft.trim();
    if (!v) return;
    if (cidrs.includes(v)) {
      toast.warning('CIDR già presente');
      return;
    }
    setCidrs((prev) => [...prev, v]);
    setDraft('');
  };

  const addCallerIp = () => {
    if (!callerIp) return;
    // Default: maschera /32 IPv4 o /128 IPv6 (singolo host).
    const isV6 = callerIp.includes(':');
    const candidate = `${callerIp}/${isV6 ? 128 : 32}`;
    if (cidrs.includes(candidate)) {
      toast.warning('Il tuo IP è già nella lista');
      return;
    }
    setCidrs((prev) => [...prev, candidate]);
  };

  const removeCidr = (idx: number) => {
    setCidrs((prev) => prev.filter((_, i) => i !== idx));
  };

  if (settingsQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-primary" />
          Sicurezza check-in
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Limita il check-in via QR-code ai soli dispositivi connessi alla rete d&rsquo;istituto.
          Chi scansiona il QR da una rete esterna riceverà un errore esplicito.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 pt-0 sm:pt-0">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4">
          <div className="space-y-1">
            <Label htmlFor="net-toggle" className="text-base font-medium">
              Consenti check-in solo dalla rete d&rsquo;istituto
            </Label>
            <p className="text-sm text-muted-foreground">
              Quando attivo, il backend verifica che l&rsquo;IP del client sia incluso nella
              whitelist sotto. Se la whitelist è vuota, <strong>nessuno</strong> potrà fare
              check-in.
            </p>
          </div>
          <Switch id="net-toggle" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="space-y-2">
          <Label>Reti consentite (CIDR IPv4 o IPv6)</Label>
          <p className="text-xs text-muted-foreground">
            Esempi: <code className="rounded bg-muted px-1">192.168.1.0/24</code> ·{' '}
            <code className="rounded bg-muted px-1">10.0.0.0/8</code> ·{' '}
            <code className="rounded bg-muted px-1">2001:db8::/32</code>
          </p>

          <div className="flex gap-2">
            <Input
              value={draft}
              placeholder="192.168.1.0/24"
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addDraftCidr();
                }
              }}
              className="font-mono"
            />
            <Button type="button" onClick={addDraftCidr} disabled={!draft.trim()}>
              <Plus className="h-4 w-4" />
              Aggiungi
            </Button>
            {callerIp && (
              <Button
                type="button"
                variant="outline"
                onClick={addCallerIp}
                disabled={isLoopbackIp}
                title={
                  isLoopbackIp
                    ? `${callerIp} è l'indirizzo di loopback locale: aggiungerlo non abilita altri client`
                    : `Aggiungi il tuo IP corrente: ${callerIp}`
                }
              >
                <ShieldCheck className="h-4 w-4" />
                Aggiungi mio IP
              </Button>
            )}
          </div>

          {cidrs.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              Nessuna rete configurata.
              {enabled && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">
                  Attenzione: con il toggle attivo nessuno potrà fare check-in.
                </span>
              )}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {cidrs.map((c, i) => (
                <li
                  key={`${c}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2"
                >
                  <code className="font-mono text-sm">{c}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      removeCidr(i);
                    }}
                    title="Rimuovi"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {enabled && cidrs.length === 0 && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              Toggle attivo con whitelist vuota: salvando, nessun client potrà fare check-in finché
              non aggiungi almeno una rete.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Riga "IP rilevato": l'indirizzo del client che sta consultando
              questa pagina lato backend (extractClientIp + normalizeIp).
              Reso esplicito anche quando manca o quando coincide con il
              loopback del server (::1 / 127.0.0.1) — caso classico quando
              l'admin apre la pagina dalla stessa macchina del backend e in
              cui mettere quell'IP in whitelist NON serve a nulla per gli
              studenti che fanno check-in da rete istituzionale. */}
          <div className="space-y-1">
            <p className="text-sm">
              <span className="text-muted-foreground">IP rilevato: </span>
              {callerIp ? (
                <>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
                    {callerIp}
                  </code>
                  {isLoopbackIp && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-wider text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                      loopback locale
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs italic text-muted-foreground">non rilevato</span>
              )}
            </p>
            {isLoopbackIp && (
              <p className="max-w-xl text-xs text-muted-foreground">
                Stai accedendo dalla stessa macchina del server: il valore{' '}
                <code className="font-mono">{callerIp}</code> è l'indirizzo di loopback e non serve
                in whitelist. Apri questa pagina da un dispositivo connesso alla rete istituzionale
                per leggere il suo IP pubblico/interno reale.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!isDirty || saveMutation.isPending}
              onClick={() => {
                if (settingsQuery.data) {
                  setEnabled(settingsQuery.data.checkInRequireInstituteNetwork);
                  setCidrs(settingsQuery.data.instituteNetworkCidrs);
                }
              }}
            >
              Reimposta
            </Button>
            <Button
              type="button"
              disabled={!isDirty || saveMutation.isPending}
              onClick={() => {
                saveMutation.mutate();
              }}
            >
              {saveMutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Salva
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
