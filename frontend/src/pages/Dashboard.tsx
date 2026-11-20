import { useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarPlus, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/auth';
import { dayjs } from '@/lib/date';
import { greetingKeyForHour } from '@/lib/dashboardData';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { BookingFormDialog } from '@/components/bookings/BookingFormDialog';
import { CancelBookingDialog } from '@/components/bookings/CancelBookingDialog';
import { BookingInfoDialog } from '@/components/bookings/BookingInfoDialog';
import { WeeklyExportPrintView } from '@/components/bookings/WeeklyExportPrintView';
import { WaitlistDashboardCard } from '@/components/bookings/WaitlistDashboardCard';
import { QuickBookCard } from '@/components/bookings/QuickBookCard';
import type { Booking } from '@/types';
import { isAdminUser } from '@/lib/roles';
import { StatTileCard } from './dashboard/StatTileCard';
import { DashboardLoansCard } from './dashboard/LoansCard';
import { NextSessionCard } from './dashboard/NextSessionCard';
import { PendingApprovalsCard } from './dashboard/PendingApprovalsCard';
import { CheckInCard } from './dashboard/CheckInCard';
import { MobileDayCalendar } from './dashboard/MobileDayCalendar';
import { DesktopCalendarCard } from './dashboard/DesktopCalendarCard';
import { buildStats } from './dashboard/buildStats';
import { useCalendarPrefs } from './dashboard/useCalendarPrefs';
import { useDashboardData } from './dashboard/useDashboardData';

function greetingKey() {
  return greetingKeyForHour(new Date().getHours());
}

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  // Vista giornaliera: la WeeklyRoomTimetable supporta già una singola colonna
  // giorno tramite daysCount={1}, quindi riusiamo il componente con
  // `weekStart=dayStart`.
  const { dayStart, setDayStart, calendarRange, setCalendarRange, calendarDaysCount, weekStart } =
    useCalendarPrefs();
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
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const isAdmin = isAdminUser(user);
  const isDocente = user?.role === 'docente';

  const data = useDashboardData({ dayStart, calendarDaysCount, isAdmin, isDocente });
  const {
    upcomingQuery,
    usageQuery,
    roomsQuery,
    pendingApprovalsQuery,
    monteOreThresholdQuery,
    monteOreProposalQuery,
    adminBookingsPendingQuery,
    adminAmendmentsPendingQuery,
    calendarBookingsQuery,
    next,
    activeLoans,
    pendingLoans,
    showLoansCard,
    dashboardLoans,
    buildings,
    buildingTab,
    checkinNeeded,
  } = data;

  const stats = buildStats({
    t,
    isAdmin,
    isDocente,
    isDesktop,
    upcomingCount: upcomingQuery.data?.bookings.length,
    roomsCount: roomsQuery.data?.rooms.length,
    next,
    usageLoading: usageQuery.isLoading,
    usageDisplay: data.usageDisplay,
    hasMonteOreOverride: data.hasMonteOreOverride,
    monteOreThreshold: monteOreThresholdQuery.data,
    monteOrePlanned: monteOreProposalQuery.data?.proposal.totalHoursPlanned,
    monteOreLoading: monteOreProposalQuery.isLoading,
    bookingsPending: {
      loading: adminBookingsPendingQuery.isLoading,
      count: adminBookingsPendingQuery.data?.count ?? 0,
    },
    amendmentsPending: {
      loading: adminAmendmentsPendingQuery.isLoading,
      count: adminAmendmentsPendingQuery.data?.count ?? 0,
    },
    activeLoansCount: activeLoans.length,
    pendingLoansCount: pendingLoans.length,
    showLoansCard,
  });

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
    if (isAdminUser(user)) {
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
  const openNewBooking = () => {
    setCreateState({ open: true });
  };

  const today = dayjs().format('YYYY-MM-DD');
  const isToday = dayStart === today;
  const calendarLoading = roomsQuery.isLoading || calendarBookingsQuery.isLoading;
  const pendingApprovals = pendingApprovalsQuery.data?.bookings ?? [];

  // "Esporta PDF Settimanale" → l'overlay WeeklyExportPrintView è sempre
  // montato ma con display:none in screen (visibile solo via @media print, vedi
  // index.css). Il bottone richiama direttamente window.print() — l'utente
  // sceglie "Salva come PDF" dal dialog del browser.
  const handleExport = () => {
    window.print();
  };

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
        <Button size="sm" className="shrink-0" onClick={openNewBooking}>
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
        <Button size="lg" onClick={openNewBooking}>
          <CalendarPlus className="h-4 w-4" />
          {t('my_bookings.new_booking')}
        </Button>
      </motion.div>

      {/* Prossima sessione (mobile-only) — info piu' actionable in primo piano */}
      <NextSessionCard next={next} onNewBooking={openNewBooking} />

      {/* Waitlist card: visibile solo se l'utente è in coda per qualche aula */}
      <WaitlistDashboardCard />

      {/* Quick book: max 3 template "favoriti" per prenotare con 1 click la
          prossima occorrenza del giorno. Empty-silent: se l'utente non ha
          favoriti, la card non appare. */}
      <QuickBookCard />

      {/* Approvazioni in attesa: empty-silent. Visibile solo se l'utente ha
          almeno una prenotazione in stato 'pending_approval'. */}
      {pendingApprovals.length > 0 && <PendingApprovalsCard bookings={pendingApprovals} />}

      {/* Check-in card: visibile solo se ci sono booking imminenti senza check-in */}
      {checkinNeeded.length > 0 && <CheckInCard bookings={checkinNeeded} />}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s, i) => (
          <StatTileCard key={s.label} tile={s} delay={0.05 + i * 0.04} />
        ))}
      </div>

      {/* Aule e prenotazioni del giorno (mobile-only): rimpiazza il Weekly
          Timetable desktop con un'esperienza list-with-disclosure piu' adatta
          al telefono. Riusa le stesse query del calendar desktop, quindi non
          aggiunge fetch lato server. */}
      <MobileDayCalendar
        dayStart={dayStart}
        today={today}
        isToday={isToday}
        isLoading={calendarLoading}
        buildingsWithDayBookings={data.buildingsWithDayBookings}
        currentUserId={user?.id}
        onDayChange={setDayStart}
        onBookingClick={handleBookingClick}
      />

      {/* Calendar / Timetable giornaliero per edificio selezionato — desktop-only
          (< lg: troppo denso per mobile, l'utente puo' andare su /booking per il calendario aule) */}
      <DesktopCalendarCard
        dayStart={dayStart}
        today={today}
        isToday={isToday}
        isLoading={calendarLoading}
        calendarRange={calendarRange}
        calendarDaysCount={calendarDaysCount}
        buildings={buildings}
        buildingTab={buildingTab}
        calendarRooms={data.calendarRooms}
        weeklyBlocks={data.weeklyBlocks}
        currentUserId={user?.id ?? null}
        onDayChange={setDayStart}
        onRangeChange={setCalendarRange}
        onBuildingTabChange={data.setBuildingTab}
        onExport={handleExport}
        onSlotRangeSelect={handleSlotRangeSelect}
        onBlockClick={(blk) => {
          const found = calendarBookingsQuery.data?.bookings.find((b) => b.id === blk.id);
          if (found) handleBookingClick(found);
        }}
      />

      {/* Print-only overlay: una pagina A4 landscape per ogni edificio.
          Sempre montato; visibile solo in stampa (vedi src/index.css).
          Renderizziamo solo quando i dati sono pronti per evitare grid vuote. */}
      {!calendarLoading && (
        <WeeklyExportPrintView
          weekStart={weekStart}
          buildings={buildings}
          blocks={data.weeklyBlocks}
        />
      )}

      {showLoansCard && <DashboardLoansCard loans={dashboardLoans} />}

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
