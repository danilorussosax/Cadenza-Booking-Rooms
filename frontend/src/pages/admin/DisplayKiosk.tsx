import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CalendarCheck2,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  Hash,
  Link2,
  LoaderCircle,
  Megaphone,
  Music4,
  Pin,
  Save,
  Timer,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { institutesApi } from '@/api/institutes';
import { structureApi } from '@/api/structure';
import { httpErrorMessage } from '@/lib/api';
import { buildingColor } from '@/lib/buildingColor';
import { slugifyBuilding } from '@/lib/displayUrl';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import type { Building } from '@/types';

interface RowState {
  buildingId: number;
  enabled: boolean;
  intervalSec: number;
  /** Modalità tabella prenotazioni — 'weekly' (default) o 'daily'. */
  viewMode: 'weekly' | 'daily';
}

interface ConcertsCfg {
  enabled: boolean;
  days: number;
  count: number;
  intervalSec: number;
}

interface AnnouncementsCfg {
  enabled: boolean;
  count: number;
  intervalSec: number;
  pinnedOnly: boolean;
}

// Le impostazioni concerti sono salvate per-edificio sul DB ma esposte
// globalmente dalla UI (la rotazione /display le aggrega comunque). Quando
// l'admin modifica la card, lo stesso valore viene scritto su tutti gli
// edifici. Initial values: se i record divergono prendiamo le opzioni "più
// permissive" (enabled OR, days max, count 0 se almeno uno è 0/unlimited).
function deriveConcertsCfg(buildings: Building[]): ConcertsCfg {
  if (buildings.length === 0) {
    return { enabled: true, days: 30, count: 0, intervalSec: 15 };
  }
  const enabledAny = buildings.some((b) => b.displayConcertsEnabled ?? true);
  const days = Math.max(...buildings.map((b) => b.displayConcertsDays ?? 30));
  const counts = buildings.map((b) => b.displayConcertsCount ?? 0);
  const count = counts.includes(0) ? 0 : Math.max(...counts);
  const intervalSec = Math.max(...buildings.map((b) => b.displayConcertsIntervalSec ?? 15));
  return { enabled: enabledAny, days, count, intervalSec };
}

// Stessa logica della card concerti: aggreghiamo le preferenze per-edificio
// nelle "più permissive". Sul save, il valore della UI viene replicato su
// tutti gli edifici. pinnedOnly=true vince solo se TUTTI gli edifici lo
// hanno (così se anche uno è "tutti", manteniamo il caso più ampio).
function deriveAnnouncementsCfg(buildings: Building[]): AnnouncementsCfg {
  if (buildings.length === 0) {
    return { enabled: true, count: 5, intervalSec: 12, pinnedOnly: false };
  }
  const enabledAny = buildings.some((b) => b.displayAnnouncementsEnabled ?? true);
  const counts = buildings.map((b) => b.displayAnnouncementsCount ?? 5);
  const count = counts.includes(0) ? 0 : Math.max(...counts);
  const intervalSec = Math.max(...buildings.map((b) => b.displayAnnouncementsIntervalSec ?? 12));
  const pinnedOnly = buildings.every((b) => b.displayAnnouncementsPinnedOnly === true);
  return { enabled: enabledAny, count, intervalSec, pinnedOnly };
}

export default function AdminDisplayKiosk() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['institutes', 'full'],
    queryFn: () => institutesApi.listFull(),
  });

  const buildings: Building[] = useMemo(() => {
    const all: Building[] = [];
    for (const inst of query.data?.institutes ?? []) {
      for (const b of inst.buildings) all.push(b);
    }
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }, [query.data]);

  // Stato locale per ogni riga della tabella edifici (toggle rotazione + durata)
  const [rows, setRows] = useState<Record<number, RowState>>({});
  // Stato per il feedback "Copiato" sui bottoni dei link diretti per sede.
  // Si auto-resetta dopo 2 secondi così l'utente può copiare più link in
  // sequenza senza che il badge resti acceso su uno solo.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // clipboard API non disponibile (browser vecchio o contesto non-secure):
      // fallback con prompt che mostra la stringa e l'utente la copia a mano.
      window.prompt(t('admin.display.links_card.copy_fallback'), text);
    }
  };
  // Stato locale globale per la card prenotazioni (master toggle rotazione)
  const [bookings, setBookings] = useState<{ enabled: boolean }>({ enabled: true });
  const [bookingsBaseline, setBookingsBaseline] = useState<{ enabled: boolean }>({ enabled: true });
  // Stato locale globale per la card concerti
  const [concerts, setConcerts] = useState<ConcertsCfg>({
    enabled: true,
    days: 30,
    count: 0,
    intervalSec: 15,
  });
  const [concertsBaseline, setConcertsBaseline] = useState<ConcertsCfg>({
    enabled: true,
    days: 30,
    count: 0,
    intervalSec: 15,
  });
  // Stato locale globale per la card annunci
  const [announcements, setAnnouncements] = useState<AnnouncementsCfg>({
    enabled: true,
    count: 5,
    intervalSec: 12,
    pinnedOnly: false,
  });
  const [announcementsBaseline, setAnnouncementsBaseline] = useState<AnnouncementsCfg>({
    enabled: true,
    count: 5,
    intervalSec: 12,
    pinnedOnly: false,
  });

  useEffect(() => {
    const next: Record<number, RowState> = {};
    for (const b of buildings) {
      next[b.id] = {
        buildingId: b.id,
        enabled: b.displayEnabled ?? true,
        intervalSec: b.displayIntervalSec ?? 30,
        viewMode: b.displayViewMode === 'daily' ? 'daily' : 'weekly',
      };
    }
    setRows(next);
    // Bookings master: enabled se almeno un edificio ha il toggle on (coerente
    // con concerti/annunci). Default true se la lista è vuota.
    const bookingsEnabled =
      buildings.length === 0 || buildings.some((b) => b.displayBookingsEnabled !== false);
    setBookings({ enabled: bookingsEnabled });
    setBookingsBaseline({ enabled: bookingsEnabled });
    const cfg = deriveConcertsCfg(buildings);
    setConcerts(cfg);
    setConcertsBaseline(cfg);
    const acfg = deriveAnnouncementsCfg(buildings);
    setAnnouncements(acfg);
    setAnnouncementsBaseline(acfg);
  }, [buildings]);

  const bookingsDirty = bookings.enabled !== bookingsBaseline.enabled;

  const concertsDirty = useMemo(() => {
    return (
      concerts.enabled !== concertsBaseline.enabled ||
      concerts.days !== concertsBaseline.days ||
      concerts.count !== concertsBaseline.count ||
      concerts.intervalSec !== concertsBaseline.intervalSec
    );
  }, [concerts, concertsBaseline]);

  const announcementsDirty = useMemo(() => {
    return (
      announcements.enabled !== announcementsBaseline.enabled ||
      announcements.count !== announcementsBaseline.count ||
      announcements.intervalSec !== announcementsBaseline.intervalSec ||
      announcements.pinnedOnly !== announcementsBaseline.pinnedOnly
    );
  }, [announcements, announcementsBaseline]);

  const tableDirty = useMemo(() => {
    for (const b of buildings) {
      const r = rows[b.id];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!r) continue;
      if (r.enabled !== (b.displayEnabled ?? true)) return true;
      if (r.intervalSec !== (b.displayIntervalSec ?? 30)) return true;
      if (r.viewMode !== (b.displayViewMode === 'daily' ? 'daily' : 'weekly')) return true;
    }
    return false;
  }, [buildings, rows]);

  const dirty = bookingsDirty || concertsDirty || announcementsDirty || tableDirty;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates = buildings
        .filter((b) => {
          const r = rows[b.id];
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!r) return false;
          const tableChanged =
            r.enabled !== (b.displayEnabled ?? true) ||
            r.intervalSec !== (b.displayIntervalSec ?? 30) ||
            r.viewMode !== (b.displayViewMode === 'daily' ? 'daily' : 'weekly');
          // Quando una delle card globali è "dirty" propaghiamo i valori a
          // tutti gli edifici, indipendentemente dalla riga tabella.
          return tableChanged || bookingsDirty || concertsDirty || announcementsDirty;
        })
        .map((b) => {
          const r = rows[b.id];
          return structureApi.updateBuilding(b.id, {
            displayEnabled: r.enabled,
            displayIntervalSec: clamp(r.intervalSec, 5, 600),
            displayViewMode: r.viewMode,
            displayBookingsEnabled: bookingsDirty
              ? bookings.enabled
              : (b.displayBookingsEnabled ?? true),
            // Se concertsDirty=true, sovrascrive con i valori globali.
            // Se false, ripassiamo il valore corrente del DB per non alterare.
            displayConcertsEnabled: concertsDirty
              ? concerts.enabled
              : (b.displayConcertsEnabled ?? true),
            displayConcertsDays: clamp(
              concertsDirty ? concerts.days : (b.displayConcertsDays ?? 30),
              0,
              365,
            ),
            displayConcertsCount: clamp(
              concertsDirty ? concerts.count : (b.displayConcertsCount ?? 0),
              0,
              50,
            ),
            displayConcertsIntervalSec: clamp(
              concertsDirty ? concerts.intervalSec : (b.displayConcertsIntervalSec ?? 15),
              5,
              600,
            ),
            // Stessa strategia per gli annunci: replico i valori globali su
            // tutti gli edifici quando la card annunci è "dirty".
            displayAnnouncementsEnabled: announcementsDirty
              ? announcements.enabled
              : (b.displayAnnouncementsEnabled ?? true),
            displayAnnouncementsCount: clamp(
              announcementsDirty ? announcements.count : (b.displayAnnouncementsCount ?? 5),
              0,
              30,
            ),
            displayAnnouncementsIntervalSec: clamp(
              announcementsDirty
                ? announcements.intervalSec
                : (b.displayAnnouncementsIntervalSec ?? 12),
              5,
              600,
            ),
            displayAnnouncementsPinnedOnly: announcementsDirty
              ? announcements.pinnedOnly
              : b.displayAnnouncementsPinnedOnly === true,
          });
        });
      await Promise.all(updates);
    },
    onSuccess: () => {
      toast.success(t('admin.display.saved'));
      void qc.invalidateQueries({ queryKey: ['institutes'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-medium">{t('admin.display.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.display.subtitle')}</p>
        </div>
        <Button asChild variant="outline">
          <a href="/display" target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
            {t('admin.display.open_display')}
          </a>
        </Button>
      </header>

      <Alert variant="info">
        <AlertDescription className="text-xs">{t('admin.display.preview_help')}</AlertDescription>
      </Alert>

      {query.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && buildings.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('admin.display.no_buildings')}
          </CardContent>
        </Card>
      )}

      {!query.isLoading && buildings.length > 0 && (
        <>
          {/* Card "Rotazione prenotazioni": master toggle della sezione +
              tabella edifici (per-row enabled + intervalSec) come children.
              Disattivando il master, l'intera tabella perde l'effetto sulla
              rotazione del kiosk (le slide edifici non vengono inserite). */}
          <Card className={cn(!bookings.enabled && 'opacity-90')}>
            <CardContent className="space-y-5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 ring-1 ring-blue-300/60 dark:bg-blue-500/15 dark:ring-blue-400/30">
                    <CalendarCheck2 className="h-5 w-5 text-blue-700 dark:text-blue-300" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold">
                      {t('admin.display.bookings_card.title')}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t('admin.display.bookings_card.subtitle')}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={bookings.enabled}
                    onCheckedChange={(v) => {
                      setBookings({ enabled: v });
                    }}
                  />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {bookings.enabled
                      ? t('admin.display.concerts_on')
                      : t('admin.display.concerts_off')}
                  </span>
                </div>
              </div>

              {/* Tabella edifici (children del riquadro padre): toggle
                  rotazione + durata per ciascun edificio. */}
              <div
                className={cn(
                  'overflow-x-auto rounded-lg border bg-card transition-opacity',
                  !bookings.enabled && 'pointer-events-none opacity-50',
                )}
              >
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t('admin.display.table.building')}</th>
                      <th className="px-4 py-3 font-medium">
                        {t('admin.display.table.rooms_count')}
                      </th>
                      <th className="px-4 py-3 font-medium">{t('admin.display.table.enabled')}</th>
                      <th className="px-4 py-3 font-medium">{t('admin.display.table.interval')}</th>
                      <th className="px-4 py-3 font-medium">
                        {t('admin.display.table.view_mode')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildings.map((b) => {
                      const r = rows[b.id];
                      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                      if (!r) return null;
                      const colors = buildingColor(b.id);
                      return (
                        <motion.tr
                          key={b.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={cn(
                            'border-b last:border-0 transition-opacity',
                            !r.enabled && 'opacity-60',
                          )}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'inline-block h-2 w-2 rounded-full',
                                  colors.tile.split(' ')[0],
                                )}
                              />
                              <span className={cn('font-medium', colors.text)}>{b.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {b.rooms?.length ?? 0}
                          </td>
                          <td className="px-4 py-3">
                            <Switch
                              checked={r.enabled}
                              onCheckedChange={(v) => {
                                setRows((s) => ({
                                  ...s,
                                  [b.id]: { ...s[b.id], enabled: v },
                                }));
                              }}
                              disabled={!bookings.enabled}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              type="number"
                              min={5}
                              max={600}
                              value={r.intervalSec}
                              onChange={(e) => {
                                setRows((s) => ({
                                  ...s,
                                  [b.id]: {
                                    ...s[b.id],
                                    intervalSec: Number(e.target.value) || 0,
                                  },
                                }));
                              }}
                              className="w-24"
                              disabled={!r.enabled || !bookings.enabled}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={r.viewMode}
                              onChange={(e) => {
                                const v = e.target.value === 'daily' ? 'daily' : 'weekly';
                                setRows((s) => ({
                                  ...s,
                                  [b.id]: { ...s[b.id], viewMode: v },
                                }));
                              }}
                              disabled={!r.enabled || !bookings.enabled}
                              className="w-36 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                            >
                              <option value="weekly">{t('admin.display.view_mode_weekly')}</option>
                              <option value="daily">{t('admin.display.view_mode_daily')}</option>
                            </select>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">{t('admin.display.interval_help')}</p>
            </CardContent>
          </Card>

          {/* Card "Link diretti per sede" — URL ready-to-copy per i tabelloni
              di ingresso che mostrano SOLO una sede invece della rotazione
              completa. Documenta anche le 3 sintassi accettate (?b, ?building,
              ?<slug>) e il match a 3 livelli (code esatto, nome esatto,
              substring del nome). */}
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 ring-1 ring-indigo-300/60 dark:bg-indigo-500/15 dark:ring-indigo-400/30">
                  <Link2 className="h-5 w-5 text-indigo-700 dark:text-indigo-300" />
                </span>
                <div className="flex-1">
                  <h2 className="text-base font-semibold">{t('admin.display.links_card.title')}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('admin.display.links_card.subtitle')}
                  </p>
                </div>
              </div>

              {/* Help box con le 3 sintassi */}
              <Alert>
                <AlertDescription>
                  <p className="text-xs font-medium">{t('admin.display.links_card.help_title')}</p>
                  <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                    <li>
                      <code className="rounded bg-muted px-1 py-0.5">/display</code> —{' '}
                      {t('admin.display.links_card.help_rotation')}
                    </li>
                    <li>
                      <code className="rounded bg-muted px-1 py-0.5">
                        /display?b=&lt;codice&gt;
                      </code>{' '}
                      — {t('admin.display.links_card.help_code')}
                    </li>
                    <li>
                      <code className="rounded bg-muted px-1 py-0.5">/display?&lt;slug&gt;</code> —{' '}
                      {t('admin.display.links_card.help_slug')}
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>

              {/* Lista URL per ogni building */}
              <div className="space-y-2">
                {/* URL rotazione (top) */}
                {(() => {
                  const base = typeof window !== 'undefined' ? window.location.origin : 'https://…';
                  const url = `${base}/display`;
                  const key = 'rotation';
                  return (
                    <LinkRow
                      label={t('admin.display.links_card.rotation_label')}
                      url={url}
                      copied={copiedKey === key}
                      onCopy={() => void copyToClipboard(url, key)}
                    />
                  );
                })()}

                {/* URL per ogni building */}
                {buildings.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('admin.display.links_card.no_buildings')}
                  </p>
                )}
                {buildings.map((b) => {
                  const base = typeof window !== 'undefined' ? window.location.origin : 'https://…';
                  // Preferiamo il code se valorizzato (più stabile rispetto al nome
                  // che può cambiare). Altrimenti slugifichiamo il nome.
                  const codeSlug = b.code ? slugifyBuilding(b.code) : null;
                  const nameSlug = slugifyBuilding(b.name);
                  const primarySlug = codeSlug ?? nameSlug;
                  const url = `${base}/display?${primarySlug}`;
                  const key = `b-${b.id}`;
                  return (
                    <LinkRow
                      key={b.id}
                      label={b.name}
                      sublabel={
                        b.code
                          ? t('admin.display.links_card.with_code', { code: b.code })
                          : t('admin.display.links_card.without_code')
                      }
                      url={url}
                      copied={copiedKey === key}
                      onCopy={() => void copyToClipboard(url, key)}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Card concerti: impostazioni globali della rotazione concerti.
              Replica gli stessi valori su tutti gli edifici al salvataggio. */}
          <Card className={cn(!concerts.enabled && 'opacity-90')}>
            <CardContent className="space-y-5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 ring-1 ring-amber-300/60 dark:bg-amber-500/15 dark:ring-amber-400/30">
                    <Music4 className="h-5 w-5 text-amber-700 dark:text-amber-300" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold">
                      {t('admin.display.concerts_card.title')}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t('admin.display.concerts_card.subtitle')}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={concerts.enabled}
                    onCheckedChange={(v) => {
                      setConcerts((c) => ({ ...c, enabled: v }));
                    }}
                  />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {concerts.enabled
                      ? t('admin.display.concerts_on')
                      : t('admin.display.concerts_off')}
                  </span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    {t('admin.display.concerts_card.days_label')}
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={concerts.days}
                    onChange={(e) => {
                      setConcerts((c) => ({
                        ...c,
                        days: Number(e.target.value) || 0,
                      }));
                    }}
                    disabled={!concerts.enabled}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t('admin.display.concerts_card.days_help')}
                  </p>
                </div>

                <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    {t('admin.display.concerts_card.count_label')}
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={concerts.count}
                    onChange={(e) => {
                      setConcerts((c) => ({
                        ...c,
                        count: Number(e.target.value) || 0,
                      }));
                    }}
                    disabled={!concerts.enabled}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t('admin.display.concerts_card.count_help')}
                  </p>
                </div>

                <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Timer className="h-4 w-4 text-muted-foreground" />
                    {t('admin.display.concerts_card.interval_label')}
                  </div>
                  <Input
                    type="number"
                    min={5}
                    max={600}
                    value={concerts.intervalSec}
                    onChange={(e) => {
                      setConcerts((c) => ({
                        ...c,
                        intervalSec: Number(e.target.value) || 0,
                      }));
                    }}
                    disabled={!concerts.enabled}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t('admin.display.concerts_card.interval_help')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card annunci: impostazioni globali della rotazione annunci.
              Replica gli stessi valori su tutti gli edifici al salvataggio. */}
          <Card className={cn(!announcements.enabled && 'opacity-90')}>
            <CardContent className="space-y-5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-100 ring-1 ring-rose-300/60 dark:bg-rose-500/15 dark:ring-rose-400/30">
                    <Megaphone className="h-5 w-5 text-rose-700 dark:text-rose-300" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold">
                      {t('admin.display.announcements_card.title')}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t('admin.display.announcements_card.subtitle')}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={announcements.enabled}
                    onCheckedChange={(v) => {
                      setAnnouncements((c) => ({ ...c, enabled: v }));
                    }}
                  />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {announcements.enabled
                      ? t('admin.display.concerts_on')
                      : t('admin.display.concerts_off')}
                  </span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    {t('admin.display.announcements_card.count_label')}
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    value={announcements.count}
                    onChange={(e) => {
                      setAnnouncements((c) => ({
                        ...c,
                        count: Number(e.target.value) || 0,
                      }));
                    }}
                    disabled={!announcements.enabled}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t('admin.display.announcements_card.count_help')}
                  </p>
                </div>

                <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Timer className="h-4 w-4 text-muted-foreground" />
                    {t('admin.display.announcements_card.interval_label')}
                  </div>
                  <Input
                    type="number"
                    min={5}
                    max={600}
                    value={announcements.intervalSec}
                    onChange={(e) => {
                      setAnnouncements((c) => ({
                        ...c,
                        intervalSec: Number(e.target.value) || 0,
                      }));
                    }}
                    disabled={!announcements.enabled}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t('admin.display.announcements_card.interval_help')}
                  </p>
                </div>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-start gap-3">
                  <Pin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {t('admin.display.announcements_card.pinned_only_label')}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {t('admin.display.announcements_card.pinned_only_help')}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={announcements.pinnedOnly}
                  onCheckedChange={(v) => {
                    setAnnouncements((c) => ({ ...c, pinnedOnly: v }));
                  }}
                  disabled={!announcements.enabled}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => {
            saveMutation.mutate();
          }}
          disabled={!dirty || saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {t('admin.display.save')}
        </Button>
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

interface LinkRowProps {
  label: string;
  sublabel?: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
}

/**
 * Riga compatta con label dell'edificio, URL "ready-to-paste" mostrato in
 * monospace, bottone "Apri" (link al kiosk) e bottone "Copia" con feedback
 * temporaneo "Copiato!".
 */
function LinkRow({ label, sublabel, url, copied, onCopy }: LinkRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-stretch gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{label}</span>
          {sublabel && <span className="text-[11px] text-muted-foreground">· {sublabel}</span>}
        </div>
        <code className="mt-0.5 block truncate text-xs text-muted-foreground">{url}</code>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button asChild variant="outline" size="sm">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            {t('admin.display.links_card.open')}
          </a>
        </Button>
        <Button
          variant={copied ? 'default' : 'outline'}
          size="sm"
          onClick={onCopy}
          className={cn(copied && 'bg-emerald-600 hover:bg-emerald-600')}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              {t('admin.display.links_card.copied')}
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              {t('admin.display.links_card.copy')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
