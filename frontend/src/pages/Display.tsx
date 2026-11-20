import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { publicApi, type PublicAgenda } from '@/api/public';
import { dayjs } from '@/lib/date';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';
import { useFullscreen, useIdle } from '@/hooks/useFullscreen';
import { useDisplayScale } from '@/hooks/useDisplayScale';
import { useAppIcon } from '@/hooks/useAppIcon';
import { useClock } from '@/hooks/useClock';
import { useDebugInfo } from '@/hooks/useDebugInfo';
import { useDisplayConnection } from '@/hooks/useDisplayConnection';
import { useDisplayLanguage } from '@/hooks/useDisplayLanguage';
import { useSlideRotation } from '@/hooks/useSlideRotation';
import { DailyRoomTimetable } from '@/components/bookings/DailyRoomTimetable';
import { parseDisplayBuildingSlug } from '@/lib/displayUrl';
import {
  aggregateAnnouncementsConfig,
  aggregateConcertsConfig,
  buildRotationBuildings,
  buildSlides,
  isBookingsRotationEnabled,
  parseTvSafePct,
} from '@/lib/displayRotation';
import { qk } from '@/lib/queryKeys';
import { AnnouncementSlide } from './display/AnnouncementSlide';
import { BuildingTable } from './display/BuildingTable';
import { ConcertSlide } from './display/ConcertSlide';
import { DebugOverlay } from './display/DebugOverlay';
import { DisplayHeader } from './display/DisplayHeader';
import { OfflineBanner } from './display/OfflineBanner';

const REFRESH_AGENDA_MS = 60_000;
const REFRESH_STATS_MS = 30_000;
const REFRESH_CONCERTS_MS = 5 * 60_000;

export default function Display() {
  const { t } = useTranslation();
  const now = useClock();
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
  // segnale di un 3-7% e tagliando i bordi. Opt-in via query param: `?tvsafe`
  // attiva un padding del 3%, `?tvsafe=N` permette di tarare da 0% a 15%.
  // Senza il param non c'è regressione su monitor PC.
  const tvSafePct = useMemo(() => parseTvSafePct(window.location.search), []);
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

  // Overlay diagnostico (`?debug=1`) per validare il rendering sul TV reale.
  const debugInfo = useDebugInfo();

  // Force tema chiaro sul kiosk: il /display è pubblico e gira su dispositivi
  // diversi (Mac admin, smart TV con OS dark, monitor HDMI dedicati). Senza
  // forzatura ogni dispositivo mostra una palette diversa in base al suo
  // `prefers-color-scheme` di sistema → kiosk non coerenti.
  //
  // IMPORTANTE: dobbiamo usare `setForceTheme` del ThemeContext invece di
  // manipolare direttamente `documentElement.classList`: il `ThemeProvider`
  // ri-applica la classe `.dark` ad ogni cambio di stato e sovrascriverebbe
  // la nostra modifica (gli effects dei figli girano PRIMA dei parent).
  const { setForceTheme } = useTheme();
  useEffect(() => {
    setForceTheme('light');
    return () => {
      setForceTheme(null);
    };
  }, [setForceTheme]);

  // Lingua del browser per il kiosk (ripristinata all'unmount).
  useDisplayLanguage();

  // Kiosk dedicato (aperto h24): l'admin che cambia logo/icona vuole vederlo
  // sul display "subito", non dopo 5 minuti. staleTime + refetchInterval
  // ridotti rispetto al pattern utente loggato (che è in `useAppIcon`).
  const instituteQuery = useQuery({
    queryKey: qk.public.institute(),
    queryFn: () => publicApi.institute(),
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
  // Icona app dell'istituto (configurata da admin) come fallback al logo
  // dell'edificio. Cade su `/logo3.png` solo in ultima istanza, in modo
  // coerente con AppLayout/AuthLayout.
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
    queryKey: qk.public.agendaWeek(weekStart),
    queryFn: () => publicApi.agendaRange(weekStart, weekEnd),
    refetchInterval: REFRESH_AGENDA_MS,
  });

  const statsQuery = useQuery({
    queryKey: qk.public.stats(),
    queryFn: () => publicApi.stats(),
    refetchInterval: REFRESH_STATS_MS,
  });

  // Configurazione rotazione: quali edifici mostrare e per quanto tempo ciascuno.
  // Il client cycla solo gli edifici con displayEnabled=true; ognuno ha il suo
  // intervalSec personalizzabile dall'admin via /admin/display.
  const displayConfigQuery = useQuery({
    queryKey: qk.public.displayConfig(),
    queryFn: () => publicApi.displayConfig(),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const institute = instituteQuery.data?.institute ?? null;
  const stats = statsQuery.data;

  // Edifici dell'agenda filtrati e riordinati secondo la configurazione admin.
  const allBuildings = useMemo(() => agendaQuery.data?.buildings ?? [], [agendaQuery.data]);
  const rotationOrder = useMemo(
    () => displayConfigQuery.data?.buildings ?? [],
    [displayConfigQuery.data],
  );
  // Filtro URL "single-building mode": se l'URL ha ?b=<slug>, ?building=<slug>,
  // o una chiave senza valore (?centrale), mostra SOLO quell'edificio.
  // Pensato per i tabelloni di ingresso di una sede specifica.
  const requestedSlug = useMemo(
    () => (typeof window !== 'undefined' ? parseDisplayBuildingSlug(window.location.search) : null),
    [],
  );

  const rotationBuildings = useMemo(
    () => buildRotationBuildings(allBuildings, rotationOrder, requestedSlug),
    [allBuildings, rotationOrder, requestedSlug],
  );

  // Aggregati concerti/annunci dalla configurazione admin (per-edificio, ma
  // applicati globalmente alla rotazione: vedi lib/displayRotation).
  const concertsConfig = useMemo(() => aggregateConcertsConfig(rotationOrder), [rotationOrder]);

  const concertsQuery = useQuery({
    queryKey: qk.public.concerts(concertsConfig.horizonDays),
    queryFn: () => publicApi.concerts(concertsConfig.horizonDays),
    enabled: concertsConfig.enabled,
    refetchInterval: REFRESH_CONCERTS_MS,
    staleTime: 60_000,
  });

  const announcementsConfig = useMemo(
    () => aggregateAnnouncementsConfig(rotationOrder),
    [rotationOrder],
  );

  const announcementsQuery = useQuery({
    queryKey: qk.public.announcements(announcementsConfig.pinnedOnly, announcementsConfig.cap),
    queryFn: () =>
      publicApi.announcements({
        pinned: announcementsConfig.pinnedOnly,
        limit: announcementsConfig.cap > 0 ? announcementsConfig.cap : 30,
      }),
    enabled: announcementsConfig.enabled,
    refetchInterval: REFRESH_AGENDA_MS,
    staleTime: 30_000,
  });

  // Slide della rotazione: prima tutti gli edifici, poi i concerti in arrivo,
  // poi gli annunci. Master switch prenotazioni: se NESSUN edificio in
  // rotazione ha bookingsEnabled=true, le slide edifici saltano del tutto.
  const bookingsEnabled = isBookingsRotationEnabled(rotationOrder);
  const concerts = concertsQuery.data?.concerts;
  const announcements = announcementsQuery.data?.announcements;
  const slides = useMemo(
    () =>
      buildSlides({
        rotationBuildings,
        bookingsEnabled,
        concertsConfig,
        concerts,
        announcementsConfig,
        announcements,
      }),
    [
      rotationBuildings,
      bookingsEnabled,
      concertsConfig,
      concerts,
      announcementsConfig,
      announcements,
    ],
  );

  const { currentIndex, currentSlide } = useSlideRotation(slides);

  const { isLive, showOfflineBanner, lastUpdateLabel } = useDisplayConnection({
    agendaError: agendaQuery.isError,
    statsError: statsQuery.isError,
    agendaUpdatedAt: agendaQuery.dataUpdatedAt,
  });

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
      <DisplayHeader
        institute={institute}
        appIcon={appIcon}
        now={now}
        isLive={isLive}
        hideUi={hideUi}
      />

      {showOfflineBanner && <OfflineBanner lastUpdateLabel={lastUpdateLabel} />}

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
