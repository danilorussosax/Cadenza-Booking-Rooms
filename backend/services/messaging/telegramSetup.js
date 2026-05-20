'use strict';

// =============================================================================
// services/messaging/telegramSetup — auto-configurazione del bot Telegram.
//
// Dato il `botToken` e l'URL pubblico di Cadenza (`FRONTEND_URL`), automatizza
// le 4 chiamate Telegram Bot API che altrimenti l'admin dovrebbe fare a mano
// con curl + @BotFather:
//
//   1. getMe                  → verifica token + recupera username del bot
//   2. setWebhook             → registra l'URL del webhook + secret token
//   3. setMyCommands          → lista comandi visibile in Telegram (/help, /book, …)
//   4. setMyDescription       → descrizione lunga del bot
//   5. setMyShortDescription  → descrizione breve del bot
//   6. setMyName              → nome del bot (opzionale, può essere già OK)
//   7. getWebhookInfo         → conferma finale che il webhook è attivo
//
// Le chiamate sono **idempotenti**: ri-eseguire l'auto-configure non rompe
// nulla, semplicemente ri-imposta gli stessi valori.
//
// Flusso autoconfigure: POST /api/admin/messaging/configure dalla UI.
// =============================================================================

const TELEGRAM_API = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;

/**
 * Comandi del bot Cadenza (vedi services/messaging/intent.js).
 * Telegram limita a 32 caratteri il `command` e 256 la `description`.
 * Le descrizioni qui sono in italiano: per l'i18n vero servirà un set per
 * lingua + un loop sul language_code.
 */
const BOT_COMMANDS = [
  { command: 'help', description: 'Guida ai comandi del bot' },
  { command: 'aule', description: 'Elenco aule prenotabili (nome + codice)' },
  { command: 'agenda', description: 'Chi prenota cosa nel giorno (default: oggi)' },
  { command: 'libere', description: 'Cerca aule libere (filtri: @sede, data, ora)' },
  { command: 'book', description: 'Prenota un’aula (wizard guidato)' },
  { command: 'list', description: 'Le tue prossime prenotazioni' },
  { command: 'cancel', description: 'Annulla una prenotazione' },
  { command: 'check', description: 'Slot liberi di una specifica aula in un giorno' },
];

const BOT_DESCRIPTION =
  'Cadenza — prenota le aule del Conservatorio dal tuo Telegram. ' +
  'Comandi disponibili: /help · /book · /list · /cancel · /check · /libere. ' +
  'Per attivare il bot, fai login su Cadenza, vai sul tuo profilo e ' +
  'genera il codice di binding.';

const BOT_SHORT_DESCRIPTION = 'Prenota le aule del Conservatorio direttamente da Telegram.';

/** Helper: chiamata POST a Telegram Bot API con timeout e parsing standard. */
async function callTelegram(token, method, payload) {
  if (!token || typeof token !== 'string') {
    throw new Error('telegramSetup: token mancante');
  }
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`telegramSetup ${method}: timeout dopo ${TIMEOUT_MS}ms`, { cause: err });
    }
    throw new Error(`telegramSetup ${method}: ${err.message}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`telegramSetup ${method}: risposta non JSON (HTTP ${res.status})`);
  }
  if (!res.ok || !json.ok) {
    const description = json?.description || `HTTP ${res.status}`;
    throw new Error(`telegramSetup ${method}: ${description}`);
  }
  return json.result;
}

/** Verifica che `url` sia HTTPS pubblico (Telegram rifiuta http e localhost). */
function assertWebhookUrlValid(url) {
  if (typeof url !== 'string' || !url) {
    throw new Error('FRONTEND_URL non impostato: impossibile costruire l’URL del webhook');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`FRONTEND_URL non è un URL valido: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Telegram accetta solo webhook HTTPS — rilevato protocollo "${parsed.protocol}". ` +
        `Configura FRONTEND_URL con uno schema https:// (anche dietro reverse proxy).`,
    );
  }
  if (/^localhost$|^127\.|^::1$|\.local$/.test(parsed.hostname) || parsed.hostname === '0.0.0.0') {
    throw new Error(
      `Telegram rifiuta webhook su host locale (rilevato "${parsed.hostname}"). ` +
        `Per testare in dev usa un tunnel pubblico (ngrok / cloudflared) e impostalo come FRONTEND_URL.`,
    );
  }
}

/** Costruisce l'URL completo del webhook a partire dal base FRONTEND_URL. */
function buildWebhookUrl(frontendUrl) {
  const trimmed = String(frontendUrl || '').replace(/\/+$/, '');
  return `${trimmed}/api/messaging/telegram/webhook`;
}

/**
 * Esegue l'intera procedura di auto-configurazione.
 *
 * @param {Object} opts
 * @param {string} opts.botToken      Token ricevuto da @BotFather
 * @param {string} opts.webhookSecret Secret per `secret_token` (32 byte hex consigliati)
 * @param {string} opts.frontendUrl   Es. "https://cadenza.example.it"
 * @param {string} [opts.botName]     Nome del bot (default "Cadenza Conservatorio")
 *
 * @returns {Promise<Object>} Esito strutturato — ogni step ha `ok` + dati
 */
async function autoConfigure({ botToken, webhookSecret, frontendUrl, botName }) {
  if (!botToken) throw new Error('botToken mancante');
  if (!webhookSecret || webhookSecret.length < 8) {
    throw new Error('webhookSecret mancante o troppo corto (min 8 caratteri)');
  }
  assertWebhookUrlValid(frontendUrl);
  const webhookUrl = buildWebhookUrl(frontendUrl);

  const result = {
    webhookUrl,
    steps: {},
    bot: null,
    warnings: [],
  };

  // Step 1 — getMe (test token)
  const me = await callTelegram(botToken, 'getMe');
  result.bot = {
    id: me.id,
    username: me.username,
    firstName: me.first_name,
    canJoinGroups: me.can_join_groups ?? null,
  };
  result.steps.getMe = { ok: true };

  // Step 2 — setWebhook (idempotente)
  await callTelegram(botToken, 'setWebhook', {
    url: webhookUrl,
    secret_token: webhookSecret,
    // Riduciamo i tipi di update a quelli che davvero processiamo: un message
    // o una sua edit (il bot accetta solo testo). channel_post è già nel parser
    // ma resta low-priority; lo includiamo per coerenza.
    allowed_updates: ['message', 'edited_message', 'channel_post'],
    // drop_pending_updates: pulizia coda residua dopo cambio dominio.
    drop_pending_updates: true,
  });
  result.steps.setWebhook = { ok: true };

  // Step 3 — setMyCommands (visibili nel menu di Telegram)
  await callTelegram(botToken, 'setMyCommands', { commands: BOT_COMMANDS });
  result.steps.setMyCommands = { ok: true, count: BOT_COMMANDS.length };

  // Step 4 — setMyDescription (testo lungo, mostrato nel "Chi è" del bot)
  // Best-effort: errori non bloccanti (Telegram talvolta rate-limita questa).
  try {
    await callTelegram(botToken, 'setMyDescription', { description: BOT_DESCRIPTION });
    result.steps.setMyDescription = { ok: true };
  } catch (err) {
    result.steps.setMyDescription = { ok: false, error: err.message };
    result.warnings.push(`setMyDescription: ${err.message}`);
  }

  // Step 5 — setMyShortDescription (testo breve, mostrato nei link al bot)
  try {
    await callTelegram(botToken, 'setMyShortDescription', {
      short_description: BOT_SHORT_DESCRIPTION,
    });
    result.steps.setMyShortDescription = { ok: true };
  } catch (err) {
    result.steps.setMyShortDescription = { ok: false, error: err.message };
    result.warnings.push(`setMyShortDescription: ${err.message}`);
  }

  // Step 6 — setMyName (best-effort: non sempre permesso, vedi rate limit BotFather)
  if (botName && typeof botName === 'string' && botName.trim()) {
    try {
      await callTelegram(botToken, 'setMyName', { name: botName.trim().slice(0, 64) });
      result.steps.setMyName = { ok: true, name: botName.trim().slice(0, 64) };
    } catch (err) {
      result.steps.setMyName = { ok: false, error: err.message };
      result.warnings.push(`setMyName: ${err.message}`);
    }
  }

  // Step 7 — getWebhookInfo (conferma finale)
  const info = await callTelegram(botToken, 'getWebhookInfo');
  const matches = info?.url === webhookUrl;
  result.steps.getWebhookInfo = {
    ok: matches,
    url: info?.url,
    pendingUpdateCount: info?.pending_update_count ?? 0,
    lastErrorMessage: info?.last_error_message ?? null,
    lastErrorDate: info?.last_error_date ?? null,
    expectedUrl: webhookUrl,
  };
  if (!matches) {
    result.warnings.push(
      `Webhook registrato su "${info?.url || '(vuoto)'}" diverso dall’atteso "${webhookUrl}". ` +
        'Probabile race condition: riprova.',
    );
  }
  if (info?.last_error_message) {
    result.warnings.push(`Telegram segnala un ultimo errore: ${info.last_error_message}`);
  }

  return result;
}

module.exports = {
  autoConfigure,
  buildWebhookUrl,
  assertWebhookUrlValid,
  BOT_COMMANDS,
  BOT_DESCRIPTION,
  BOT_SHORT_DESCRIPTION,
};
