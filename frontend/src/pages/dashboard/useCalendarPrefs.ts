import { useEffect, useMemo, useState } from 'react';
import { dayjs } from '@/lib/date';

export type CalendarRange = 'single' | 'three';

const STORAGE_KEY = 'cadenza:dashboard-calendar-range';

/**
 * Stato del calendario in dashboard: giorno mostrato (YYYY-MM-DD, inizializzato
 * a oggi) e vista singolo giorno / 3 giorni, persistita in localStorage per
 * coerenza fra sessioni.
 */
export function useCalendarPrefs() {
  const [dayStart, setDayStart] = useState<string>(() => dayjs().format('YYYY-MM-DD'));
  const [calendarRange, setCalendarRange] = useState<CalendarRange>(() => {
    if (typeof window === 'undefined') return 'single';
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'three' ? 'three' : 'single';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, calendarRange);
  }, [calendarRange]);
  const calendarDaysCount = calendarRange === 'three' ? 3 : 1;
  // Inizio della settimana ISO che contiene `dayStart` — usato dal PDF di
  // export settimanale (che resta su scala settimanale, indipendente dalla
  // vista in-dashboard).
  const weekStart = useMemo(
    () => dayjs(dayStart).startOf('isoWeek').format('YYYY-MM-DD'),
    [dayStart],
  );
  return { dayStart, setDayStart, calendarRange, setCalendarRange, calendarDaysCount, weekStart };
}
