import { useEffect } from 'react';
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
 * Default (`appIconUrl = NULL` o errore di rete): `/logo3.png`.
 *
 * Side-effect: come parte della stessa risoluzione, aggiorna anche
 * `<link rel="icon">` e `<link rel="apple-touch-icon">` nel <head> in
 * modo che la tab del browser, i bookmark e l'icona "aggiungi a home"
 * iOS riflettano la scelta dell'admin senza richiedere un rebuild.
 * L'`<link>` in index.html resta come fallback per il primo paint
 * pre-React; viene sovrascritto qui non appena la query risolve.
 *
 * NB: questo NON aggiorna il manifest.webmanifest (icon-192/512 per la PWA
 * installata come app standalone). Quel set è letto dal browser una sola
 * volta in fase di install e richiede un manifest dinamico per cambiare —
 * out of scope qui.
 */

const DEFAULT_ICON = '/logo3.png';

export function useAppIcon(): string {
  const { data } = useQuery({
    queryKey: ['institute', 'public'],
    queryFn: () => institutesApi.public(),
    staleTime: 5 * 60 * 1000,
  });
  const url = data?.institute?.appIconUrl;
  // Whitelist schema: solo path relativo o http(s). Un valore tipo `data:` o
  // `javascript:` salvato lato server non deve finire nel <link rel="icon">.
  const trimmed = url?.trim() ?? '';
  const icon = /^(https?:\/\/|\/)/.test(trimmed) ? trimmed : DEFAULT_ICON;

  useEffect(() => {
    syncFaviconLink('icon', icon);
    syncFaviconLink('apple-touch-icon', icon);
  }, [icon]);

  return icon;
}

// Idempotente: se l'href è già allineato, no-op (evita reflow inutili).
// `link.href` espone sempre la URL assoluta, quindi normalizziamo la
// candidata via `new URL(href, baseURI)` per il confronto.
function syncFaviconLink(rel: string, href: string) {
  if (typeof document === 'undefined') return;
  const selector = `link[rel="${rel}"]`;
  let link = document.querySelector<HTMLLinkElement>(selector);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  const target = new URL(href, document.baseURI).href;
  if (link.href !== target) {
    link.href = target;
  }
}
