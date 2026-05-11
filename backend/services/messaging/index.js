'use strict';

// =============================================================================
// services/messaging — orchestratore bot conversazionale.
//
// Compiti:
//   1. Caricare i settings del canale (DB → MessagingSettings) e l'adapter
//      corrispondente (telegram, whatsapp_cloud, signal_cli, email_imap).
//   2. Verificare la firma del webhook prima di processare il payload.
//   3. Effettuare il "preflight" sull'utente:
//      a) cercare il BotBinding per (channel, externalId)
//      b) per i canali phone-based (whatsapp/signal): se non esiste binding
//         ma il numero corrisponde a un User.matricola/email/altro, NON
//         auto-bindiamo: chiediamo OTP via /profile (sicurezza).
//      c) se il messaggio è un OTP, completiamo il binding.
//      d) altrimenti: rifiutare con messaggio standard.
//   4. Rate limit per (channel, externalId) — vedi rateLimit.js
//   5. Intent parsing → state machine → action.
//   6. Audit log di ogni messaggio in/out (target_type 'ChatMessage').
//   7. Reply via adapter.send().
//
// Tutti i bypass admin/role qui sono ESCLUSI: il bot riusa
// `services/bookingValidator.js` con lo userId del binding, quindi rispetta
// rules/quotas/approval workflow esistenti.
// =============================================================================

const { MessagingSettings, BotBinding, ChatSession, AuditLog, User } = require('../../models');
const { decrypt } = require('../../lib/crypto');
const adapters = require('./adapters');
const intent = require('./intent');
const stateMachine = require('./state');
const rateLimit = require('./rateLimit');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

// Cap difensivo sul numero di candidati con challenge attiva da scansionare
// in `consumeBindingOtp`. In condizioni normali ci sono pochi pending OTP
// (TTL 10min, 1 per utente). Il cap protegge da scenari degenerate (es.
// migrazione che lascia migliaia di challenge orfane).
const OTP_CANDIDATES_CAP = Number(process.env.MESSAGING_OTP_SCAN_CAP) || 100;

// =============================================================================
// Mutex applicativo per (channel, externalId): serializza i webhook concorrenti
// dello stesso utente, così due messaggi rapidi non corrompono la ChatSession
// (race classico last-write-wins su state/slots).
//
// In-memory: sufficiente per single-server. Per multi-istanza serve una mutex
// distribuita (Redis SETNX, advisory lock Postgres, ecc.) — ad oggi Cadenza
// gira a single instance.
// =============================================================================
const chatLocks = new Map(); // key → Promise (chain di processing in corso)

function chatLockKey(channel, externalId) {
  return `${channel}:${externalId}`;
}

/** Esegue `fn` in mutua esclusione rispetto ad altre invocazioni con la
 *  stessa chiave. Le invocazioni si serializzano in coda. */
async function withChatLock(channel, externalId, fn) {
  const key = chatLockKey(channel, externalId);
  const previous = chatLocks.get(key) || Promise.resolve();
  const next = previous
    .then(() => fn())
    .catch((err) => {
      // Lasciamo propagare ai chiamanti, ma se questa promise restasse rejected
      // bloccherebbe le chiamate future con un .then che riceve l'errore.
      // Catch + rethrow neutralizza la chain mantenendo la propagation a `fn`.
      throw err;
    });
  // La chain successiva deve attendere completion (anche su rejection),
  // quindi ricreiamo una promise che si risolve sempre.
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  chatLocks.set(key, settled);
  // Cleanup: quando la chain corrente si esaurisce, rimuovi l'entry per
  // evitare crescita infinita (lo stesso identico problema del rate limit).
  settled.finally(() => {
    if (chatLocks.get(key) === settled) chatLocks.delete(key);
  });
  return next;
}

const SUPPORTED_CHANNELS = ['telegram', 'whatsapp_cloud', 'signal_cli', 'email_imap'];

/** Strip caratteri Markdown legacy da stringhe interpolate nelle reply.
 *  Telegram con `parse_mode: 'Markdown'` risponde 400 se trova entità non
 *  bilanciate (es. firstName "Ann_a Maria"): l'invio fallisce silente nella
 *  pipeline webhook → utente vede doppia spunta senza risposta. */
function mdSafeBasic(s) {
  return String(s ?? '')
    .replace(/[*_`[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Carica settings + credenziali per un canale, decifrando il blob. Restituisce
 *  null se il canale non è configurato o disabilitato. */
async function loadChannelConfig(channel) {
  if (!SUPPORTED_CHANNELS.includes(channel)) return null;
  const row = await MessagingSettings.findOne({ where: { channel } });
  if (!row || !row.isEnabled) return null;
  let credentials = {};
  if (row.credentialsEncrypted) {
    try {
      credentials = JSON.parse(decrypt(row.credentialsEncrypted));
    } catch {
      credentials = {};
    }
  }
  return {
    channel,
    settings: row.settings || {},
    credentials,
  };
}

/** Adapter resolver: ritorna il modulo adapter per il canale, o null. */
function getAdapter(channel) {
  return adapters[channel] ?? null;
}

/** Validazione firma webhook delegata all'adapter. Ritorna boolean. */
function verifyWebhook(channel, req, config) {
  const adapter = getAdapter(channel);
  if (!adapter || typeof adapter.verifyWebhook !== 'function') return false;
  return adapter.verifyWebhook(req, config);
}

/** Audit di un singolo messaggio (in/out). Fire-and-forget: errori loggati ma
 *  non bloccano il flusso. */
function auditChatMessage({ direction, channel, externalId, userId, payload }) {
  AuditLog.create({
    actorId: userId ?? null,
    action: direction === 'in' ? 'POST' : 'PUT',
    targetType: 'ChatMessage',
    targetId: null,
    path: `/api/messaging/${channel}/${direction}`,
    statusCode: 200,
    payload: typeof payload === 'string' ? { text: payload } : payload,
    response: null,
    ip: null,
    userAgent: `bot/${channel}`,
  }).catch((err) => {
    console.error('[messaging] audit error:', err.message);
  });
}

/** Handler principale: processa un messaggio inbound già parsato dall'adapter.
 *  `incoming = { channel, externalId, text, raw }`. Ritorna { reply: string }
 *  oppure null se nessuna risposta.
 *
 *  Il lock per (channel, externalId) serializza messaggi concorrenti dello
 *  stesso utente (es. due tap rapidi su pulsanti, o edit_message): senza
 *  questo, due webhook in parallelo possono corrompere ChatSession con
 *  scritture last-write-wins su state/slots. */
async function handleIncoming(incoming, config) {
  const { channel, externalId } = incoming;
  return withChatLock(channel, externalId, () => handleIncomingInner(incoming, config));
}

async function handleIncomingInner(incoming, config) {
  const { channel, externalId, text } = incoming;
  if (!text) return null;

  // Difensiva contro payload malformati: BotBinding/ChatSession hanno una
  // colonna STRING(190) sull'externalId. Senza questo check un payload
  // anomalo (>190 char) farebbe esplodere l'INSERT con ER_DATA_TOO_LONG nel
  // mezzo della pipeline → eccezione silente → utente non riceve risposta.
  if (typeof externalId !== 'string' || externalId.length === 0 || externalId.length > 190) {
    console.error(
      `[messaging:${channel}] externalId invalido (len=${externalId?.length ?? 'n/a'}), drop.`,
    );
    return null;
  }

  // 1) Rate limit
  const rl = rateLimit.check(channel, externalId);
  if (!rl.ok) {
    return { reply: rl.message };
  }

  // 2) Audit IN
  auditChatMessage({ direction: 'in', channel, externalId, userId: null, payload: { text } });

  // 3) Cerca binding
  let binding = await BotBinding.findOne({ where: { channel, externalId } });

  // 4) Se non bindato → unico comando accettato è il completamento OTP
  //    "/bind <CODICE>" oppure "bind <CODICE>". Per i canali phone-based,
  //    aggiungiamo anche il check user-by-phone come info ma NON
  //    auto-bindiamo.
  if (!binding) {
    const otp = parseBindingOtp(text);
    if (!otp) {
      // Ricerca utente per externalId su phone-based (whatsapp/signal):
      // serve solo per personalizzare il messaggio di rifiuto, non per auto-bind.
      let knownUser = null;
      if (channel === 'whatsapp_cloud' || channel === 'signal_cli') {
        knownUser = await findUserByPhone(externalId);
      }
      const safeName = mdSafeBasic(knownUser?.firstName);
      const reply = knownUser
        ? `Ciao ${safeName}, prima di poter prenotare devi collegare il bot al tuo account.\n\n👉 Vai su Cadenza → Profilo → Bot messaging, clicca "Genera codice" e inviamelo qui scrivendo:\n   bind XXXXXX`
        : `Numero non riconosciuto. Per usare questo bot devi avere un account su Cadenza con il tuo numero registrato. Contatta la segreteria per assistenza.\n\nSe sei già registrato: Cadenza → Profilo → Bot messaging → Genera codice → invialo qui (bind XXXXXX).`;
      auditChatMessage({
        direction: 'out',
        channel,
        externalId,
        userId: null,
        payload: { text: reply, reason: 'not_bound' },
      });
      return { reply };
    }
    // Cerca challenge in tutti gli utenti (verifica hash). Se match → bind.
    const result = await consumeBindingOtp(otp);
    if (!result.ok) {
      const reply = `Codice non valido o scaduto. Genera un nuovo codice da Cadenza → Profilo → Bot messaging.`;
      auditChatMessage({
        direction: 'out',
        channel,
        externalId,
        userId: null,
        payload: { text: reply, reason: 'bad_otp' },
      });
      return { reply };
    }
    // Crea il binding — `findOrCreate` rende idempotente la double-bind:
    // se due webhook concorrenti consumano l'OTP e tentano la create insieme,
    // il secondo intercetta la riga esistente invece di sollevare
    // SequelizeUniqueConstraintError (eccezione che la pipeline silenzia
    // perché la 200 al webhook è già stata inviata → utente vedrebbe
    // doppia spunta senza risposta).
    [binding] = await BotBinding.findOrCreate({
      where: { channel, externalId },
      defaults: {
        channel,
        externalId,
        userId: result.userId,
        boundAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    // Se la riga esisteva già (anche con userId diverso, es. utente cambiato
    // tra revoca e re-bind senza eliminare la vecchia), riallinea ai dati
    // del nuovo bind.
    if (binding.userId !== result.userId) {
      binding.userId = result.userId;
      binding.boundAt = new Date();
      await binding.save();
    }
    const user = await User.findByPk(result.userId);
    const reply = `✅ Collegamento completato! Ciao ${mdSafeBasic(user?.firstName) || ''}.\n\nComandi disponibili:\n• /book — prenota un'aula\n• /list — le mie prenotazioni\n• /cancel — annulla\n• /help — guida completa`;
    auditChatMessage({
      direction: 'out',
      channel,
      externalId,
      userId: result.userId,
      payload: { text: reply, reason: 'bound' },
    });
    return { reply };
  }

  // 5) Aggiorna lastSeen — best-effort, non deve mai bloccare la pipeline.
  //    Un fallimento qui (deadlock, lock contention, DB blip) non dovrebbe
  //    impedire all'utente di ricevere la risposta al suo messaggio.
  //    Usiamo `update` invece di `save()` sull'instance per evitare
  //    optimistic locking conflicts con altre webhook concorrenti.
  try {
    await BotBinding.update({ lastSeenAt: new Date() }, { where: { id: binding.id } });
  } catch (err) {
    console.error(`[messaging:${channel}] lastSeenAt update error (non-blocking):`, err.message);
  }

  // 6) Carica/crea sessione
  const session = await stateMachine.loadOrCreate({ channel, externalId, userId: binding.userId });

  // 7) Processa intent / step
  const result = await intent.handle({
    text,
    user: await User.findByPk(binding.userId),
    session,
    channel,
  });
  if (result.session) {
    await stateMachine.persist(session, result.session);
  }

  // 8) Audit OUT
  if (result.reply) {
    auditChatMessage({
      direction: 'out',
      channel,
      externalId,
      userId: binding.userId,
      payload: { text: result.reply, intent: result.intent },
    });
  }
  return { reply: result.reply || null };
}

// =============================================================================
// Helpers binding
// =============================================================================

/** Estrae OTP da un messaggio "bind XXXXXX" / "/bind XXXXXX". Case insensitive.
 *  Ritorna la stringa OTP o null. */
function parseBindingOtp(text) {
  const m = String(text)
    .trim()
    .match(/^\/?bind\s+([A-Za-z0-9]{6,16})\s*$/i);
  return m ? m[1].toUpperCase() : null;
}

/** Cerca un utente con `botBindingChallenge` valido che matcha l'OTP fornito.
 *  Filtra a livello DB (botBindingChallenge IS NOT NULL) per evitare di
 *  scaricare tutti gli utenti ad ogni messaggio "bind" (DoS amplifier),
 *  e applica un cap difensivo sul numero di candidati da scansionare. */
async function consumeBindingOtp(otp) {
  const candidates = await User.findAll({
    where: { botBindingChallenge: { [Op.ne]: null } },
    attributes: ['id', 'botBindingChallenge'],
    // Ordina per id desc così, in caso di overflow del cap, prendiamo le
    // challenge più recenti (più probabili di essere quelle attive).
    order: [['id', 'DESC']],
    limit: OTP_CANDIDATES_CAP,
  });
  const now = Date.now();
  const candidateUsers = candidates.filter((u) => {
    const c = u.botBindingChallenge;
    if (!c || typeof c !== 'object') return false;
    if (!c.expiresAt || new Date(c.expiresAt).getTime() < now) return false;
    return true;
  });
  for (const u of candidateUsers) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await bcrypt.compare(otp, u.botBindingChallenge.tokenHash);
    if (ok) {
      // Consuma la challenge.
      const fresh = await User.findByPk(u.id);
      fresh.botBindingChallenge = null;
      await fresh.save();
      return { ok: true, userId: u.id };
    }
  }
  return { ok: false };
}

/**
 * Lookup utente per numero di telefono (msisdn) per i canali phone-based
 * (WhatsApp / Signal). Attualmente è uno **stub deliberato**: ritorna sempre
 * `null` così l'utente sconosciuto riceve il messaggio di rifiuto generico
 * gestito in `handleIncoming` (riga ~205) — è il comportamento corretto finché
 * il bot opera in modalità "bind via OTP" e non per numero.
 *
 * Per abilitare il lookup per numero in futuro: aggiungere `User.phone`
 * UNIQUE NULL al modello, popolarlo via profilo utente o import Isidata, e
 * implementare qui `User.findOne({ where: { phone } })`. Niente fallback su
 * `matricola` — i due campi hanno semantica diversa.
 */
async function findUserByPhone(/* phone */) {
  return null;
}

module.exports = {
  SUPPORTED_CHANNELS,
  loadChannelConfig,
  getAdapter,
  verifyWebhook,
  handleIncoming,
  auditChatMessage,
};
