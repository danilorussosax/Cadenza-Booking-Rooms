import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  CalendarCheck2,
  CalendarPlus,
  CheckCircle2,
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
import { monteOreAdminApi } from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { dayjs, formatDate } from '@/lib/date';
import { sortRoomsForBuilding } from '@/lib/sortRooms';
import { bookingsToBlocks } from '@/lib/weeklyBlocks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookingListItem } from '@/components/bookings/BookingListItem';
import { BookingFormDialog } from '@/components/bookings/BookingFormDialog';
import { CancelBookingDialog } from '@/components/bookings/CancelBookingDialog';
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
  // Edit booking dialog target — admin può modificare qualsiasi prenotazione,
  // proprietario può modificare solo la propria. Apriamo il BookingFormDialog
  // in edit mode passando l'oggetto Booking come prop.
  const [editTarget, setEditTarget] = useState<Booking | null>(null);

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

  // All bookings (any user) for the selected calendar day — populates the
  // daily timetable. Range: 00:00 → 23:59 del giorno selezionato.
  const calendarBookingsQuery = useQuery({
    queryKey: ['bookings', 'day', dayStart],
    queryFn: () =>
      bookingsApi.list({
        from: dayjs(dayStart).startOf('day').toISOString(),
        to: dayjs(dayStart).endOf('day').toISOString(),
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
    }
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
        b.room?.requireCheckIn !== false &&
        !b.checkedInAt &&
        dayjs(b.startTime).isAfter(earliest) &&
        dayjs(b.startTime).isBefore(latest),
    );
  }, [upcomingQuery.data]);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <StatTileCard key={s.label} tile={s} delay={0.05 + i * 0.04} />
        ))}
      </div>

      {/* Calendar / Timetable giornaliero per edificio selezionato */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="font-display text-xl">{t('dashboard.calendar_title')}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.calendar_help')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              title={t('dashboard.prev_day')}
              onClick={() => {
                setDayStart(dayjs(dayStart).subtract(1, 'day').format('YYYY-MM-DD'));
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
                setDayStart(dayjs(dayStart).add(1, 'day').format('YYYY-MM-DD'));
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
            {dayjs(dayStart).format('dddd D MMMM YYYY')}
          </p>

          {roomsQuery.isLoading || calendarBookingsQuery.isLoading ? (
            <Skeleton className="h-[520px] w-full" />
          ) : (
            <WeeklyRoomTimetable
              weekStart={dayStart}
              daysCount={1}
              rooms={calendarRooms}
              blocks={weeklyBlocks.filter((blk) => calendarRooms.some((r) => r.id === blk.roomId))}
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

      {/* Upcoming */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-display text-xl">
            {t('dashboard.next_bookings.title')}
          </CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/my-bookings">
              {t('dashboard.next_bookings.see_all')}
              <ArrowRight className="h-3.5 w-3.5 text-primary" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {upcomingQuery.isLoading && (
            <>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </>
          )}
          {!upcomingQuery.isLoading && upcoming.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <CalendarCheck2 className="h-10 w-10 text-blue-500" />
              <div>
                <p className="font-medium">{t('dashboard.no_bookings_yet')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.no_bookings_yet_subtitle')}
                </p>
              </div>
              <Button
                onClick={() => {
                  setCreateState({ open: true });
                }}
              >
                <CalendarPlus className="h-4 w-4" />
                {t('my_bookings.empty.create')}
              </Button>
            </div>
          )}
          {upcoming.map((b) => (
            <BookingListItem
              key={b.id}
              booking={b}
              onCancel={(book) => {
                setCancelTarget(book);
              }}
            />
          ))}
        </CardContent>
      </Card>

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
      <CardContent className="flex items-start gap-3 p-5">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tile.tone}`}
        >
          <tile.icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{tile.label}</p>
          <p className="font-display text-2xl font-medium">{tile.value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{tile.hint}</p>
        </div>
        {tile.to && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
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
          className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {card}
        </Link>
      ) : (
        card
      )}
    </motion.div>
  );
}
