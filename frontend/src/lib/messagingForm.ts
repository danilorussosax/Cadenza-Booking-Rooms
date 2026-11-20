import {
  SECRET_PLACEHOLDER,
  type ChannelSettingsRow,
  type TelegramWebhookInfo,
} from '@/api/messaging';

/** Validazione campo lato client (specchio della validazione server). Ritorna
 *  un messaggio d'errore (chiave i18n già risolta dal chiamante) o null. */
const TELEGRAM_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
export function fieldError(
  validate: 'telegramToken' | undefined,
  value: string,
): 'invalid_token' | null {
  if (!validate) return null;
  // `validate` può solo essere 'telegramToken' qui (unico valore non-undefined).
  // Vuoto o placeholder = nessun nuovo valore → niente errore.
  if (value === '' || value === SECRET_PLACEHOLDER) return null;
  return TELEGRAM_TOKEN_RE.test(value.trim()) ? null : 'invalid_token';
}

/** Baseline credenziali dal salvato: i secret già impostati tornano a placeholder. */
export function initialCreds(
  fields: readonly { key: string }[],
  r: ChannelSettingsRow,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.key] = r.credentialsSet[f.key] ? SECRET_PLACEHOLDER : '';
  return out;
}

/** Baseline settings non-secret dal salvato. */
export function initialSettings(
  fields: readonly { key: string }[],
  r: ChannelSettingsRow,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = r.settings[f.key];
    // Solo valori scalari finiscono nei form (gli admin configurano stringhe).
    out[f.key] = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  }
  return out;
}

/** Payload credenziali: i SECRET_PLACEHOLDER restano invariati, il vuoto svuota. */
export function buildCredentialsPayload(creds: Record<string, string>): Record<string, string> {
  const credsPayload: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (v && v !== SECRET_PLACEHOLDER) credsPayload[k] = v;
    else if (v === SECRET_PLACEHOLDER) credsPayload[k] = SECRET_PLACEHOLDER;
    else credsPayload[k] = ''; // svuota
  }
  return credsPayload;
}

/** Telegram restituisce url:'' quando il webhook non è impostato → mostra '—'. */
export function displayWebhookUrl(info: Pick<TelegramWebhookInfo, 'url'>): string {
  return info.url === undefined || info.url === '' ? '—' : info.url;
}
