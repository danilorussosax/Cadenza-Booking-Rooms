import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Download,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wifi,
} from 'lucide-react';
import { toast } from 'sonner';
import { qrcodesApi, type BuildingCheckInEntry, type QrRoomEntry } from '@/api/qrcodes';
import { httpErrorMessage } from '@/lib/api';
import { dayjs } from '@/lib/date';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

// Pagina admin per la gestione dei QR-code di check-in delle aule + policy
// "check-in solo da rete d'istituto". Inserita come tab dentro
// /admin/server-settings (vedi ServerSettings.tsx).
//
// Sezioni:
//   1. "Sicurezza check-in" — toggle network restriction + CIDR allowlist
//   2. "QR-code per aula" — tabella con preview, regenerate, download, bulk

export default function AdminQrCodes() {
  return (
    <div className="space-y-6">
      <CheckInSecurityCard />
      <BuildingCheckInCard />
      <RoomsQrTable />
    </div>
  );
}

// =====================================================
// Card "Check-in per edificio" (impostazione generale)
// =====================================================
function BuildingCheckInCard() {
  const qc = useQueryClient();
  const buildingsQuery = useQuery({
    queryKey: ['admin', 'qr', 'buildings'],
    queryFn: () => qrcodesApi.listBuildingCheckIn(),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      qrcodesApi.setBuildingCheckIn(id, enabled),
    onSuccess: ({ building }) => {
      toast.success(
        building.checkInDefault
          ? `Check-in attivato per ${building.name}`
          : `Check-in disattivato per ${building.name}`,
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'qr', 'buildings'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'qr-overview'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  if (buildingsQuery.isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  const items = buildingsQuery.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          Check-in per edificio (impostazione generale)
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Toggle generale per attivare il check-in QR di tutte le aule di un edificio.
          L&rsquo;impostazione singola sull&rsquo;aula (Eredita / Forza ON / Forza OFF) sovrascrive
          questa.
        </p>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            Nessun edificio configurato.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Edificio</th>
                  <th className="px-3 py-2 text-right">Aule</th>
                  <th className="px-3 py-2 text-right">Override individuali</th>
                  <th className="px-3 py-2 text-right">Check-in attivo</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <BuildingCheckInRow
                    key={b.id}
                    building={b}
                    isPending={toggleMutation.isPending && toggleMutation.variables.id === b.id}
                    onToggle={(enabled) => {
                      toggleMutation.mutate({ id: b.id, enabled });
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BuildingCheckInRow({
  building,
  isPending,
  onToggle,
}: {
  building: BuildingCheckInEntry;
  isPending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="font-medium">{building.name}</div>
          {building.code && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {building.code}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{building.roomsTotal}</td>
      <td className="px-3 py-3 text-right">
        {building.roomsWithOverride > 0 ? (
          <Badge variant="secondary">{building.roomsWithOverride} con override</Badge>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </td>
      <td className="px-3 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          {isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          <Switch
            aria-label={`Toggle check-in per ${building.name}`}
            checked={building.checkInDefault}
            disabled={isPending}
            onCheckedChange={onToggle}
          />
        </div>
      </td>
    </tr>
  );
}

// =====================================================
// 1) Sicurezza check-in: toggle + CIDR allowlist
// =====================================================
function CheckInSecurityCard() {
  const qc = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['admin', 'checkin-settings'],
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
      void qc.invalidateQueries({ queryKey: ['admin', 'checkin-settings'] });
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
  // Loopback detection: ::1 (IPv6 puro), 127.0.0.0/8 (IPv4) e ::ffff:127.x.x.x
  // (IPv4-mapped). Lato backend extractClientIp/normalizeIp strippa già
  // ::ffff: dai valori IPv4-mapped, ma per robustezza lo gestiamo anche qui.
  const isLoopbackIp =
    !!callerIp &&
    (callerIp === '::1' ||
      callerIp === '0:0:0:0:0:0:0:1' ||
      callerIp.startsWith('127.') ||
      callerIp.startsWith('::ffff:127.'));
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

// =====================================================
// 2) Tabella QR-code per aula
// =====================================================
function RoomsQrTable() {
  const qc = useQueryClient();
  const overviewQuery = useQuery({
    queryKey: ['admin', 'qr-overview'],
    queryFn: () => qrcodesApi.overview(),
  });

  // Cache-buster per forzare il browser a ricaricare il PNG dopo regenerate.
  const [versions, setVersions] = useState<Record<number, string>>({});

  const regenerateMutation = useMutation({
    mutationFn: (roomId: number) => qrcodesApi.regenerate(roomId),
    onSuccess: (data) => {
      toast.success('QR-code rigenerato. Stampa la nuova versione e sostituisci la copia in aula.');
      setVersions((prev) => ({ ...prev, [data.roomId]: data.qrTokenUpdatedAt }));
      void qc.invalidateQueries({ queryKey: ['admin', 'qr-overview'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const bulkMutation = useMutation({
    mutationFn: () => qrcodesApi.bulkRegenerate(),
    onSuccess: (data) => {
      toast.success(`Rigenerati ${data.updated} QR-code`);
      const ts = new Date().toISOString();
      setVersions(() => {
        const next: Record<number, string> = {};
        for (const r of overviewQuery.data?.rooms ?? []) next[r.id] = ts;
        return next;
      });
      void qc.invalidateQueries({ queryKey: ['admin', 'qr-overview'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const downloadQr = (room: QrRoomEntry) => {
    const url = qrcodesApi.imageUrl(room.id, versions[room.id] ?? room.qrTokenUpdatedAt);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-${room.code ?? room.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const rooms = useMemo(() => overviewQuery.data?.rooms ?? [], [overviewQuery.data]);

  if (overviewQuery.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>QR-code per aula</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ogni aula ha un QR univoco che codifica un link al check-in. La rigenerazione invalida
            tutti i QR fisici stampati prima.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (
              window.confirm(
                'Rigenerare i QR-code di TUTTE le aule?\nDovrai ristampare e sostituire ogni QR fisico.',
              )
            ) {
              bulkMutation.mutate();
            }
          }}
          disabled={bulkMutation.isPending || rooms.length === 0}
        >
          {bulkMutation.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Rigenera tutti
        </Button>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        {rooms.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            Nessuna aula configurata.
          </div>
        ) : (
          <div className="space-y-3">
            {rooms.map((room) => (
              <RoomQrRow
                key={room.id}
                room={room}
                version={versions[room.id] ?? room.qrTokenUpdatedAt}
                isPending={regenerateMutation.isPending && regenerateMutation.variables === room.id}
                onRegenerate={() => {
                  if (
                    window.confirm(
                      `Rigenerare il QR di "${room.name}"?\nIl QR fisico esistente smetterà di funzionare.`,
                    )
                  ) {
                    regenerateMutation.mutate(room.id);
                  }
                }}
                onDownload={() => {
                  downloadQr(room);
                }}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RoomQrRow({
  room,
  version,
  isPending,
  onRegenerate,
  onDownload,
}: {
  room: QrRoomEntry;
  version: string | null;
  isPending: boolean;
  onRegenerate: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white p-1">
        <img
          src={qrcodesApi.imageUrl(room.id, version)}
          alt={`QR ${room.name}`}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">
            {room.code ? <span className="font-mono">{room.code}</span> : room.name}
          </p>
          {room.code && <span className="truncate text-sm text-muted-foreground">{room.name}</span>}
          <CheckInStateBadge
            inherited={room.inheritedFromBuilding}
            explicit={room.requireCheckIn}
            effective={room.effectiveCheckIn}
          />
          {!room.hasQrToken && <Badge variant="secondary">Token mai generato</Badge>}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {room.building && (
            <>
              <Building2 className="h-3 w-3" />
              {room.building.name}
              {' · '}
            </>
          )}
          {room.qrTokenUpdatedAt
            ? `Ultima rigenerazione ${dayjs(room.qrTokenUpdatedAt).format('D MMM YYYY HH:mm')}`
            : 'Mai rigenerato — sarà generato al primo download'}
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDownload} title="Scarica PNG">
          <Download className="h-4 w-4" />
          Scarica
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRegenerate}
          disabled={isPending}
          title="Rigenera token e invalida QR esistente"
        >
          {isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Rigenera
        </Button>
      </div>
    </div>
  );
}

/**
 * Badge a 3 stati per il check-in di un'aula.
 *   - "Eredita (attivo|disattivo)" → l'aula non ha override, segue Building
 *   - "Sì"  → override esplicito true
 *   - "No"  → override esplicito false
 */
function CheckInStateBadge({
  inherited,
  explicit,
  effective,
}: {
  inherited: boolean;
  explicit: boolean | null;
  effective: boolean;
}) {
  if (inherited) {
    return <Badge variant="muted">Eredita ({effective ? 'attivo' : 'disattivo'})</Badge>;
  }
  if (explicit === true) return <Badge variant="success">Check-in attivo</Badge>;
  return <Badge variant="muted">Check-in non richiesto</Badge>;
}
