import { api } from '@/lib/api';

export type ManualSlug = 'admin' | 'docente' | 'studente';

export interface ManualEntry {
  slug: ManualSlug;
  title: string;
}

export const docsApi = {
  /** Lista manuali consultabili dall'utente corrente (filtrata per ruolo). */
  list: () => api<{ manuals: ManualEntry[] }>('/api/docs'),
  /** Markdown puro del manuale. Il backend risponde text/markdown; `api` lo
   *  passa attraverso senza JSON-parse (safeJson fa fallback al testo). */
  get: (slug: ManualSlug) => api<string>(`/api/docs/${slug}`),
};

/** Path pubblico (no auth) per uno screenshot del manuale, usato in <img src>. */
export function screenshotUrl(file: string): string {
  return `/api/docs/screenshots/${file}`;
}
