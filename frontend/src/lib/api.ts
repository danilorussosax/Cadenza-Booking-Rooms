import i18n from 'i18next';
import type { ApiError } from '@/types';

const TOKEN_KEY = 'conservatory_token';
const USER_KEY = 'conservatory_user';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export const userCache = {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get: <T>() => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  set: (user: unknown) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
};

export class HttpError extends Error {
  status: number;
  payload: ApiError;

  constructor(status: number, payload: ApiError) {
    super(payload.error || `Errore HTTP ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, unknown>;
  auth?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        url.searchParams.set(k, String(v));
      }
    }
  }
  // strip origin so the dev proxy still works
  return url.pathname + (url.search ? url.search : '');
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, query, auth = true, headers, ...rest } = opts;
  const finalHeaders = new Headers(headers);

  if (body !== undefined && !(body instanceof FormData)) {
    finalHeaders.set('Content-Type', 'application/json');
  }
  if (auth) {
    const token = tokenStore.get();
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(buildUrl(path, query), {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const payload: ApiError = (data as ApiError) ?? { error: `Errore HTTP ${res.status}` };
    if (res.status === 401 && auth) {
      // Token assente, scaduto o revocato server-side (TOKEN_REVOKED).
      // Pulisci lo stato locale e segnala via evento custom: AuthProvider
      // ascolta l'evento e si occupa di forzare l'unmount + redirect a /login.
      // Solo se la richiesta era autenticata (auth=true): le call pubbliche
      // 401 — improbabili — non devono triggerare il logout globale.
      tokenStore.clear();
      window.dispatchEvent(new CustomEvent('auth:expired', { detail: { code: payload.code } }));
    }
    throw new HttpError(res.status, payload);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Codici "generici" la cui traduzione i18n è un titolo riassuntivo: per questi
 * preferiamo SEMPRE il messaggio specifico del backend (`payload.issues` o
 * `payload.error`), così l'utente vede il motivo reale invece di un'etichetta
 * vaga tipo "Prenotazione non valida".
 *
 * Esempio: il validator booking ritorna code='BOOKING_INVALID' con
 *   error='Durata massima prenotazione: 120 minuti'
 *   issues=['Durata massima prenotazione: 120 minuti']
 * Senza questa lista il dialog mostrava solo la traduzione "Prenotazione non
 * valida" — informazione zero per lo studente.
 */
const GENERIC_CODES_WITH_DETAILS = new Set(['BOOKING_INVALID', 'VALIDATION_FAILED']);

/**
 * Risolve un errore HTTP in una stringa localizzata.
 * Strategia:
 *   1) se il `code` è "generico con dettagli" (es. BOOKING_INVALID), prima
 *      tenta `issues[]` poi `payload.error` (entrambi specifici e già
 *      localizzati lato server);
 *   2) se il backend ha restituito un `code` univoco (es. 'BOOKING_CONFLICT'),
 *      lo si traduce via i18n (`errors.code.<CODE>`) — fallback sul testo backend
 *      se la chiave non esiste;
 *   3) altrimenti usa i `details[].message` (validation errors) o `error`;
 *   4) se non è un HttpError, ricorre al `message` o a un fallback localizzato.
 */
export const httpErrorMessage = (err: unknown): string => {
  if (err instanceof HttpError) {
    const code = err.payload.code;
    if (code && GENERIC_CODES_WITH_DETAILS.has(code)) {
      if (err.payload.issues?.length) {
        return err.payload.issues.join(' · ');
      }
      if (err.payload.error) return err.payload.error;
    }
    if (code) {
      const key = `errors.code.${code}`;
      const translated = i18n.t(key);
      if (translated && translated !== key) return translated;
    }
    if (err.payload.details?.length) {
      return err.payload.details.map((d) => d.message).join(' · ');
    }
    return err.payload.error || err.message;
  }
  if (err instanceof Error) return err.message;
  return i18n.t('errors.generic');
};
