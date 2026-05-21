import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Building2,
  CalendarDays,
  Megaphone,
  Music4,
  TrendingUp,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  publicApi,
  type PublicAgenda,
  type PublicAnnouncement,
  type PublicBuilding,
  type PublicStats,
} from '@/api/public';
import { dayjs } from '@/lib/date';
import { sortRoomsForBuilding } from '@/lib/sortRooms';
import { publicBookingsToBlocks } from '@/lib/weeklyBlocks';
import type { PublicConcert } from '@/types';
import { BOOKING_TYPE_LABEL, BOOKING_TYPE_STYLES } from '@/lib/bookings';
import { cn } from '@/lib/utils';
import { detectBrowserLanguage } from '@/i18n';
import { FullscreenToggle } from '@/components/FullscreenToggle';
import { useTheme } from '@/contexts/ThemeContext';
import { useFullscreen, useIdle } from '@/hooks/useFullscreen';
import { useDisplayScale } from '@/hooks/useDisplayScale';
import { useAppIcon } from '@/hooks/useAppIcon';
import { WeeklyRoomTimetable, type WeeklyBlock } from '@/components/bookings/WeeklyRoomTimetable';
import { DailyRoomTimetable } from '@/components/bookings/DailyRoomTimetable';
import { findBuildingBySlug, parseDisplayBuildingSlug } from '@/lib/displayUrl';
import type { BookingType } from '@/types';

const REFRESH_AGENDA_MS = 60_000;
const REFRESH_STATS_MS = 30_000;
const REFRESH_CONCERTS_MS = 5 * 60_000;

type Slide =
  | { kind: 'building'; building: PublicBuilding & { intervalSec: number }; intervalSec: number }
  | { kind: 'concert'; concert: PublicConcert; intervalSec: number }
  | { kind: 'announcement'; announcement: PublicAnnouncement; intervalSec: number };

export default function Display() {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => dayjs());
  const { isFullscreen } = useFullscreen();
  const idle = useIdle(3000, isFullscreen);
  const hideUi = isFullscreen && idle;

  // Auto-scaling per display HDMI: scala il root font-size (e quindi tutti i
  // valori `rem` di Tailwind) in base alla risoluzione del monitor. Su FullHD
  // 1× ≈ 16px root, su 4K 2× ≈ 32px root → testo, spaziature e griglia
  // settimanale crescono proporzionalmente. Override manuale: `?scale=1.7`.
  useDisplayScale();

  // TV-safe area: molte smart TV (Hisense VIDAA, Samsung Tizen, LG webOS)
  // applicano overscan per default sulle sorgenti HDMI, "ingrandendo" il
  // segnale di un 3-7% e tagliando i bordi. Su /display questo elimina la
  // colonna codici aula (la prima a sinistra) e parte del titolo.
  //
  // Soluzione: opt-in via query param. `?tvsafe` attiva un padding del 3%
  // (default ragionevole per la maggior parte dei TV). `?tvsafe=N` permette
  // di tarare manualmente da 1% a 15% in base al modello specifico. Senza
  // il param non c'è regressione su monitor PC.
  const tvSafePct = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tvsafe')) return 0;
    const raw = params.get('tvsafe');
    if (!raw) return 3; // attivo senza valore → 3% (sweet spot empirico)
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return 3;
    return Math.max(0, Math.min(15, n));
  }, []);
  const tvSafeStyle = useMemo<React.CSSProperties>(
    () =>
      tvSafePct > 0
        ? {
            // `vmin` invece di `vw`: padding orizzontale e verticale uniforme,
            // utile su TV portrait/ruotati. Modesto sul lato H ma protegge
            // anche bordo top/bottom dove l'overscan è meno aggressivo ma
            // non assente.
            paddingLeft: `${tvSafePct}vw`,
            paddingRight: `${tvSafePct}vw`,
            paddingTop: `${tvSafePct * 0.5}vh`,
            paddingBottom: `${tvSafePct * 0.5}vh`,
          }
        : {},
    [tvSafePct],
  );

  // Overlay diagnostico per validare il rendering sul TV/monitor reale:
  // visibile solo con `?debug=1`. Mostra viewport, DPR, root font-size,
  // fattore di scala applicato, e User-Agent abbreviato. Aggiornato live
  // su resize (utile per regolare manualmente lo zoom del browser TV).
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('debug')) return;
    const update = (): void => {
      setDebugInfo(snapshotDebugInfo());
    };
    update();
    window.addEventListener('resize', update);
    const id = setInterval(update, 1000);
    return () => {
      window.removeEventListener('resize', update);
      clearInterval(id);
    };
  }, []);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => {
      setNow(dayjs());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);

  // Force tema chiaro sul kiosk: il /display è pubblico e gira su dispositivi
  // diversi (Mac admin, smart TV con OS dark, monitor HDMI dedicati). Senza
  // forzatura ogni dispositivo mostra una palette diversa in base al suo
  // `prefers-color-scheme` di sistema → kiosk non coerenti.
  //
  // IMPORTANTE: dobbiamo usare `setForceTheme` del ThemeContext invece di
  // manipolare direttamente `documentElement.classList`. Il `ThemeProvider`
  // ha un `useEffect` che ri-applica la classe `.dark` ogni volta che il
  // suo stato cambia (e fa una "init" applicazione al mount). Manipolare
  // la classe a mano viene sovrascritto subito dal provider parent
  // (gli effects dei figli girano PRIMA dei parent in React → la nostra
  // rimozione viene ri-applicata dal provider). `setForceTheme` invece
  // imposta uno state che il provider rispetta come override.
  const { setForceTheme } = useTheme();
  useEffect(() => {
    setForceTheme('light');
    return () => {
      setForceTheme(null);
    };
  }, [setForceTheme]);

  // ───────────────────────────────────────────────────────────────────────────
  // Auto-rilevamento lingua del browser per il kiosk
  //
  // /display è una pagina pubblica che gira tipicamente su monitor dedicati,
  // a cui acceda chiunque. Vogliamo che la UI si adatti automaticamente alla
  // lingua impostata sul dispositivo (`navigator.languages`) anche se in
  // localStorage è memorizzata un'altra preferenza (es. dell'admin che ha
  // configurato il kiosk).
  //
  // Strategia:
  //   - all'apertura di /display, salviamo la lingua corrente di i18n
  //   - rileviamo la lingua del browser e la applichiamo
  //   - all'unmount ripristiniamo la lingua salvata, così non "sporchiamo"
  //     la preferenza di un eventuale utente loggato sullo stesso browser
  // ───────────────────────────────────────────────────────────────────────────
  const restoreLangRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = (i18n.resolvedLanguage ?? i18n.language) || 'it';
    const browser = detectBrowserLanguage();
    restoreLangRef.current = previous;
    if (previous !== browser) {
      void i18n.changeLanguage(browser);
    }
    // Ri-rileva al cambio della lingua del sistema (alcuni browser emettono
    // l'evento "languagechange" quando l'utente cambia lingua nelle preferenze).
    const onLangChange = () => void i18n.changeLanguage(detectBrowserLanguage());
    window.addEventListener('languagechange', onLangChange);
    return () => {
      window.removeEventListener('languagechange', onLangChange);
      const restore = restoreLangRef.current;
      if (restore && restore !== (i18n.resolvedLanguage ?? i18n.language)) {
        void i18n.changeLanguage(restore);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kiosk dedicato (aperto h24): l'admin che cambia logo/icona vuole vederlo
  // sul display "subito", non dopo 5 minuti. staleTime + refetchInterval
  // ridotti rispetto al pattern utente loggato (che è in `useAppIcon`).
  const instituteQuery = useQuery({
    queryKey: ['public', 'institute'],
    queryFn: () => publicApi.institute(),
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
  // Icona app dell'istituto (configurata da admin) come fallback al logo
  // dell'edificio. Cade su `/logo3.png` solo in ultima istanza, in modo
  // coerente con AppLayout/AuthLayout. Risolve: "rimuovo il logo istituto
  // → display mostra l'icona Cadenza generica anziché la mia icona app".
  const appIcon = useAppIcon();

  // Vista settimanale (Lun→Sab) per coerenza con la dashboard. Il kiosk
  // ricalcola weekStart in base a `now` (chiave di refetch) così a mezzanotte
  // di lunedì la query si invalida automaticamente.
  //
  // Domenica (`isoWeekday() === 7`): la settimana corrente Lun-Sab è esaurita
  // (sabato è passato) e mostrarla è informazione morta. Saltiamo direttamente
  // alla settimana successiva — al passaggio Sab→Dom la stringa weekStart
  // cambia e la query si invalida sola.
  const weekStart = useMemo(() => {
    const today = dayjs(now);
    const base = today.isoWeekday() === 7 ? today.add(1, 'day') : today;
    return base.startOf('isoWeek').format('YYYY-MM-DD');
  }, [now]);
  const weekEnd = useMemo(() => dayjs(weekStart).add(5, 'day').format('YYYY-MM-DD'), [weekStart]);
  const agendaQuery = useQuery<PublicAgenda>({
    queryKey: ['public', 'agenda', 'week', weekStart],
    queryFn: () => publicApi.agendaRange(weekStart, weekEnd),
    refetchInterval: REFRESH_AGENDA_MS,
  });

  const statsQuery = useQuery({
    queryKey: ['public', 'stats'],
    queryFn: () => publicApi.stats(),
    refetchInterval: REFRESH_STATS_MS,
  });

  // Configurazione rotazione: quali edifici mostrare e per quanto tempo ciascuno.
  // Il client cycla solo gli edifici con displayEnabled=true; ognuno ha il suo
  // intervalSec personalizzabile dall'admin via /admin/display.
  const displayConfigQuery = useQuery({
    queryKey: ['public', 'display-config'],
    queryFn: () => publicApi.displayConfig(),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const institute = instituteQuery.data?.institute ?? null;
  const stats = statsQuery.data;

  // Edifici dell'agenda filtrati e riordinati secondo la configurazione admin.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allBuildings = agendaQuery.data?.buildings ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rotationOrder = displayConfigQuery.data?.buildings ?? [];
  // Filtro URL "single-building mode": se l'URL ha ?b=<slug>, ?building=<slug>,
  // o una chiave senza valore (?centrale), mostra SOLO quell'edificio.
  // Pensato per i tabelloni di ingresso di una sede specifica.
  const requestedSlug = useMemo(
    () => (typeof window !== 'undefined' ? parseDisplayBuildingSlug(window.location.search) : null),
    [],
  );

  const rotationBuildings = useMemo<(PublicBuilding & { intervalSec: number })[]>(() => {
    let base: (PublicBuilding & { intervalSec: number })[];
    if (rotationOrder.length === 0) {
      // fallback: nessuna config = mostra tutto con intervallo di default
      base = allBuildings.map((b) => ({ ...b, intervalSec: 30 }));
    } else {
      const byId = new Map(allBuildings.map((b) => [b.id, b]));
      base = rotationOrder
        .map((c) => {
          const b = byId.get(c.id);
          return b ? { ...b, intervalSec: c.intervalSec } : null;
        })
        .filter((b): b is PublicBuilding & { intervalSec: number } => b !== null);
    }
    if (!requestedSlug) return base;
    // Match per code o nome normalizzato (helper testato in lib/displayUrl)
    const match = findBuildingBySlug(base, requestedSlug);
    // Se lo slug non matcha niente, fallback alla rotazione completa per non
    // lasciare lo schermo vuoto in caso di errore di battitura nell'URL.
    return match ? [match] : base;
  }, [allBuildings, rotationOrder, requestedSlug]);

  // Aggregati concerti dalla configurazione admin (per-edificio, ma applicati
  // globalmente alla rotazione perché i concerti compaiono una sola volta):
  //   - enabled: almeno un edificio ha il toggle on
  //   - horizon: max(displayConcertsDays) tra edifici con toggle on
  //   - cap: max(displayConcertsCount) tra edifici con toggle on (0 = nessun limite)
  //   - intervalSec: max(displayConcertsIntervalSec) tra edifici con toggle on
  const concertsConfig = useMemo(() => {
    const active = rotationOrder.filter((b) => b.concertsEnabled);
    if (active.length === 0) {
      return { enabled: false, horizonDays: 0, cap: 0, intervalSec: 15 };
    }
    const horizonDays = Math.max(...active.map((b) => b.concertsDays), 0);
    const counts = active.map((b) => b.concertsCount);
    // 0 in qualsiasi edificio significa "senza limite" → la max è 0
    const cap = counts.includes(0) ? 0 : Math.max(...counts);
    const intervalSec = Math.max(...active.map((b) => b.concertsIntervalSec));
    return { enabled: horizonDays > 0, horizonDays, cap, intervalSec };
  }, [rotationOrder]);

  const concertsQuery = useQuery({
    queryKey: ['public', 'concerts', concertsConfig.horizonDays],
    queryFn: () => publicApi.concerts(concertsConfig.horizonDays),
    enabled: concertsConfig.enabled,
    refetchInterval: REFRESH_CONCERTS_MS,
    staleTime: 60_000,
  });

  // Aggregati annunci dalla configurazione admin (per-edificio, ma applicati
  // globalmente alla rotazione perché un avviso istituzionale appare una sola
  // volta nel loop):
  //   - enabled: almeno un edificio in rotazione ha il toggle on
  //   - cap: max(announcementsCount) — 0 in qualsiasi → 0 (senza limite)
  //   - intervalSec: min(announcementsIntervalSec) — slide più veloce vince
  //   - pinnedOnly: true solo se TUTTI hanno pinnedOnly=true
  const announcementsConfig = useMemo(() => {
    const active = rotationOrder.filter((b) => b.announcementsEnabled);
    if (active.length === 0) {
      return { enabled: false, cap: 0, intervalSec: 12, pinnedOnly: false };
    }
    const counts = active.map((b) => b.announcementsCount);
    const cap = counts.includes(0) ? 0 : Math.max(...counts);
    const intervalSec = Math.min(...active.map((b) => b.announcementsIntervalSec));
    const pinnedOnly = active.every((b) => b.announcementsPinnedOnly);
    return { enabled: true, cap, intervalSec, pinnedOnly };
  }, [rotationOrder]);

  const announcementsQuery = useQuery({
    queryKey: ['public', 'announcements', announcementsConfig.pinnedOnly, announcementsConfig.cap],
    queryFn: () =>
      publicApi.announcements({
        pinned: announcementsConfig.pinnedOnly,
        limit: announcementsConfig.cap > 0 ? announcementsConfig.cap : 30,
      }),
    enabled: announcementsConfig.enabled,
    refetchInterval: REFRESH_AGENDA_MS,
    staleTime: 30_000,
  });

  // Slide della rotazione: prima tutti gli edifici, poi i concerti in arrivo.
  // Concerti "globali": ogni concerto compare una sola volta indipendentemente
  // dall'edificio dell'aula.
  // Master switch della rotazione prenotazioni: se NESSUN edificio in
  // rotazione ha bookingsEnabled=true, le slide edifici saltano del tutto.
  // Coerente con la card "Rotazione prenotazioni" del pannello admin.
  const bookingsEnabled =
    rotationOrder.length === 0 || rotationOrder.some((b) => b.bookingsEnabled);

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = bookingsEnabled
      ? rotationBuildings.map((b) => ({
          kind: 'building',
          building: b,
          intervalSec: b.intervalSec,
        }))
      : [];
    if (concertsConfig.enabled) {
      const all = concertsQuery.data?.concerts ?? [];
      const concerts = concertsConfig.cap > 0 ? all.slice(0, concertsConfig.cap) : all;
      for (const c of concerts) {
        out.push({ kind: 'concert', concert: c, intervalSec: concertsConfig.intervalSec });
      }
    }
    if (announcementsConfig.enabled) {
      const all = announcementsQuery.data?.announcements ?? [];
      const limited = announcementsConfig.cap > 0 ? all.slice(0, announcementsConfig.cap) : all;
      for (const a of limited) {
        out.push({
          kind: 'announcement',
          announcement: a,
          intervalSec: announcementsConfig.intervalSec,
        });
      }
    }
    return out;
  }, [
    rotationBuildings,
    bookingsEnabled,
    concertsQuery.data,
    concertsConfig,
    announcementsQuery.data,
    announcementsConfig,
  ]);

  // ───────────────────────────────────────────────────────────────────────────
  // Timer di rotazione: avanza ogni intervalSec della slide corrente.
  // Loop infinito; con 0/1 slide il timer non parte.
  // ───────────────────────────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  useEffect(() => {
    if (slides.length <= 1) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex >= slides.length) {
      setCurrentIndex(0);
      return;
    }
    const intervalSec = slides[currentIndex].intervalSec;
    const timer = setTimeout(
      () => {
        setCurrentIndex((i) => (i + 1) % slides.length);
      },
      Math.max(5, Math.min(600, intervalSec)) * 1000,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [currentIndex, slides]);

  // `Array.prototype.at()` ha firma `T | undefined` indipendentemente da
  // `noUncheckedIndexedAccess`: il `?? null` quindi narrowing-a a
  // `Slide | null`, così i 3 `currentSlide?.kind` qui sotto non sembrano
  // più optional chain ridondanti a ESLint. A runtime: `null` quando
  // `slides` è vuoto, atteso.
  const currentSlide = slides.at(currentIndex) ?? null;

  const isLive =
    !agendaQuery.isError &&
    !statsQuery.isError &&
    agendaQuery.dataUpdatedAt > Date.now() - 2 * 60_000;

  // Offline-soft: il SW fa StaleWhileRevalidate sull'agenda. Quando il backend
  // non risponde da > 2 minuti (ma abbiamo dati cached) mostriamo un banner
  // discreto "Connessione persa · ultimo aggiornamento HH:mm". Se non c'è MAI
  // stato un fetch riuscito, dataUpdatedAt è 0 e il banner non si vede (la
  // schermata principale già renderizza il loader).
  const hasCachedAgenda = agendaQuery.dataUpdatedAt > 0;
  const showOfflineBanner = !isLive && hasCachedAgenda;
  const lastUpdateLabel = hasCachedAgenda ? dayjs(agendaQuery.dataUpdatedAt).format('HH:mm') : '—';

  return (
    <div
      className={cn(
        // h-screen (100vh) invece di h-dvh: Hisense VIDAA, Tizen pre-2022 e
        // webOS pre-2022 non supportano `dvh`. Sui TV l'URL bar non c'è,
        // quindi 100vh = viewport pieno effettivo: nessuna regressione.
        'flex h-screen flex-col overflow-hidden bg-background text-foreground',
        hideUi && 'cursor-none',
      )}
      // Padding per compensare l'overscan dei TV smart browser quando
      // attivato via `?tvsafe` (vedi useMemo sopra). Vuoto se il param
      // non è presente, così su monitor PC non c'è regressione.
      style={tvSafeStyle}
    >
      {/* Header compatto su singola riga: logo + nome istituto a sinistra,
          data·orario·live indicator + toggles a destra. Altezza target
          ~48-72px (vs ~100-140px del layout precedente) per dedicare il
          massimo spazio verticale al calendario delle prenotazioni. */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 lg:gap-6 lg:px-8 2xl:px-12 2xl:py-3">
        <div className="flex min-w-0 items-center gap-3 2xl:gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 2xl:h-12 2xl:w-12">
            <img
              src={institute?.logoUrl?.trim() ? institute.logoUrl : appIcon}
              alt=""
              className="h-7 w-7 object-contain 2xl:h-9 2xl:w-9"
              onError={(e) => {
                // logoUrl rotto/404: cade sull'icona app dell'istituto.
                // Se anche quella fallisce, l'asset statico /logo3.png è
                // sempre presente in /public. Evita la broken-image al kiosk.
                const target = e.currentTarget;
                if (target.src !== window.location.origin + appIcon) {
                  target.src = appIcon;
                } else if (!target.src.endsWith('/logo3.png')) {
                  target.src = '/logo3.png';
                }
              }}
            />
          </div>
          <h1 className="truncate font-display text-base font-medium leading-tight sm:text-lg lg:text-xl 2xl:text-2xl">
            {institute?.name ?? t('display.title_default')}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-3 2xl:gap-4">
          <div className="flex items-baseline gap-2 2xl:gap-3">
            <span className="hidden text-[0.6875rem] uppercase tracking-wider text-muted-foreground sm:inline 2xl:text-sm">
              {now.format('ddd D MMM')}
            </span>
            <span className="font-display text-xl font-medium tabular-nums tracking-tight sm:text-2xl lg:text-3xl 2xl:text-4xl">
              {now.format('HH:mm')}
              <span className="text-base text-muted-foreground sm:text-lg lg:text-xl 2xl:text-2xl">
                :{now.format('ss')}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-[0.625rem] uppercase tracking-wider 2xl:text-xs">
              {isLive ? (
                <>
                  <Wifi className="h-3 w-3 text-emerald-500 2xl:h-3.5 2xl:w-3.5" />
                  <span className="hidden text-emerald-600 dark:text-emerald-400 lg:inline">
                    {t('display.live')}
                  </span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 text-amber-500 2xl:h-3.5 2xl:w-3.5" />
                  <span className="hidden text-amber-600 dark:text-amber-400 lg:inline">
                    {t('display.reconnecting')}
                  </span>
                </>
              )}
            </span>
          </div>
          {/* ThemeToggle nascosto: il tema è forzato chiaro su /display per
              avere kiosk con palette identica indipendente dall'OS. Lasciare
              il toggle confonderebbe (cambia, ma il primo refresh ritorna
              chiaro). FullscreenToggle resta invece utile sul kiosk. */}
          <div className={cn('flex items-center gap-1 transition-opacity', hideUi && 'opacity-0')}>
            <FullscreenToggle />
          </div>
        </div>
      </header>

      {/* Offline banner: visibile solo se il backend non risponde da >2min ma
          il SW ha dati cached. Discreto (stripe ambra) per non rovinare la
          UX del kiosk. */}
      {showOfflineBanner && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 2xl:text-sm">
          <WifiOff className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
          <span>{t('display.offline_banner', { time: lastUpdateLabel })}</span>
        </div>
      )}

      {/* Le statistiche d'uso (in uso, oggi, settimana, aule attive) sono
          state spostate in fondo alla legenda del BuildingTable: questo
          recupera lo spazio verticale per la tabella delle prenotazioni. */}

      {/* Rotazione delle slide: edifici (timetable) + concerti (locandina).
          Il setTimeout usa l'intervalSec della slide corrente (vedi /admin/display). */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden px-2 py-2 lg:px-3 2xl:px-4 2xl:py-3">
        {slides.length === 0 && agendaQuery.isLoading && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border bg-card p-10 text-center text-muted-foreground">
            {t('display.loading_agenda')}
          </div>
        )}
        {slides.length === 0 && !agendaQuery.isLoading && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border bg-card p-10 text-center text-muted-foreground">
            —
          </div>
        )}
        <AnimatePresence mode="wait">
          {currentSlide?.kind === 'building' && (
            <motion.div
              key={`building-${currentSlide.building.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="flex flex-1 flex-col"
            >
              {currentSlide.building.displayViewMode === 'daily' ? (
                <DailyRoomTimetable building={currentSlide.building} />
              ) : (
                <BuildingTable
                  building={currentSlide.building}
                  weekStart={weekStart}
                  index={currentIndex}
                  stats={stats}
                />
              )}
            </motion.div>
          )}
          {currentSlide?.kind === 'concert' && (
            <motion.div
              key={`concert-${currentSlide.concert.id}`}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="flex flex-1 flex-col"
            >
              <ConcertSlide concert={currentSlide.concert} />
            </motion.div>
          )}
          {currentSlide?.kind === 'announcement' && (
            <motion.div
              key={`announcement-${currentSlide.announcement.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="flex flex-1 flex-col"
            >
              <AnnouncementSlide announcement={currentSlide.announcement} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Indicatore rotazione (visibile solo se ci sono ≥ 2 slide) */}
        {slides.length > 1 && (
          <div
            className={cn(
              'pointer-events-none absolute bottom-4 right-6 z-10 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1 text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground shadow-xs backdrop-blur-sm transition-opacity 2xl:bottom-6 2xl:right-10 2xl:text-xs',
              hideUi && 'opacity-0',
            )}
          >
            <span className="inline-flex items-center gap-1">
              {slides.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full transition-colors',
                    i === currentIndex ? 'bg-primary' : 'bg-muted-foreground/30',
                  )}
                />
              ))}
            </span>
            <span className="ml-1">
              {currentIndex + 1} / {slides.length}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t px-6 py-2 text-center text-[0.625rem] uppercase tracking-wider text-muted-foreground lg:px-10 2xl:px-14 2xl:text-xs">
        {t('display.footer_auto_update')} · {institute?.city ?? ''} ·{' '}
        {t('display.footer_last_update', {
          time: dayjs(stats?.timestamp ?? now).format('HH:mm:ss'),
        })}
        <span className="mx-2">·</span>
        {institute?.copyright?.trim() ?? t('display.default_copyright')}
        {isFullscreen && <span className="ml-3 normal-case">· {t('display.exit_fullscreen')}</span>}
      </footer>

      {/* Overlay diagnostico (?debug=1): box in basso-sinistra con i valori
          live di viewport / DPR / scale / root font-size, per validare a
          colpo d'occhio il rendering sul TV reale. */}
      {debugInfo && <DebugOverlay info={debugInfo} />}
    </div>
  );
}

// =====================================================================
// Diagnostica: snapshot dell'ambiente di rendering del browser TV
// =====================================================================
interface DebugInfo {
  innerW: number;
  innerH: number;
  outerW: number;
  outerH: number;
  screenW: number;
  screenH: number;
  dpr: number;
  rootFontPx: number;
  displayScale: string;
  ua: string;
  lang: string;
  category: '4K' | 'QHD' | 'FHD' | 'HD' | 'SUB-HD';
  themeStored: string;
  themeResolved: 'light' | 'dark';
  prefersDark: boolean;
  prefersLight: boolean;
  prefersContrastMore: boolean;
  prefersReducedMotion: boolean;
}

function snapshotDebugInfo(): DebugInfo {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  const w = window.innerWidth;
  const h = window.innerHeight;
  let category: DebugInfo['category'] = 'SUB-HD';
  if (w >= 3800) category = '4K';
  else if (w >= 2500) category = 'QHD';
  else if (w >= 1900) category = 'FHD';
  else if (w >= 1200) category = 'HD';
  const stored = localStorage.getItem('conservatory_theme') ?? 'system';
  const themeResolved: 'light' | 'dark' = html.classList.contains('dark') ? 'dark' : 'light';
  const mq = window.matchMedia;
  const prefersDark = mq('(prefers-color-scheme: dark)').matches;
  const prefersLight = mq('(prefers-color-scheme: light)').matches;
  const prefersContrastMore = mq('(prefers-contrast: more)').matches;
  const prefersReducedMotion = mq('(prefers-reduced-motion: reduce)').matches;
  return {
    innerW: w,
    innerH: h,
    outerW: window.outerWidth,
    outerH: window.outerHeight,
    screenW: window.screen.width,
    screenH: window.screen.height,
    dpr: window.devicePixelRatio,
    rootFontPx: parseFloat(cs.fontSize),
    displayScale: html.style.getPropertyValue('--display-scale') || '1',
    ua: navigator.userAgent,
    lang: navigator.language,
    category,
    themeStored: stored,
    themeResolved,
    prefersDark,
    prefersLight,
    prefersContrastMore,
    prefersReducedMotion,
  };
}

function DebugOverlay({ info }: { info: DebugInfo }) {
  const themeBadge = info.themeResolved === 'dark' ? '🌙 NOTTE' : '☀️ GIORNO';
  const sysBadge = info.prefersDark ? 'sys=dark' : info.prefersLight ? 'sys=light' : 'sys=?';
  const isOverride = info.themeStored !== 'system';
  return (
    <div
      className="pointer-events-none fixed bottom-3 left-3 z-50 max-w-md rounded-lg border border-emerald-400/60 bg-black/80 px-3 py-2 font-mono text-[0.6875rem] leading-tight text-emerald-300 shadow-xl backdrop-blur-sm"
      role="status"
      aria-live="off"
    >
      <div className="mb-1 font-bold text-emerald-100">DISPLAY DEBUG · {info.category}</div>
      <div>
        viewport:{' '}
        <span className="text-white">
          {info.innerW}×{info.innerH}
        </span>{' '}
        · outer: {info.outerW}×{info.outerH}
      </div>
      <div>
        screen: {info.screenW}×{info.screenH} · DPR: <span className="text-white">{info.dpr}</span>
      </div>
      <div>
        root font: <span className="text-white">{info.rootFontPx.toFixed(2)}px</span> · scale:{' '}
        <span className="text-white">{Number(info.displayScale).toFixed(3)}×</span>
      </div>
      <div className="mt-1 border-t border-emerald-400/30 pt-1">
        theme: <span className="text-white">{themeBadge}</span> · stored:{' '}
        <span className="text-white">{info.themeStored}</span>
        {isOverride && <span className="text-amber-300"> (override)</span>}
      </div>
      <div className="text-emerald-400/80">
        {sysBadge}
        {info.prefersContrastMore && ' · contrast=more'}
        {info.prefersReducedMotion && ' · motion=reduce'}
      </div>
      <div className="mt-1 text-emerald-400/70">lang: {info.lang}</div>
      <div className="truncate text-emerald-400/60" title={info.ua}>
        UA: {info.ua.slice(0, 60)}
        {info.ua.length > 60 ? '…' : ''}
      </div>
    </div>
  );
}

// Palette per distinguere gli edifici a colpo d'occhio (ciclica se >4)
const BUILDING_ACCENTS = [
  'bg-sky-100 text-sky-700 ring-sky-300/60 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30',
  'bg-amber-100 text-amber-700 ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30',
  'bg-emerald-100 text-emerald-700 ring-emerald-300/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30',
  'bg-violet-100 text-violet-700 ring-violet-300/60 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/30',
] as const;

// ===========================
// Building timetable (kiosk): vista settimanale (Lun-Sab) → aule × giorni
// con slot 30' (08:00–21:00). Riusa il componente WeeklyRoomTimetable.
// ===========================
function BuildingTable({
  building,
  weekStart,
  index,
  stats,
}: {
  building: PublicBuilding;
  weekStart: string;
  index: number;
  /** Statistiche d'uso istituto-wide. Se presenti vengono mostrate compatte
   *  in fondo alla legenda, dopo i codici colore — sostituisce il tile-row
   *  separato che occupava una banda verticale dedicata. */
  stats: PublicStats | undefined;
}) {
  const { t } = useTranslation();
  // Aule ordinate per piano (Building.floors) → nome (numeric-aware) per
  // righe stabili indipendenti dall'ordine API.
  const sortedRooms = useMemo(() => sortRoomsForBuilding(building.rooms, building), [building]);
  // Mappiamo le PublicBooking → WeeklyBlock con label "Prof. X / Doc / Stud /
  // titolo concerto" via publicBookingsToBlocks (versione bulk che disambigua
  // automaticamente i cognomi omonimi inserendo l'iniziale del nome quando
  // necessario, es. "Prof. M. Rossi" vs "Prof. L. Rossi").
  const blocks = useMemo<WeeklyBlock[]>(() => {
    const pairs: { booking: (typeof sortedRooms)[0]['bookings'][0]; roomId: number }[] = [];
    for (const room of sortedRooms) {
      for (const b of room.bookings) {
        pairs.push({ booking: b, roomId: room.id });
      }
    }
    return publicBookingsToBlocks(pairs);
  }, [sortedRooms]);

  const totalWeek = sortedRooms.reduce((s, r) => s + r.bookings.length, 0);
  const start = dayjs(weekStart);
  const end = start.add(5, 'day');

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.08 * index, ease: 'easeOut' }}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-card"
    >
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5 2xl:px-6 2xl:py-3">
        <div className="flex items-center gap-2.5 2xl:gap-3">
          <span
            className={cn(
              'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 2xl:h-11 2xl:w-11',
              BUILDING_ACCENTS[index % BUILDING_ACCENTS.length],
            )}
          >
            <Building2 className="h-5 w-5 2xl:h-6 2xl:w-6" />
          </span>
          <div>
            <h2 className="font-display text-lg font-medium leading-none 2xl:text-2xl">
              {building.name}
            </h2>
            <p className="mt-0.5 text-[0.6875rem] text-muted-foreground 2xl:text-sm">
              {t(
                sortedRooms.length === 1 ? 'display.rooms_count_one' : 'display.rooms_count_other',
                { count: sortedRooms.length },
              )}
              {' · '}
              {t(totalWeek === 1 ? 'display.bookings_week_one' : 'display.bookings_week_other', {
                count: totalWeek,
              })}
              {' · '}
              {start.format('D MMM')}–{end.format('D MMM')}
            </p>
          </div>
        </div>
      </div>

      {/* Body autoFit: tutte le aule sempre visibili senza scroll, le righe
          si rimpiccioliscono fino al floor minRowRem (1.25rem). overflow-hidden
          per rimuovere lo scroll-bar verticale che spezzava il layout pieno. */}
      <div className="flex min-h-0 flex-1 overflow-hidden p-1 2xl:p-1.5">
        {sortedRooms.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            {t('display.no_rooms_configured')}
          </div>
        ) : (
          <WeeklyRoomTimetable
            weekStart={weekStart}
            rooms={sortedRooms}
            blocks={blocks}
            compact
            fillWidth
            autoFitRows
          />
        )}
      </div>

      {/* Legenda + statistiche d'uso compatte sulla stessa banda inferiore.
          Layout: codici colore tipologia + cell-30min a sinistra, statistiche
          d'uso a destra (in_use, oggi, settimana, aule attive). flex-wrap
          fa scendere a riga successiva sotto risoluzioni strette senza
          rubare altezza al body della tabella. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t bg-muted/20 px-4 py-1.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground 2xl:gap-x-6 2xl:px-6 2xl:py-2 2xl:text-xs">
        <div className="flex flex-wrap items-center gap-2.5 2xl:gap-4">
          {(['studio_individuale', 'lezione', 'prova', 'concerto'] as BookingType[]).map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-sm', BOOKING_TYPE_STYLES[type].dot)} />
              {t(BOOKING_TYPE_LABEL[type])}
            </span>
          ))}
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5 normal-case text-muted-foreground/90">
            <span
              aria-hidden
              className="inline-block h-2 w-2 border border-dashed border-muted-foreground/60 bg-background"
            />
            {t('display.legend.cell_30min')}
          </span>
        </div>
        <LegendStats stats={stats} />
      </div>
    </motion.section>
  );
}

// ===========================
// LegendStats — statistiche compatte renderizzate inline nella legenda del
// BuildingTable. Sostituisce la riga di KpiCard separata che occupava una
// banda verticale dedicata. Format: `icon valore label` separato da `·`,
// con le 4 voci classiche (in uso, oggi, settimana, aule attive).
// Se `stats` è undefined (loading/offline) mostra placeholder neutri.
// ===========================
function LegendStats({ stats }: { stats: PublicStats | undefined }) {
  const { t } = useTranslation();
  const items = [
    {
      Icon: Activity,
      tone: 'text-emerald-600 dark:text-emerald-300',
      value: stats ? `${stats.today.inUse}/${stats.today.roomsTotal}` : '—',
      label: stats ? t('display.kpi.in_use_subtitle', { pct: stats.today.occupancyPct }) : '',
      title: t('display.kpi.in_use'),
    },
    {
      Icon: CalendarDays,
      tone: 'text-sky-600 dark:text-sky-300',
      value: stats ? String(stats.today.bookings) : '—',
      label: stats ? t('display.kpi.bookings_today_subtitle', { hours: stats.today.hours }) : '',
      title: t('display.kpi.bookings_today'),
    },
    {
      Icon: TrendingUp,
      tone: 'text-violet-600 dark:text-violet-300',
      value: stats ? String(stats.week.bookings) : '—',
      label: stats ? t('display.kpi.week_subtitle', { hours: stats.week.hours }) : '',
      title: t('display.kpi.week'),
    },
    {
      Icon: Building2,
      tone: 'text-amber-600 dark:text-amber-300',
      value: stats ? String(stats.today.roomsTotal) : '—',
      label: t('display.kpi.active_rooms_subtitle'),
      title: t('display.kpi.active_rooms'),
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 normal-case 2xl:gap-x-5">
      {items.map(({ Icon, tone, value, label, title }, i) => (
        <span key={title} className="inline-flex items-center gap-1.5" title={title}>
          {i > 0 && (
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
          )}
          <Icon className={cn('h-3 w-3 shrink-0 2xl:h-3.5 2xl:w-3.5', tone)} />
          <span className="font-display text-[0.75rem] font-medium text-foreground 2xl:text-sm">
            {value}
          </span>
          {label && <span className="text-muted-foreground/90">{label}</span>}
        </span>
      ))}
    </div>
  );
}

// ===========================
// Concert slide
// ===========================
//
// Layout:
// - Sfondo: locandina caricata (object-cover, NESSUN blur) oppure
//   /assets/concerto.png blurato + scurito quando non c'è locandina.
// - Overlay (in basso): card con bordi arrotondati, sfondo translucido
//   ad alto contrasto rispetto allo sfondo (testo bianco su nero ~60%).
// - Info: titolo concerto, data/ora, sede (edificio + aula),
//   esecutori e programma autori. Le textarea contengono spesso
//   elenchi separati da newline → li renderizziamo riga per riga.
/**
 * Mappa eventType → tema chip (background + ring) sulla slide kiosk.
 * I colori sono leggibili sopra qualsiasi sfondo locandina (chiaro/scuro).
 */
const EVENT_TYPE_THEME: Record<
  string,
  { bg: string; ring: string; textColor: string; labelKey: string }
> = {
  concerto: {
    bg: 'bg-amber-400',
    ring: 'ring-amber-200/80',
    textColor: 'text-slate-950',
    labelKey: 'display.concert.upcoming_label',
  },
  saggio: {
    bg: 'bg-cyan-400',
    ring: 'ring-cyan-200/80',
    textColor: 'text-slate-950',
    labelKey: 'display.concert.label.saggio',
  },
  masterclass: {
    bg: 'bg-fuchsia-500',
    ring: 'ring-fuchsia-200/80',
    textColor: 'text-white',
    labelKey: 'display.concert.label.masterclass',
  },
  conferenza: {
    bg: 'bg-slate-300',
    ring: 'ring-slate-100/80',
    textColor: 'text-slate-950',
    labelKey: 'display.concert.label.conferenza',
  },
  lezione_aperta: {
    bg: 'bg-emerald-400',
    ring: 'ring-emerald-200/80',
    textColor: 'text-slate-950',
    labelKey: 'display.concert.label.lezione_aperta',
  },
};

/** ISO 639-1 → emoji bandiera (sottoinsieme controllato). */
const LANG_FLAG: Record<string, string> = {
  it: '🇮🇹',
  en: '🇬🇧',
  fr: '🇫🇷',
  de: '🇩🇪',
  es: '🇪🇸',
};

function ConcertSlide({ concert }: { concert: PublicConcert }) {
  const { t } = useTranslation();
  const hasPoster = !!concert.posterUrl;
  // Quando manca la locandina mostriamo la default blurata; con la locandina
  // dell'utente la rendiamo nitida (è già una scelta editoriale dell'admin).
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const bgSrc = hasPoster ? concert.posterUrl! : '/assets/concerto.png';
  const performers = concert.performers
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const program = concert.program
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const start = dayjs(concert.startTime);
  const venueName = concert.room?.building?.name
    ? `${concert.room.building.name} · ${concert.room.name}`
    : (concert.room?.name ?? '');
  const theme = EVENT_TYPE_THEME[concert.eventType] ?? EVENT_TYPE_THEME.concerto;
  const flag = concert.language ? LANG_FLAG[concert.language] : null;

  return (
    <section className="relative h-full w-full overflow-hidden rounded-2xl border bg-black">
      {/* Background: locandina o default blurata */}
      <img
        src={bgSrc}
        alt=""
        className={cn(
          'absolute inset-0 h-full w-full',
          hasPoster ? 'object-cover' : 'object-cover scale-110',
        )}
        style={hasPoster ? undefined : { filter: 'blur(6px) brightness(0.65)' }}
      />

      {/* Velo scuro per leggibilità del testo bianco */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: hasPoster
            ? 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 35%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0) 100%)'
            : 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.55) 100%)',
        }}
        aria-hidden
      />

      {/* Etichetta in alto a sinistra: tipologia evento.
          Colore di sfondo dipende da concert.eventType (theme map sopra). */}
      <div
        className={cn(
          'absolute left-6 top-6 inline-flex items-center gap-2.5 rounded-full px-5 py-2 text-base font-semibold uppercase tracking-wider shadow-lg ring-2 2xl:left-10 2xl:top-10 2xl:gap-3 2xl:px-7 2xl:py-3 2xl:text-xl',
          theme.bg,
          theme.ring,
          theme.textColor,
        )}
      >
        <Music4 className="h-5 w-5 2xl:h-6 2xl:w-6" />
        {t(theme.labelKey)}
      </div>

      {/* Pannello info principale */}
      <div className="absolute inset-x-0 bottom-0 px-6 pb-8 pt-6 text-white lg:px-10 2xl:px-14 2xl:pb-12">
        <div className="mx-auto max-w-5xl space-y-3 2xl:space-y-5">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm font-medium uppercase tracking-wider text-white/85 2xl:text-lg">
            <span>{start.format('dddd D MMMM · HH:mm')}</span>
            {venueName && <span className="text-white/70">· {venueName}</span>}
            {flag && (
              <span aria-label={concert.language ?? ''} title={concert.language ?? ''}>
                {flag}
              </span>
            )}
          </div>
          <h2 className="font-display text-4xl font-medium leading-tight tracking-tight text-white drop-shadow-lg sm:text-5xl xl:text-6xl 2xl:text-7xl">
            {concert.title}
          </h2>
          {concert.description && (
            <p className="max-w-4xl text-lg leading-snug text-white/90 sm:text-xl 2xl:text-2xl">
              {concert.description}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 2xl:gap-8">
            {performers.length > 0 && (
              <div>
                <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-white/70 2xl:text-sm">
                  {t('display.concert.performers')}
                </p>
                <ul className="space-y-0.5 text-base leading-snug text-white sm:text-lg 2xl:text-2xl">
                  {performers.slice(0, 6).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {program.length > 0 && (
              <div>
                <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-white/70 2xl:text-sm">
                  {t('display.concert.program')}
                </p>
                <ul className="space-y-0.5 text-base leading-snug text-white sm:text-lg 2xl:text-2xl">
                  {program.slice(0, 6).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// Slide annuncio: layout istituzionale full-bleed con icona megafono,
// titolo grande e corpo a paragrafi. Le interruzioni di riga del corpo
// vengono mantenute (textarea preservation).
function AnnouncementSlide({ announcement }: { announcement: PublicAnnouncement }) {
  const { t } = useTranslation();
  const paragraphs = announcement.body
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const published = dayjs(announcement.publishedAt);
  return (
    <section className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-linear-to-br from-rose-900 via-rose-700 to-amber-600 text-white">
      <div className="absolute -right-24 -top-24 h-105 w-105 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-32 -left-32 h-120 w-120 rounded-full bg-amber-300/20 blur-3xl" />

      {/* Etichetta tipologia in alto a sinistra: stesso pattern usato per la
          slide concerto (badge pill ambra, posizione assoluta, ring shadow). */}
      <div className="absolute left-6 top-6 z-10 inline-flex items-center gap-2.5 rounded-full bg-amber-400 px-5 py-2 text-base font-semibold uppercase tracking-wider text-slate-950 shadow-lg ring-2 ring-amber-200/80 2xl:left-10 2xl:top-10 2xl:gap-3 2xl:px-7 2xl:py-3 2xl:text-xl">
        <Megaphone className="h-5 w-5 2xl:h-6 2xl:w-6" />
        {announcement.isPinned
          ? t('display.announcement.pinned_label')
          : t('display.announcement.label')}
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-center gap-6 p-10 2xl:p-16">
        <p className="text-sm font-medium uppercase tracking-wider text-white/85 2xl:text-lg">
          {published.format('dddd D MMMM YYYY')}
        </p>
        <h2 className="font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl xl:text-6xl 2xl:text-7xl">
          {announcement.title}
        </h2>
        <div className="space-y-3 text-lg leading-relaxed text-white/95 md:text-xl xl:text-2xl 2xl:text-3xl">
          {paragraphs.slice(0, 6).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
