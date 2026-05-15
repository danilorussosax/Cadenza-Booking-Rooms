import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Building2,
  CalendarCheck2,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  DoorOpen,
  FileDown,
  GitPullRequest,
  Hourglass,
  PackageOpen,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { bookingsApi } from '@/api/bookings';
import { loansApi } from '@/api/instruments';
import { monteOreAdminApi, monteOreApi } from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { dayjs, formatDate, formatTime } from '@/lib/date';
import { isCheckInRequired } from '@/lib/checkInPolicy';
import { sortRoomsForBuilding } from '@/lib/sortRooms';
import { bookingsToBlocks } from '@/lib/weeklyBlocks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookingFormDialog } from '@/components/bookings/BookingFormDialog';
import { CancelBookingDialog } from '@/components/bookings/CancelBookingDialog';
import { BookingInfoDialog } from '@/components/bookings/BookingInfoDialog';
import { WeeklyRoomTimetable } from '@/components/bookings/WeeklyRoomTimetable';
import { WeeklyExportPrintView } from '@/components/bookings/WeeklyExportPrintView';
import { WaitlistDashboardCard } from '@/components/bookings/WaitlistDashboardCard';
import { QuickBookCard } from '@/components/bookings/QuickBookCard';
import type { Booking, InstrumentLoan, LoanStatus, Room } from '@/types';

const LOAN_STATUS_VARIANT: Record<LoanStatus, 'success' | 'secondary' | 'muted' | 'default'> = {
  requested: 'secondary',
  active: 'success',
  returned: 'muted',
  overdue: 'default',
  rejected: 'muted',
};

function greetingKey() {
  const h = new Date().getHours();
  if (h < 6) return 'dashboard.greeting_night';
  if (h < 12) return 'dashboard.greeting_morning';
  if (h < 18) return 'dashboard.greeting_afternoon';
  return 'dashboard.greeting_evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  // Vista giornaliera: salviamo la data del giorno mostrato (YYYY-MM-DD).
  // Inizializziamo a oggi; con i bottoni "Precedente / Oggi / Successivo"
  // navighiamo a passi di 1 giorno. La WeeklyRoomTimetable supporta già una
  // singola colonna giorno tramite daysCount={1}, quindi riusiamo il
  // componente con `weekStart=dayStart`.
  const [dayStart, setDayStart] = useState<string>(() => dayjs().format('YYYY-MM-DD'));
  // Vista del calendario: singolo giorno (default) o 3 giorni consecutivi
  // (corrente + 2 successivi). Persistita in localStorage per coerenza fra
  // sessioni: chi preferisce la vista a 3 giorni la ritrova al login successivo.
  const [calendarRange, setCalendarRange] = useState<'single' | 'three'>(() => {
    if (typeof window === 'undefined') return 'single';
    const saved = window.localStorage.getItem('cadenza:dashboard-calendar-range');
    return saved === 'three' ? 'three' : 'single';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('cadenza:dashboard-calendar-range', calendarRange);
  }, [calendarRange]);
  const calendarDaysCount = calendarRange === 'three' ? 3 : 1;
  // Inizio della settimana ISO che contiene `dayStart` — usato dal PDF di
  // export settimanale (che resta su scala settimanale, indipendente dalla
  // vista in-dashboard).
  const weekStart = useMemo(
    () => dayjs(dayStart).startOf('isoWeek').format('YYYY-MM-DD'),
    [dayStart],
  );
  const [buildingTab, setBuildingTab] = useState<string>('');
  const [createState, setCreateState] = useState<{
    open: boolean;
    roomId?: number;
    start?: Date;
    end?: Date;
  }>({ open: false });
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [infoTarget, setInfoTarget] = useState<Booking | null>(null);
  // Edit booking dialog target — admin può modificare qualsiasi prenotazione,
  // proprietario può modificare solo la propria. Apriamo il BookingFormDialog
  // in edit mode passando l'oggetto Booking come prop.
  const [editTarget, setEditTarget] = useState<Booking | null>(null);

  // Viewport >= lg: alcuni link KPI (es. /monte-ore) hanno senso solo qui
  // perche' la pagina di planning richiede tabelle dense desktop.
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 1024px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const upcomingQuery = useQuery({
    queryKey: ['bookings', 'mine', 'upcoming'],
    queryFn: () =>
      bookingsApi.list({
        mine: true,
        from: new Date().toISOString(),
        status: 'confirmed',
      }),
  });

  const usageQuery = useQuery({
    queryKey: ['bookings', 'usage', 'me'],
    queryFn: () => bookingsApi.myUsage(),
    staleTime: 30_000,
  });

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
  });

  const loansQuery = useQuery({
    queryKey: ['loans', 'mine'],
    queryFn: () => loansApi.mine(),
    staleTime: 30_000,
  });

  // Prenotazioni dell'utente in attesa di approvazione admin: empty-silent.
  const pendingApprovalsQuery = useQuery({
    queryKey: ['bookings', 'mine', 'pending'],
    queryFn: () => bookingsApi.minePending(),
    staleTime: 30_000,
  });

  // Solo per admin: conteggio code di approvazione (prenotazioni standard +
  // variazioni monte ore) per le card della dashboard. Polling 60s coerente
  // col badge della sidebar.
  const isAdmin = user?.role === 'admin';
  const isDocente = user?.role === 'docente';

  // Per docenti con override Monte Ore individuale (contratto orario,
  // supplenti, part-time): la quota settimanale di booking è poco
  // significativa rispetto al monte ore annuale contrattuale. Sostituiamo
  // il tile "Ore residue settimanali" con "Monte Ore: pianificate/soglia".
  // Solo per role=docente; se non c'è override torna 'institute_settings'
  // o 'default' e usiamo il flusso standard.
  const monteOreThresholdQuery = useQuery({
    queryKey: ['monte-ore', 'me', 'threshold'],
    queryFn: () => monteOreApi.getMyThreshold(),
    enabled: isDocente,
    staleTime: 60_000,
  });
  const hasMonteOreOverride = monteOreThresholdQuery.data?.source === 'user_override';
  const monteOreProposalQuery = useQuery({
    queryKey: ['monte-ore', 'me'],
    queryFn: () => monteOreApi.getMine(),
    enabled: isDocente && hasMonteOreOverride,
    staleTime: 60_000,
  });
  const adminBookingsPendingQuery = useQuery({
    queryKey: ['admin', 'bookings', 'pending', 'count'],
    queryFn: () => bookingsApi.pendingCount(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: isAdmin,
  });
  const adminAmendmentsPendingQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'amendments', 'pending-count'],
    queryFn: () => monteOreAdminApi.pendingAmendmentsCount(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: isAdmin,
  });
  const bookingsPendingCount = adminBookingsPendingQuery.data?.count ?? 0;
  const amendmentsPendingCount = adminAmendmentsPendingQuery.data?.count ?? 0;

  // All bookings (any user) per la finestra del calendario selezionata.
  // Range: 00:00 del primo giorno → 23:59 dell'ultimo giorno della finestra
  // (1 giorno per `calendarRange='single'`, 3 giorni per `calendarRange='three'`).
  const calendarBookingsQuery = useQuery({
    queryKey: ['bookings', 'day', dayStart, calendarDaysCount],
    queryFn: () =>
      bookingsApi.list({
        from: dayjs(dayStart).startOf('day').toISOString(),
        to: dayjs(dayStart)
          .add(calendarDaysCount - 1, 'day')
          .endOf('day')
          .toISOString(),
        status: 'confirmed',
      }),
  });

  const upcoming = useMemo(
    () => (upcomingQuery.data?.bookings ?? []).slice(0, 5),
    [upcomingQuery.data],
  );
  const next = upcoming[0];

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allLoans = loansQuery.data?.loans ?? [];
  const activeLoans = useMemo(
    () => allLoans.filter((l) => l.status === 'active' || l.status === 'overdue'),
    [allLoans],
  );
  const pendingLoans = useMemo(() => allLoans.filter((l) => l.status === 'requested'), [allLoans]);
  const showLoansCard = activeLoans.length > 0 || pendingLoans.length > 0;
  const dashboardLoans = useMemo(
    () => [...activeLoans, ...pendingLoans].slice(0, 3),
    [activeLoans, pendingLoans],
  );

  const usage = usageQuery.data;
  const usageDisplay = useMemo(() => {
    if (!usage) return { value: '—', hint: '' };
    const w = usage.weekly;
    if (usage.unlimited || w.max == null) {
      return {
        value: '∞',
        hint: t('dashboard.stats.weekly_remaining_unlimited', { used: w.usedHours }),
      };
    }
    return {
      value: `${w.remainingHours ?? 0}h`,
      hint: t('dashboard.stats.weekly_remaining_hint', { max: w.max, used: w.usedHours }),
    };
  }, [usage, t]);

  // Group rooms by building
  const buildingsMap = useMemo(() => {
    const map = new Map<number, { id: number; name: string; rooms: Room[] }>();
    for (const r of roomsQuery.data?.rooms ?? []) {
      const b = r.building;
      if (!b) continue;
      if (!map.has(b.id)) map.set(b.id, { id: b.id, name: b.name, rooms: [] });
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      map.get(b.id)!.rooms.push(r);
    }
    // Aule ordinate per piano → nome (numeric-aware) coerentemente con il resto
    // dell'app, in modo che le righe della weekly view siano stabili.
    for (const b of map.values()) {
      const floorsRef = b.rooms[0]?.building ?? null;
      b.rooms = sortRoomsForBuilding(b.rooms, floorsRef);
    }
    return map;
  }, [roomsQuery.data]);
  const buildings = useMemo(() => Array.from(buildingsMap.values()), [buildingsMap]);

  // Default tab = first building once loaded
  useEffect(() => {
    if (!buildingTab && buildings.length > 0) setBuildingTab(String(buildings[0].id));
  }, [buildings, buildingTab]);

  const selectedBuilding = buildingsMap.get(Number(buildingTab));
  const calendarRooms = selectedBuilding?.rooms ?? [];

  const stats: StatTile[] = [
    {
      label: t('dashboard.stats.active_bookings'),
      value: upcomingQuery.data?.bookings.length ?? '—',
      icon: CalendarCheck2,
      hint: t('dashboard.stats.active_bookings_hint'),
      tone: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
    },
  ];

  if (isAdmin) {
    // Admin layout: 1) Prenotazioni attive, 2) Aule disponibili,
    // 3) Prenotazioni da approvare, 4) Variazioni monte ore. Le ultime due
    // card (cliccabili) puntano alle code di approvazione.
    stats.push({
      label: t('dashboard.stats.available_rooms'),
      value: roomsQuery.data?.rooms.length ?? '—',
      icon: DoorOpen,
      hint: t('dashboard.stats.available_rooms_hint'),
      tone: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
    });
    stats.push({
      label: t('dashboard.stats.pending_bookings_approvals'),
      value: adminBookingsPendingQuery.isLoading ? '—' : bookingsPendingCount,
      icon: ClipboardCheck,
      hint: t('dashboard.stats.pending_bookings_approvals_hint'),
      tone: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
      to: '/admin/approvals',
    });
    stats.push({
      label: t('dashboard.stats.pending_amendments'),
      value: adminAmendmentsPendingQuery.isLoading ? '—' : amendmentsPendingCount,
      icon: GitPullRequest,
      hint: t('dashboard.stats.pending_amendments_hint'),
      tone: 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-400',
      to: '/admin/monte-ore',
    });
  } else {
    // Tile "ore quota": per docenti con deroga Monte Ore individuale
    // (contratto orario, supplenti, part-time) sostituiamo la quota
    // settimanale di booking — che è meaningless rispetto al monte ore
    // annuale contrattuale — con "Monte Ore: pianificate/soglia".
    if (isDocente && hasMonteOreOverride && monteOreThresholdQuery.data) {
      const minH = monteOreThresholdQuery.data.minHours;
      const planned = monteOreProposalQuery.data?.proposal.totalHoursRequested ?? 0;
      const meets = planned >= minH;
      const ctLabel: Record<string, string> = {
        titolare: 'titolare',
        contratto_orario: 'contratto orario',
        supplente: 'supplente',
        altro: 'altro',
      };
      const ct = monteOreThresholdQuery.data.contractType;
      const ctText = ct ? (ctLabel[ct] ?? 'individuale') : 'individuale';
      stats.push({
        label: 'Monte Ore annuali',
        value: monteOreProposalQuery.isLoading ? '—' : `${planned.toFixed(1)} / ${minH} h`,
        icon: Hourglass,
        hint: meets
          ? `✓ Soglia raggiunta · ${ctText}`
          : `Mancano ${(minH - planned).toFixed(1)} h · ${ctText}`,
        tone: meets
          ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
          : 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
        // Link a /monte-ore solo su desktop: la pagina di planning con
        // tabelle dense non e' gestibile da smartphone. Su mobile il tile
        // mostra lo stato (informativo) ma non e' navigabile.
        to: isDesktop ? '/monte-ore' : undefined,
      });
    } else {
      stats.push({
        label: t('dashboard.stats.weekly_remaining_hours'),
        value: usageQuery.isLoading ? '—' : usageDisplay.value,
        icon: Hourglass,
        hint:
          usageDisplay.hint ||
          `${dayjs().startOf('isoWeek').format('D MMM')} – ${dayjs()
            .endOf('isoWeek')
            .format('D MMM')}`,
        tone: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
      });
    }
    stats.push({
      label: t('dashboard.stats.available_rooms'),
      value: roomsQuery.data?.rooms.length ?? '—',
      icon: DoorOpen,
      hint: t('dashboard.stats.available_rooms_hint'),
      tone: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
    });
    stats.push({
      label: t('dashboard.stats.next_session'),
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      value: next ? dayjs(next.startTime).fromNow() : '—',
      icon: Sparkles,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      hint: next
        ? formatDate(next.startTime, 'ddd D MMM, HH:mm')
        : t('dashboard.stats.next_session_none'),
      tone: 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-400',
    });
  }

  if (showLoansCard) {
    stats.push({
      label: t('dashboard.stats.active_loans'),
      value: activeLoans.length,
      icon: PackageOpen,
      hint: t('dashboard.stats.active_loans_hint', { pending: pendingLoans.length }),
      tone: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
    });
  }

  // Click/drag handler for the timetable.
  //
  // Click singolo (un solo slot da 30'): lo espandiamo a 1 ora di default —
  // l'utente regola in dialog. Drag esplicito (più slot): rispettiamo la
  // durata selezionata, così "punta e trascina" mostra subito il range scelto
  // nel dialog di prenotazione.
  const handleSlotRangeSelect = (room: { id: number }, start: Date, end: Date) => {
    const durationMin = dayjs(end).diff(dayjs(start), 'minute');
    const finalEnd = durationMin <= 30 ? dayjs(start).add(1, 'hour').toDate() : end;
    setCreateState({ open: true, roomId: room.id, start, end: finalEnd });
  };
  const handleBookingClick = (b: Booking) => {
    if (b.status !== 'confirmed' || dayjs(b.endTime).isBefore(dayjs())) return;
    // Admin: clic apre il dialog di modifica (può cambiare qualsiasi prenotazione,
    // anche di altri, e riassegnare l'owner). La cancellazione resta accessibile
    // dalle azioni della tabella admin (bulk-cancel) o tramite la pagina dell'utente.
    if (user?.role === 'admin') {
      setEditTarget(b);
      return;
    }
    // Owner non-admin: clic sulla propria prenotazione apre l'annullamento.
    if (b.userId === user?.id) {
      setCancelTarget(b);
      return;
    }
    // Prenotazione altrui (docente / studente vede una prenotazione di un
    // collega): apre un dialog read-only con i dettagli. Niente azioni di
    // modifica/cancellazione, solo info ("chi ha l'aula prenotata in questo
    // slot"). Le info sensibili (email, matricola) non vengono mostrate.
    setInfoTarget(b);
  };

  const today = dayjs().format('YYYY-MM-DD');
  const isToday = dayStart === today;

  // Blocchi della weekly view (per la sola tab edificio selezionata).
  const weeklyBlocks = useMemo(
    () => bookingsToBlocks(calendarBookingsQuery.data?.bookings ?? []),
    [calendarBookingsQuery.data],
  );

  // "Esporta PDF Settimanale" → l'overlay WeeklyExportPrintView è sempre
  // montato ma con display:none in screen (visibile solo via @media print, vedi
  // index.css). Il bottone richiama direttamente window.print() — l'utente
  // sceglie "Salva come PDF" dal dialog del browser.
  const handleExport = () => {
    window.print();
  };

  // Mobile-only: edifici → aule → prenotazioni del giorno, struttura
  // gerarchica per il disclosure annidato. Riusa `buildings` (gia'
  // calcolato per il timetable desktop) e `calendarBookingsQuery`.
  // Solo single-day, niente range three.
  const buildingsWithDayBookings = useMemo(() => {
    const allBookings = calendarBookingsQuery.data?.bookings ?? [];
    const dayBegin = dayjs(dayStart).startOf('day');
    const dayEnd = dayBegin.add(1, 'day');
    const dayBookings = allBookings.filter(
      (b) => dayjs(b.startTime).isBefore(dayEnd) && dayjs(b.endTime).isAfter(dayBegin),
    );
    return buildings.map((building) => {
      const bookableRooms = building.rooms.filter((r) => r.isBookable);
      const roomsWithBookings = bookableRooms.map((room) => ({
        room,
        bookings: dayBookings
          .filter((b) => b.roomId === room.id)
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
      }));
      const totalBookings = roomsWithBookings.reduce((sum, r) => sum + r.bookings.length, 0);
      return { building, rooms: roomsWithBookings, totalBookings };
    });
  }, [buildings, calendarBookingsQuery.data, dayStart]);

  // Booking imminenti che richiedono check-in:
  // confermate, senza checkedInAt, con startTime nei prossimi 30 min OR già
  // iniziate da meno di GHOST_GRACE_MINUTES (default 15 backend).
  // La finestra è approssimata lato client per evitare un'altra chiamata API:
  // basta che sia "abbastanza vicina" da meritare la card.
  const checkinNeeded = useMemo(() => {
    const all = upcomingQuery.data?.bookings ?? [];
    const earliest = dayjs().subtract(15, 'minute');
    const latest = dayjs().add(30, 'minute');
    return all.filter(
      (b) =>
        b.status === 'confirmed' &&
        !!b.room &&
        isCheckInRequired(b.room) &&
        !b.checkedInAt &&
        dayjs(b.startTime).isAfter(earliest) &&
        dayjs(b.startTime).isBefore(latest),
    );
  }, [upcomingQuery.data]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 sm:space-y-8">
      {/* Hero — versione mobile compatta (< lg) */}
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sun className="h-3.5 w-3.5 text-amber-500" />
            {t(greetingKey())}, {user?.firstName}
          </p>
          <p className="font-display text-base font-medium capitalize text-foreground">
            {dayjs().format('dddd D MMMM')}
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => {
            setCreateState({ open: true });
          }}
        >
          <CalendarPlus className="h-4 w-4" />
          {t('my_bookings.new_booking')}
        </Button>
      </div>

      {/* Hero — versione desktop (>= lg) */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="hidden lg:flex lg:flex-row lg:items-end lg:justify-between lg:gap-4"
      >
        <div className="space-y-1.5">
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Sun className="h-4 w-4 text-amber-500" />
            {t(greetingKey())}, {user?.firstName}
          </p>
          <h1 className="font-display text-3xl font-medium tracking-tight">
            {t('dashboard.hero_question')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('dashboard.today_welcome', { date: dayjs().format('dddd D MMMM YYYY') })}
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => {
            setCreateState({ open: true });
          }}
        >
          <CalendarPlus className="h-4 w-4" />
          {t('my_bookings.new_booking')}
        </Button>
      </motion.div>

      {/* Prossima sessione (mobile-only) — info piu' actionable in primo piano */}
      <Card className="border-primary/20 bg-primary/5 lg:hidden">
        <CardContent className="p-4">
          {next ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {t('dashboard.stats.next_session')}
              </div>
              <p className="font-display text-2xl font-medium">{dayjs(next.startTime).fromNow()}</p>
              <p className="text-sm">
                {formatDate(next.startTime, 'ddd D MMM · HH:mm')}
                {next.room ? ` · ${next.room.name}` : ''}
              </p>
              {next.room?.building && (
                <p className="text-xs text-muted-foreground">
                  {next.room.building.name}
                  {next.room.floor ? ` · ${next.room.floor}` : ''}
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('dashboard.stats.next_session')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.stats.next_session_none')}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  setCreateState({ open: true });
                }}
              >
                <CalendarPlus className="h-4 w-4" />
                {t('my_bookings.new_booking')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Waitlist card: visibile solo se l'utente è in coda per qualche aula */}
      <WaitlistDashboardCard />

      {/* Quick book: max 3 template "favoriti" per prenotare con 1 click la
          prossima occorrenza del giorno. Empty-silent: se l'utente non ha
          favoriti, la card non appare. */}
      <QuickBookCard />

      {/* Approvazioni in attesa: empty-silent. Visibile solo se l'utente ha
          almeno una prenotazione in stato 'pending_approval'. */}
      {(pendingApprovalsQuery.data?.bookings.length ?? 0) > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 ring-1 ring-amber-300 dark:bg-amber-500/20 dark:ring-amber-400/40">
                  <Clock className="h-5 w-5 text-amber-700 dark:text-amber-300" />
                </span>
                <div className="space-y-1">
                  <p className="font-medium">{t('dashboard.pending_approvals.title')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('dashboard.pending_approvals.subtitle', {
                      count: pendingApprovalsQuery.data?.bookings.length ?? 0,
                    })}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {(pendingApprovalsQuery.data?.bookings ?? []).slice(0, 3).map((b) => (
                      <li key={b.id} className="truncate">
                        <span className="font-medium text-foreground">{b.room?.name ?? '—'}</span>
                        {b.room?.building?.name && <span> · {b.room.building.name}</span>}
                        <span>
                          {' '}
                          · {formatDate(b.startTime, 'ddd D MMM')}{' '}
                          {dayjs(b.startTime).format('HH:mm')}–{dayjs(b.endTime).format('HH:mm')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/my-bookings">
                  {t('dashboard.pending_approvals.see_all')}
                  <ArrowRight className="h-3.5 w-3.5 text-primary" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Check-in card: visibile solo se ci sono booking imminenti senza check-in */}
      {checkinNeeded.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 ring-1 ring-amber-300 dark:bg-amber-500/20 dark:ring-amber-400/40">
                  <CheckCircle2 className="h-5 w-5 text-amber-700 dark:text-amber-300" />
                </span>
                <div className="space-y-0.5">
                  <p className="font-medium">{t('check_in.dashboard_card_title')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      checkinNeeded.length === 1
                        ? 'check_in.dashboard_card_help_one'
                        : 'check_in.dashboard_card_help_other',
                      { count: checkinNeeded.length },
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {checkinNeeded.slice(0, 2).map((b) => (
                  <Button
                    key={b.id}
                    asChild
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <Link to={`/check-in/room/${b.roomId}`}>
                      <CheckCircle2 className="h-4 w-4" />
                      {b.room?.name ?? t('check_in.dashboard_card_action')}
                    </Link>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s, i) => (
          <StatTileCard key={s.label} tile={s} delay={0.05 + i * 0.04} />
        ))}
      </div>

      {/* Aule e prenotazioni del giorno (mobile-only): rimpiazza il Weekly
          Timetable desktop con un'esperienza list-with-disclosure piu' adatta
          al telefono. Usa <details> nativo: zero stato, zero dipendenze.
          Riusa le stesse query del calendar desktop, quindi non aggiunge
          fetch lato server. */}
      <Card className="lg:hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{t('dashboard.calendar_title')}</CardTitle>
            <p className="mt-0.5 truncate text-xs capitalize text-muted-foreground">
              {dayjs(dayStart).format('dddd D MMMM')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              title={t('dashboard.prev_day')}
              onClick={() => {
                setDayStart(dayjs(dayStart).subtract(1, 'day').format('YYYY-MM-DD'));
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => {
                setDayStart(today);
              }}
              disabled={isToday}
            >
              {t('dashboard.today')}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              title={t('dashboard.next_day')}
              onClick={() => {
                setDayStart(dayjs(dayStart).add(1, 'day').format('YYYY-MM-DD'));
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {roomsQuery.isLoading || calendarBookingsQuery.isLoading ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </>
          ) : buildingsWithDayBookings.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('rooms.no_rooms')}</p>
          ) : (
            buildingsWithDayBookings.map(({ building, rooms: bldgRooms, totalBookings }) => (
              <details
                key={building.id}
                // Auto-apri solo se c'e' un unico edificio (evita il tap extra
                // ridondante). Multi-edificio: tutti chiusi, l'utente sceglie.
                open={buildingsWithDayBookings.length === 1}
                className="group rounded-lg border bg-card transition-colors open:bg-muted/20 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{building.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {bldgRooms.length} {bldgRooms.length === 1 ? 'aula' : 'aule'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={totalBookings === 0 ? 'success' : 'secondary'}>
                      {totalBookings === 0 ? 'Tutte libere' : `${totalBookings} prenot.`}
                    </Badge>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </div>
                </summary>
                <div className="space-y-1.5 border-t p-2">
                  {bldgRooms.length === 0 ? (
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      Nessuna aula prenotabile in questo edificio
                    </p>
                  ) : (
                    bldgRooms.map(({ room, bookings: dayBookings }) => (
                      <details
                        key={room.id}
                        className="group/room rounded-md border bg-background transition-colors open:bg-muted/40"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-2 text-xs">
                          <div className="flex min-w-0 items-center gap-2">
                            <DoorOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{room.name}</p>
                              {room.floor && (
                                <p className="truncate text-[10px] text-muted-foreground">
                                  {room.floor}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Badge
                              variant={dayBookings.length === 0 ? 'success' : 'secondary'}
                              className="text-[10px]"
                            >
                              {dayBookings.length === 0 ? 'Libera' : `${dayBookings.length}`}
                            </Badge>
                            <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform group-open/room:rotate-180" />
                          </div>
                        </summary>
                        <div className="space-y-1 border-t p-2">
                          {dayBookings.length === 0 ? (
                            <p className="py-1 text-center text-[10px] text-muted-foreground">
                              Nessuna prenotazione oggi
                            </p>
                          ) : (
                            dayBookings.map((b) => {
                              const owned = user?.id === b.userId;
                              return (
                                <button
                                  type="button"
                                  key={b.id}
                                  onClick={() => {
                                    handleBookingClick(b);
                                  }}
                                  className={
                                    owned
                                      ? 'flex w-full items-center gap-2 rounded-md border-2 border-primary/40 bg-primary/5 p-1.5 text-left text-[11px] transition-colors hover:bg-primary/10'
                                      : 'flex w-full items-center gap-2 rounded-md border bg-card p-1.5 text-left text-[11px] transition-colors hover:bg-accent'
                                  }
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-medium tabular-nums">
                                        {formatTime(b.startTime)}–{formatTime(b.endTime)}
                                      </span>
                                      <span className="truncate capitalize text-[9px] text-muted-foreground">
                                        · {b.type.replace('_', ' ')}
                                      </span>
                                    </div>
                                    {b.user && (
                                      <p className="truncate text-[9px] text-muted-foreground">
                                        {b.user.firstName} {b.user.lastName}
                                      </p>
                                    )}
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </details>
                    ))
                  )}
                </div>
              </details>
            ))
          )}
        </CardContent>
      </Card>

      {/* Calendar / Timetable giornaliero per edificio selezionato — desktop-only
          (< lg: troppo denso per mobile, l'utente puo' andare su /booking per il calendario aule) */}
      <Card className="hidden lg:block">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="font-display text-xl">{t('dashboard.calendar_title')}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.calendar_help')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Toggle vista: singolo giorno (default) o 3 giorni consecutivi.
                Il giorno mostrato in `dayStart` resta il primo della finestra
                (es. oggi + 2 successivi quando `calendarRange='three'`). */}
            <div
              role="group"
              aria-label={t('dashboard.calendar_range.label')}
              className="inline-flex rounded-md border bg-background p-0.5"
            >
              <Button
                type="button"
                variant={calendarRange === 'single' ? 'default' : 'ghost'}
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => {
                  setCalendarRange('single');
                }}
                aria-pressed={calendarRange === 'single'}
              >
                {t('dashboard.calendar_range.single')}
              </Button>
              <Button
                type="button"
                variant={calendarRange === 'three' ? 'default' : 'ghost'}
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => {
                  setCalendarRange('three');
                }}
                aria-pressed={calendarRange === 'three'}
              >
                {t('dashboard.calendar_range.three')}
              </Button>
            </div>
            <Button
              variant="outline"
              size="icon"
              title={t('dashboard.prev_day')}
              onClick={() => {
                setDayStart(
                  dayjs(dayStart).subtract(calendarDaysCount, 'day').format('YYYY-MM-DD'),
                );
              }}
            >
              <ChevronLeft className="h-4 w-4 text-primary" />
            </Button>
            <Input
              type="date"
              value={dayStart}
              onChange={(e) => {
                if (!e.target.value) return;
                setDayStart(dayjs(e.target.value).format('YYYY-MM-DD'));
              }}
              className="w-auto"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDayStart(today);
              }}
              disabled={isToday}
            >
              {t('dashboard.today')}
            </Button>
            <Button
              variant="outline"
              size="icon"
              title={t('dashboard.next_day')}
              onClick={() => {
                setDayStart(dayjs(dayStart).add(calendarDaysCount, 'day').format('YYYY-MM-DD'));
              }}
            >
              <ChevronRight className="h-4 w-4 text-primary" />
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleExport}
              disabled={
                roomsQuery.isLoading || calendarBookingsQuery.isLoading || buildings.length === 0
              }
            >
              <FileDown className="h-4 w-4" />
              {t('dashboard.export_weekly_pdf')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Building tabs */}
          {buildings.length > 1 && (
            <Tabs value={buildingTab} onValueChange={setBuildingTab}>
              <TabsList>
                {buildings.map((b) => (
                  <TabsTrigger key={b.id} value={String(b.id)}>
                    {b.name} · {b.rooms.length}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <p className="font-display text-base capitalize">
            {calendarRange === 'three'
              ? t('dashboard.calendar_range.range_label', {
                  from: dayjs(dayStart).format('dddd D MMMM'),
                  to: dayjs(dayStart).add(2, 'day').format('dddd D MMMM YYYY'),
                })
              : dayjs(dayStart).format('dddd D MMMM YYYY')}
          </p>

          {roomsQuery.isLoading || calendarBookingsQuery.isLoading ? (
            <Skeleton className="h-[520px] w-full" />
          ) : (
            <WeeklyRoomTimetable
              weekStart={dayStart}
              daysCount={calendarDaysCount}
              rooms={calendarRooms}
              blocks={weeklyBlocks.filter((blk) => calendarRooms.some((r) => r.id === blk.roomId))}
              currentUserId={user?.id ?? null}
              onSlotRangeSelect={handleSlotRangeSelect}
              onBlockClick={(blk) => {
                const found = calendarBookingsQuery.data?.bookings.find((b) => b.id === blk.id);
                if (found) handleBookingClick(found);
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Print-only overlay: una pagina A4 landscape per ogni edificio.
          Sempre montato; visibile solo in stampa (vedi src/index.css).
          Renderizziamo solo quando i dati sono pronti per evitare grid vuote. */}
      {!roomsQuery.isLoading && !calendarBookingsQuery.isLoading && (
        <WeeklyExportPrintView weekStart={weekStart} buildings={buildings} blocks={weeklyBlocks} />
      )}

      {/* Sezione "Prossime prenotazioni" rimossa dalla Dashboard:
          ridondante con la pagina /my-bookings. La query `upcomingQuery`
          resta attiva perche' alimenta KPI, "Prossima sessione" hero
          mobile e la card check-in. */}

      {showLoansCard && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-display text-xl">
              <PackageOpen className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              {t('dashboard.loans.title')}
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/my-loans">
                {t('dashboard.loans.see_all')}
                <ArrowRight className="h-3.5 w-3.5 text-primary" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboardLoans.map((loan) => (
              <LoanDashboardRow key={loan.id} loan={loan} />
            ))}
          </CardContent>
        </Card>
      )}

      <BookingFormDialog
        open={createState.open}
        onOpenChange={(open) => {
          setCreateState((s) => ({ ...s, open, roomId: open ? s.roomId : undefined }));
        }}
        defaultRoomId={createState.roomId}
        defaultStart={createState.start}
        defaultEnd={createState.end}
      />
      {/* Edit dialog — istanza separata: usa lo stesso componente con prop
          `booking` valorizzata per pre-riempire il form e PATCHare via PUT. */}
      <BookingFormDialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        booking={editTarget}
      />
      <CancelBookingDialog
        booking={cancelTarget}
        onClose={() => {
          setCancelTarget(null);
        }}
      />
      {/* Click su prenotazione altrui (non admin, non owner): dialog read-only. */}
      <BookingInfoDialog
        booking={infoTarget}
        onClose={() => {
          setInfoTarget(null);
        }}
      />
    </div>
  );
}

function LoanDashboardRow({ loan }: { loan: InstrumentLoan }) {
  const { t } = useTranslation();
  const inst = loan.instrument;
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div className="relative aspect-square h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
        <img
          src={inst?.photoUrl ?? '/assets/instrument-default.svg'}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.src.endsWith('/assets/instrument-default.svg')) {
              img.src = '/assets/instrument-default.svg';
            }
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">{inst?.name ?? '—'}</p>
          <Badge variant={LOAN_STATUS_VARIANT[loan.status]}>
            {t(`loans.status.${loan.status}`)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatDate(loan.fromDate)} → {formatDate(loan.toDate)}
        </p>
      </div>
    </div>
  );
}

interface StatTile {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
  tone: string;
  to?: string;
}

function StatTileCard({ tile, delay }: { tile: StatTile; delay: number }) {
  const card = (
    <Card
      className={
        tile.to
          ? 'h-full transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/20'
          : 'h-full'
      }
    >
      <CardContent className="flex items-start gap-2 p-3 sm:gap-3 sm:p-5">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10 ${tile.tone}`}
        >
          <tile.icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground sm:text-xs">
            {tile.label}
          </p>
          <p className="font-display text-xl font-medium sm:text-2xl">{tile.value}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">{tile.hint}</p>
        </div>
        {tile.to && (
          <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
        )}
      </CardContent>
    </Card>
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="h-full"
    >
      {tile.to ? (
        <Link
          to={tile.to}
          className="block h-full rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {card}
        </Link>
      ) : (
        card
      )}
    </motion.div>
  );
}
