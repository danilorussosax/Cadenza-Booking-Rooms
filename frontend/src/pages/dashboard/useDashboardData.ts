import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { bookingsApi } from '@/api/bookings';
import { loansApi } from '@/api/instruments';
import { monteOreAdminApi, monteOreApi } from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { dayjs } from '@/lib/date';
import { qk } from '@/lib/queryKeys';
import { bookingsToBlocks } from '@/lib/weeklyBlocks';
import {
  buildBuildingsWithDayBookings,
  groupRoomsByBuilding,
  selectCheckinNeeded,
} from '@/lib/dashboardData';
import { computeUsageDisplay } from './buildStats';

/**
 * Tutte le query della dashboard + i derivati (aule per edificio, prestiti,
 * prenotazioni del giorno, check-in imminenti). Query key e opzioni invariate.
 */
export function useDashboardData({
  dayStart,
  calendarDaysCount,
  isAdmin,
  isDocente,
}: {
  dayStart: string;
  calendarDaysCount: number;
  isAdmin: boolean;
  isDocente: boolean;
}) {
  const { t } = useTranslation();

  const upcomingQuery = useQuery({
    queryKey: qk.bookings.mineUpcoming(),
    queryFn: () =>
      bookingsApi.list({
        mine: true,
        from: new Date().toISOString(),
        status: 'confirmed',
      }),
  });

  const usageQuery = useQuery({
    queryKey: qk.bookings.usageMe(),
    queryFn: () => bookingsApi.myUsage(),
    staleTime: 30_000,
  });

  const roomsQuery = useQuery({
    queryKey: qk.rooms.bookable(),
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
  });

  const loansQuery = useQuery({
    queryKey: qk.loans.mine(),
    queryFn: () => loansApi.mine(),
    staleTime: 30_000,
  });

  // Prenotazioni dell'utente in attesa di approvazione admin: empty-silent.
  const pendingApprovalsQuery = useQuery({
    queryKey: qk.bookings.minePending(),
    queryFn: () => bookingsApi.minePending(),
    staleTime: 30_000,
  });

  // Per docenti con override Monte Ore individuale (contratto orario,
  // supplenti, part-time): la quota settimanale di booking è poco
  // significativa rispetto al monte ore annuale contrattuale. Sostituiamo
  // il tile "Ore residue settimanali" con "Monte Ore: pianificate/soglia".
  // Solo per role=docente; se non c'è override torna 'institute_settings'
  // o 'default' e usiamo il flusso standard.
  const monteOreThresholdQuery = useQuery({
    queryKey: qk.monteOre.meThreshold(),
    queryFn: () => monteOreApi.getMyThreshold(),
    enabled: isDocente,
    staleTime: 60_000,
  });
  const hasMonteOreOverride = monteOreThresholdQuery.data?.source === 'user_override';
  const monteOreProposalQuery = useQuery({
    queryKey: qk.monteOre.me(),
    queryFn: () => monteOreApi.getMine(),
    enabled: isDocente && hasMonteOreOverride,
    staleTime: 60_000,
  });

  // Solo per admin: conteggio code di approvazione (prenotazioni standard +
  // variazioni monte ore) per le card della dashboard. Polling 60s coerente
  // col badge della sidebar.
  const adminBookingsPendingQuery = useQuery({
    queryKey: qk.adminBookings.pendingCount(),
    queryFn: () => bookingsApi.pendingCount(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: isAdmin,
  });
  const adminAmendmentsPendingQuery = useQuery({
    queryKey: qk.adminMonteOre.amendmentsPendingCount(),
    queryFn: () => monteOreAdminApi.pendingAmendmentsCount(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: isAdmin,
  });

  // All bookings (any user) per la finestra del calendario selezionata.
  // Range: 00:00 del primo giorno → 23:59 dell'ultimo giorno della finestra
  // (1 giorno per `calendarRange='single'`, 3 giorni per `calendarRange='three'`).
  const calendarBookingsQuery = useQuery({
    queryKey: qk.bookings.day(dayStart, calendarDaysCount),
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
  const next = upcoming.at(0);

  const allLoans = useMemo(() => loansQuery.data?.loans ?? [], [loansQuery.data]);
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
  const usageDisplay = useMemo(() => computeUsageDisplay(usage, t), [usage, t]);

  // Group rooms by building
  const buildingsMap = useMemo(
    () => groupRoomsByBuilding(roomsQuery.data?.rooms ?? []),
    [roomsQuery.data],
  );
  const buildings = useMemo(() => Array.from(buildingsMap.values()), [buildingsMap]);

  // Default tab = first building once loaded
  const [buildingTab, setBuildingTab] = useState<string>('');
  useEffect(() => {
    if (!buildingTab && buildings.length > 0) setBuildingTab(String(buildings[0].id));
  }, [buildings, buildingTab]);

  const selectedBuilding = buildingsMap.get(Number(buildingTab));
  const calendarRooms = useMemo(() => selectedBuilding?.rooms ?? [], [selectedBuilding]);

  // Blocchi della weekly view (per la sola tab edificio selezionata).
  const weeklyBlocks = useMemo(
    () => bookingsToBlocks(calendarBookingsQuery.data?.bookings ?? []),
    [calendarBookingsQuery.data],
  );

  // Mobile-only: edifici → aule → prenotazioni del giorno, struttura
  // gerarchica per il disclosure annidato. Solo single-day, niente range three.
  const buildingsWithDayBookings = useMemo(
    () =>
      buildBuildingsWithDayBookings(
        buildings,
        calendarBookingsQuery.data?.bookings ?? [],
        dayStart,
      ),
    [buildings, calendarBookingsQuery.data, dayStart],
  );

  // Booking imminenti che richiedono check-in (vedi lib/checkInPolicy).
  const checkinNeeded = useMemo(
    () =>
      selectCheckinNeeded(
        upcomingQuery.data?.bookings ?? [],
        upcomingQuery.data?.checkInConfig,
        Date.now(),
      ),
    [upcomingQuery.data],
  );

  return {
    upcomingQuery,
    usageQuery,
    roomsQuery,
    pendingApprovalsQuery,
    monteOreThresholdQuery,
    monteOreProposalQuery,
    hasMonteOreOverride,
    adminBookingsPendingQuery,
    adminAmendmentsPendingQuery,
    calendarBookingsQuery,
    next,
    activeLoans,
    pendingLoans,
    showLoansCard,
    dashboardLoans,
    usageDisplay,
    buildings,
    buildingTab,
    setBuildingTab,
    calendarRooms,
    weeklyBlocks,
    buildingsWithDayBookings,
    checkinNeeded,
  };
}
