'use strict';

// =============================================================================
// State machine helper su ChatSession.
//
// La sessione è ephemeral: scade dopo SESSION_TTL_MIN (default 15 min).
// Ogni intent può essere "one-shot" (es. /list) o "wizard multi-step" (es.
// /book che chiede room → datetime → confirm).
//
// API:
//   loadOrCreate({channel, externalId, userId}) → ChatSession
//   persist(session, { state, slots }) → aggiorna in DB
//   reset(session) → svuota state/slots, expiresAt = null
// =============================================================================

const { ChatSession } = require('../../models');

const SESSION_TTL_MIN = Number(process.env.MESSAGING_SESSION_TTL_MIN) || 15;

async function loadOrCreate({ channel, externalId, userId }) {
  let session = await ChatSession.findOne({ where: { channel, externalId } });
  if (session) {
    // Se userId era null e ora il binding ha valore, allinea
    if (!session.userId && userId) {
      session.userId = userId;
      await session.save();
    }
    // Se la sessione è scaduta, resetta state/slots
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
      session.state = null;
      session.slots = null;
      session.expiresAt = null;
      await session.save();
    }
    return session;
  }
  return ChatSession.create({
    channel,
    externalId,
    userId: userId ?? null,
    state: null,
    slots: null,
    expiresAt: null,
  });
}

async function persist(session, patch) {
  if (patch.state !== undefined) session.state = patch.state;
  if (patch.slots !== undefined) session.slots = patch.slots;
  // Se siamo dentro un wizard, prolunghiamo la scadenza.
  if (session.state) {
    session.expiresAt = new Date(Date.now() + SESSION_TTL_MIN * 60_000);
  } else {
    session.expiresAt = null;
  }
  await session.save();
}

async function reset(session) {
  session.state = null;
  session.slots = null;
  session.expiresAt = null;
  await session.save();
}

module.exports = { loadOrCreate, persist, reset, SESSION_TTL_MIN };
