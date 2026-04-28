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

const SUPPORTED_CHANNELS = ['telegram', 'whatsapp_cloud', 'signal_cli', 'email_imap'];

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
 *  oppure null se nessuna risposta. */
async function handleIncoming(incoming, config) {
  const { channel, externalId, text } = incoming;
  if (!text) return null;

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
      const reply = knownUser
        ? `Ciao ${knownUser.firstName}, prima di poter prenotare devi collegare il bot al tuo account.\n\n👉 Vai su Aula Book → Profilo → Bot messaging, clicca "Genera codice" e inviamelo qui scrivendo:\n   bind XXXXXX`
        : `Numero non riconosciuto. Per usare questo bot devi avere un account su Aula Book con il tuo numero registrato. Contatta la segreteria per assistenza.\n\nSe sei già registrato: Aula Book → Profilo → Bot messaging → Genera codice → invialo qui (bind XXXXXX).`;
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
      const reply = `Codice non valido o scaduto. Genera un nuovo codice da Aula Book → Profilo → Bot messaging.`;
      auditChatMessage({
        direction: 'out',
        channel,
        externalId,
        userId: null,
        payload: { text: reply, reason: 'bad_otp' },
      });
      return { reply };
    }
    // Crea il binding
    binding = await BotBinding.create({
      channel,
      externalId,
      userId: result.userId,
      boundAt: new Date(),
      lastSeenAt: new Date(),
    });
    const user = await User.findByPk(result.userId);
    const reply = `✅ Collegamento completato! Ciao ${user?.firstName || ''}.\n\nComandi disponibili:\n• /book — prenota un'aula\n• /list — le mie prenotazioni\n• /cancel — annulla\n• /help — guida completa`;
    auditChatMessage({
      direction: 'out',
      channel,
      externalId,
      userId: result.userId,
      payload: { text: reply, reason: 'bound' },
    });
    return { reply };
  }

  // 5) Aggiorna lastSeen
  binding.lastSeenAt = new Date();
  await binding.save();

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
 *  Naturalmente lento (scan tabella utenti) ma lo spazio dei pending è
 *  piccolo (UN binding pending alla volta per utente, scadenza 10 min). */
async function consumeBindingOtp(otp) {
  // Scan utenti con challenge non null. Limitiamo per sicurezza.
  const candidates = await User.findAll({
    where: {
      /* botBindingChallenge: { [Op.ne]: null } — usiamo filter applicativo */
    },
    attributes: ['id', 'botBindingChallenge'],
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

/** Lookup utente per numero di telefono (msisdn). Per i canali phone-based.
 *  Cerca in `User.matricola` come placeholder se non c'è un campo dedicato.
 *  In una versione futura: aggiungere `User.phone` UNIQUE. */
async function findUserByPhone(/* phone */) {
  // TODO: quando User avrà un campo phone, fare la lookup qui.
  // Per ora ritorna null così il messaggio di rifiuto è generico.
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
