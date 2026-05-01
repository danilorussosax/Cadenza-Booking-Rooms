import { useQuery } from '@tanstack/react-query';
import { institutesApi } from '@/api/institutes';

/**
 * Restituisce l'URL dell'icona app correntemente in uso.
 *
 * Persistenza server-side: l'icona è un campo `appIconUrl` su `Institute`,
 * scritto solo da admin via PUT `/api/structure/institutes/:id`. Il valore
 * viene letto da tutti gli utenti via l'endpoint pubblico
 * `/api/structure/institutes/public` (cache 5 min via React Query) e si
 * propaga automaticamente: la scelta dell'admin diventa visibile a chiunque
 * apra/ricarichi l'app, login compreso.
 *
 * Default (`appIconUrl = NULL` o errore di rete): `/cadenza.png`.
 */

const DEFAULT_ICON = '/cadenza.png';

export function useAppIcon(): string {
  const { data } = useQuery({
    queryKey: ['institute', 'public'],
    queryFn: () => institutesApi.public(),
    staleTime: 5 * 60 * 1000,
  });
  const url = data?.institute?.appIconUrl;
  return url && url.trim().length > 0 ? url : DEFAULT_ICON;
}
