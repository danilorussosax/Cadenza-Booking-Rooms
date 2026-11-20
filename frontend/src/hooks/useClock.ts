import { useEffect, useState } from 'react';
import { dayjs } from '@/lib/date';

/** Orologio live: si aggiorna ogni secondo. */
export function useClock() {
  const [now, setNow] = useState(() => dayjs());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(dayjs());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);
  return now;
}
