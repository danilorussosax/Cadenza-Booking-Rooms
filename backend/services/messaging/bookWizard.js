'use strict';

// =============================================================================
// Intent: book_room — wizard a 5 step (macchina a stati).
//
// Step 1 — book_room.building : sede (skip se 1 sola sede attiva)
// Step 2 — book_room.room     : aula (filtrata sulla sede scelta)
// Step 3 — book_room.when     : data + range orario
// Step 4 — book_room.type     : tipo attività (studio_individuale, lezione, …)
//                               (skip se 1 sola opzione attiva o già passata)
// Step 5 — book_room.confirm  : conferma SI/NO
//
// Se l'utente passa già aula/data/ora/tipo nel comando iniziale
// (`/book <codice> ven 14-15 lezione`), saltiamo gli step già coperti.
//
// Seam: le transizioni (`start`, `step`, `advance`) dipendono dal DB solo
// tramite `deps` (listActiveBuildings, findRoomByQuery, listActiveBookingTypes,
// finalize), iniettabili nei test. I default puntano a catalog.js e a
// `finalizeBook` (che chiama bookingLifecycle.book).
// =============================================================================

const { book } = require('../bookingLifecycle');
const { Room, Building } = require('../../models');
const { parseDayQuery, parseTimeRange, rangeToInstants } = require('./dateTimeParser');
const { mdSafe, formatSlot } = require('./telegramText');
const catalog = require('./catalog');

const WIZARD_STATES = [
  'book_room.building',
  'book_room.room',
  'book_room.when',
  'book_room.type',
  'book_room.confirm',
];

function isWizardState(state) {
  return WIZARD_STATES.includes(state);
}

const RESET = { state: null, slots: null };

async function finalizeBook({ slots, session }) {
  const { User } = require('../../models');
  const user = await User.findByPk(session.userId);
  if (!user) {
    return { reply: '❌ Utente non trovato.', session: RESET };
  }
  let booking;
  try {
    ({ booking } = await book({
      actor: user,
      roomId: slots.roomId,
      startTime: new Date(slots.startTime),
      endTime: new Date(slots.endTime),
      type: slots.type || 'studio_individuale',
      purpose: 'Prenotazione via bot',
      // Il bot non invia la mail di conferma all'utente (risponde in chat),
      // notifica solo gli admin se la richiesta e' pending_approval.
      notifyOwner: false,
      // Ricarica utente e aula DENTRO la transazione (stato attuale dell'account).
      before: async (transaction) => {
        const fresh = await User.findByPk(user.id, { transaction });
        if (!fresh?.isActive || (fresh.role !== 'admin' && fresh.status !== 'approved'))
          throw new Error('Account non disponibile');
        const room = await Room.findByPk(slots.roomId, {
          include: [{ model: Building, as: 'building' }],
          transaction,
        });
        if (!room?.isBookable || !room.building) throw new Error('Aula non disponibile');
        return { owner: fresh, room };
      },
    }));
  } catch (err) {
    const detail = err.issues?.length ? err.issues.join('; ') : err.message;
    return {
      reply: `❌ Prenotazione non valida: ${mdSafe(detail)}.`,
      session: RESET,
    };
  }
  const summary =
    `• 🏛 ${mdSafe(slots.buildingName)}\n` +
    `• 🚪 *${mdSafe(slots.roomName)}*\n` +
    `• 📅 ${formatSlot(slots.startTime, slots.endTime)}\n` +
    `• 🎯 ${mdSafe(slots.typeLabel || slots.type)}`;
  const reply =
    booking.status === 'pending_approval'
      ? `⏳ Richiesta inviata (#${booking.id}). La direzione approva entro 24h, riceverai un messaggio.\n\n${summary}`
      : `✅ Prenotazione confermata (#${booking.id})!\n\n${summary}`;
  return { reply, intent: 'book_room', session: RESET };
}

const defaultDeps = {
  listActiveBuildings: catalog.listActiveBuildings,
  findRoomByQuery: catalog.findRoomByQuery,
  listActiveBookingTypes: catalog.listActiveBookingTypes,
  finalize: finalizeBook,
};

/** Avvio da `/book [aula] [data] [ora] [tipo…]`: pre-compila gli slot. */
function start({ args, session }, deps = defaultDeps) {
  const slots = {};
  // "/book <codice> ven 14-15 lezione" → tokens [codice, "ven", "14-15", "lezione"]
  if (args) {
    const tokens = args.split(/\s+/);
    if (tokens.length >= 1) slots.roomQuery = tokens[0];
    if (tokens.length >= 2) slots.dayQuery = tokens[1];
    if (tokens.length >= 3) slots.timeQuery = tokens[2]; // 1 solo token per orario es. "14-15"
    if (tokens.length >= 4) slots.typeQuery = tokens.slice(3).join(' ');
  }
  return advance({ session: session || {}, slots }, deps);
}

/** Gestisce la risposta dell'utente nello stato corrente del wizard. */
async function step({ text, session }, deps = defaultDeps) {
  const slots = { ...(session.slots || {}) };
  const trimmed = text.trim();

  if (session.state === 'book_room.building') {
    slots.buildingQuery = trimmed;
  } else if (session.state === 'book_room.room') {
    slots.roomQuery = trimmed;
  } else if (session.state === 'book_room.when') {
    // Atteso "data ora", es. "ven 14-15"
    const tokens = trimmed.split(/\s+/);
    if (tokens.length >= 2) {
      slots.dayQuery = tokens[0];
      slots.timeQuery = tokens.slice(1).join(' ');
    } else {
      return {
        reply: 'Formato non valido. Esempio: `venerdì 14-15` oppure `2026-04-30 09:00-10:30`.',
      };
    }
  } else if (session.state === 'book_room.type') {
    slots.typeQuery = trimmed;
  } else if (session.state === 'book_room.confirm') {
    if (/^(s[iì]|yes|conferma|ok)$/i.test(trimmed)) {
      return deps.finalize({ slots, session });
    }
    if (/^(no|n|annulla)$/i.test(trimmed)) {
      return { reply: '↩️ Prenotazione annullata.', session: RESET };
    }
    return { reply: 'Rispondi *si* per confermare oppure *no* per annullare.' };
  }
  return advance({ session, slots }, deps);
}

/** Porta il wizard al primo step ancora incompleto (o finalizza). */
async function advance({ session, slots }, deps = defaultDeps) {
  // ── Step 1: SEDE ─────────────────────────────────────────────────────────
  if (!slots.buildingId) {
    const buildings = await deps.listActiveBuildings();
    if (buildings.length === 0) {
      return { reply: '❌ Nessuna sede configurata. Contatta la segreteria.', session: RESET };
    }
    if (buildings.length === 1) {
      // Mono-sede: skip silenzioso
      slots.buildingId = buildings[0].id;
      slots.buildingName = buildings[0].name;
    } else if (slots.buildingQuery) {
      const match = catalog.matchBuildingByQuery(buildings, slots.buildingQuery);
      if (!match) {
        return {
          reply:
            `❌ Sede "${mdSafe(slots.buildingQuery)}" non riconosciuta.\n\n` +
            catalog.renderBuildingsList(buildings),
          session: {
            state: 'book_room.building',
            slots: { ...slots, buildingQuery: undefined },
          },
        };
      }
      slots.buildingId = match.id;
      slots.buildingName = match.name;
    } else {
      return {
        reply:
          '🏛 *Quale sede?* Scegli scrivendo il numero o il nome:\n\n' +
          catalog.renderBuildingsList(buildings),
        session: { state: 'book_room.building', slots },
      };
    }
  }

  // ── Step 2: AULA (scoped sulla sede scelta) ──────────────────────────────
  if (!slots.roomId) {
    if (!slots.roomQuery) {
      return {
        reply: `🚪 Quale aula in *${mdSafe(slots.buildingName)}*? Scrivi il *codice* o il *nome*.`,
        session: { state: 'book_room.room', slots },
      };
    }
    const room = await deps.findRoomByQuery(slots.roomQuery, { buildingId: slots.buildingId });
    if (!room) {
      return {
        reply: `❌ Aula "${mdSafe(slots.roomQuery)}" non trovata in *${mdSafe(slots.buildingName)}*. Riprova con un altro nome o codice.`,
        session: { state: 'book_room.room', slots: { ...slots, roomQuery: undefined } },
      };
    }
    slots.roomId = room.id;
    slots.roomName = room.name;
  }

  // ── Step 3: DATA + ORARIO (ora istituzionale) ────────────────────────────
  if (!slots.startTime || !slots.endTime) {
    if (!slots.dayQuery || !slots.timeQuery) {
      return {
        reply:
          '📅 Quando? Indica *giorno + orario*.\nEs: `venerdì 14-15`, `2026-04-30 09:00-10:30`.',
        session: { state: 'book_room.when', slots },
      };
    }
    const day = parseDayQuery(slots.dayQuery);
    const range = parseTimeRange(slots.timeQuery);
    if (!day || !range) {
      return {
        reply: '❌ Data/ora non riconosciuti. Es: `venerdì 14-15` oppure `2026-04-30 09:00-10:30`.',
        session: {
          state: 'book_room.when',
          slots: { ...slots, dayQuery: undefined, timeQuery: undefined },
        },
      };
    }
    const { start, end } = rangeToInstants(day, range);
    slots.startTime = start.toISOString();
    slots.endTime = end.toISOString();
  }

  // ── Step 4: TIPO ATTIVITÀ ────────────────────────────────────────────────
  if (!slots.type) {
    const types = await deps.listActiveBookingTypes();
    if (types.length === 0) {
      // Catalogo vuoto (improbabile): fallback al default storico
      slots.type = 'studio_individuale';
      slots.typeLabel = 'Studio individuale';
    } else if (types.length === 1) {
      slots.type = types[0].code;
      slots.typeLabel = types[0].label;
    } else if (slots.typeQuery) {
      const match = catalog.matchBookingTypeByQuery(types, slots.typeQuery);
      if (!match) {
        return {
          reply:
            `❌ Tipo "${mdSafe(slots.typeQuery)}" non riconosciuto.\n\n` +
            catalog.renderBookingTypesList(types),
          session: { state: 'book_room.type', slots: { ...slots, typeQuery: undefined } },
        };
      }
      slots.type = match.code;
      slots.typeLabel = match.label;
    } else {
      return {
        reply:
          '🎯 *Tipo di attività?* Scegli scrivendo il numero o il nome:\n\n' +
          catalog.renderBookingTypesList(types),
        session: { state: 'book_room.type', slots },
      };
    }
  }

  // ── Step 5: CONFERMA ─────────────────────────────────────────────────────
  if (session.state !== 'book_room.confirm') {
    return {
      reply:
        `✅ *Confermi la prenotazione?*\n\n` +
        `• 🏛 *Sede:* ${mdSafe(slots.buildingName)}\n` +
        `• 🚪 *Aula:* ${mdSafe(slots.roomName)}\n` +
        `• 📅 *Quando:* ${formatSlot(slots.startTime, slots.endTime)}\n` +
        `• 🎯 *Tipo:* ${mdSafe(slots.typeLabel)}\n\n` +
        `Rispondi *si* o *no*.`,
      session: { state: 'book_room.confirm', slots },
    };
  }
  return deps.finalize({ slots, session });
}

module.exports = { WIZARD_STATES, isWizardState, start, step, advance, finalizeBook };
