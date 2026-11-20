import { dayjs } from '@/lib/date';
import { computeConnectionStatus } from '@/lib/displayRotation';

/**
 * Offline-soft: il SW fa StaleWhileRevalidate sull'agenda. Quando il backend
 * non risponde da > 2 minuti (ma abbiamo dati cached) mostriamo un banner
 * discreto. Se non c'è MAI stato un fetch riuscito, dataUpdatedAt è 0 e il
 * banner non si vede (la schermata principale già renderizza il loader).
 */
export function useDisplayConnection(input: {
  agendaError: boolean;
  statsError: boolean;
  agendaUpdatedAt: number;
}) {
  const status = computeConnectionStatus(input);
  const lastUpdateLabel = status.hasCachedAgenda
    ? dayjs(input.agendaUpdatedAt).format('HH:mm')
    : '—';
  return { ...status, lastUpdateLabel };
}
