'use strict';

// =============================================================================
// Intent parser regole-based + state machine 3-step per il bot.
//
// Intent supportati:
//   - help        : /help, "?" → guida comandi
//   - book_room   : /book [aula] [data] [ora]  → wizard 3-step
//                   step 1: chiedi aula (lista filtrata se >5)
//                   step 2: chiedi data + orario  (formati accettati:
//                           "ven 14:00", "venerdì 14-15", "2026-04-30 14:00")
//                   step 3: conferma
//   - list_my     : /list, "elenco", "le mie prenotazioni"
//                   → ultime 5 prenotazioni future
//   - cancel      : /cancel <id> [motivo] → cancella se di proprietà
//   - check       : /check <aula> <data>  → mostra slot liberi del giorno
//
// Reuse di `services/bookingValidator.js` per book/check così il bot non
// bypassa rules/quotas. Failure mode: rispondi con il messaggio dell'errore
// validator (già human-readable).
// =============================================================================

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const isoWeek = require('dayjs/plugin/isoWeek');
require('dayjs/locale/it');
dayjs.extend(customParseFormat);
dayjs.extend(isoWeek);
dayjs.locale('it');

const { Op } = require('sequelize');
const { Booking, Room, Building } = require('../../models');
const { validateBooking } = require('../bookingValidator');

const HELP_TEXT = `🤖 *Aula Book — Bot*

Comandi disponibili:
• /book — prenota un'aula (ti guido step by step)
• /list — le mie prenotazioni future
• /cancel <id> — annulla la prenotazione
• /check <aula> <data> — slot liberi del giorno
• /help — questa guida

Esempi:
  \`/book A.101 ven 14-15\`
  \`/check A.101 venerdì\`
  \`/cancel 142\`

Per qualsiasi dubbio: contatta la segreteria.`;

// Format orari accettati nel parser:
//   "14:00-15:00", "14-15", "14:00", "9-10:30"
const TIME_RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/;

// Mappa giorni IT → offset isoWeekday
const DAY_NAMES = {
  lun: 1,
  lunedì: 1,
  lunedi: 1,
  mar: 2,
  martedì: 2,
  martedi: 2,
  mer: 3,
  mercoledì: 3,
  mercoledi: 3,
  gio: 4,
  giovedì: 4,
  giovedi: 4,
  ven: 5,
  venerdì: 5,
  venerdi: 5,
  sab: 6,
  sabato: 6,
  dom: 7,
  domenica: 7,
};

// =============================================================================
// Top-level handle: dato testo + sessione corrente, decide cosa fare.
// =============================================================================
async function handle({ text, user, session, channel }) {
  const cmd = String(text || '').trim();
  if (!cmd) return { reply: null };

  // /reset o annulla durante wizard
  if (/^\/?(annulla|reset|cancel-wizard)$/i.test(cmd)) {
    return {
      reply: '↩️ Operazione annullata.',
      session: { state: null, slots: null },
    };
  }

  // Se siamo in un wizard, smista al gestore di quello stato
  if (
    session.state === 'book_room.room' ||
    session.state === 'book_room.when' ||
    session.state === 'book_room.confirm'
  ) {
    return handleBookWizard({ text: cmd, user, session });
  }

  // Smista per comando
  if (/^\/?(help|aiuto|guida)\b|^\?\s*$/i.test(cmd)) {
    return { intent: 'help', reply: HELP_TEXT };
  }
  if (/^\/?(list|elenco|mie\s+prenotazioni)\b/i.test(cmd)) {
    return handleListMy({ user });
  }
  const cancelMatch = cmd.match(/^\/?cancel\s+(\d+)(?:\s+(.+))?$/i);
  if (cancelMatch) {
    return handleCancel({ user, id: Number(cancelMatch[1]), reason: cancelMatch[2] });
  }
  const checkMatch = cmd.match(/^\/?check\s+(.+?)\s+(.+)$/i);
  if (checkMatch) {
    return handleCheck({ roomQuery: checkMatch[1].trim(), dayQuery: checkMatch[2].trim() });
  }
  // /book con o senza argomenti
  if (/^\/?(book|prenota)\b/i.test(cmd)) {
    const args = cmd.replace(/^\/?(book|prenota)\s*/i, '').trim();
    return handleBookStart({ args, user, session, channel });
  }

  // Fallback
  return {
    reply: `🤔 Non ho capito. Scrivi *help* o */help* per la guida.`,
  };
}

// =============================================================================
// Intent: list_my (prossime 5 prenotazioni dell'utente)
// =============================================================================
async function handleListMy({ user }) {
  const rows = await Booking.findAll({
    where: {
      userId: user.id,
      status: { [Op.in]: ['confirmed', 'pending_approval'] },
      endTime: { [Op.gt]: new Date() },
    },
    include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
    order: [['startTime', 'ASC']],
    limit: 5,
  });
  if (rows.length === 0) {
    return {
      intent: 'list_my',
      reply: '📅 Nessuna prenotazione futura. Usa */book* per prenotare.',
    };
  }
  const lines = rows.map((b) => {
    const start = dayjs(b.startTime);
    const end = dayjs(b.endTime);
    const status = b.status === 'pending_approval' ? ' ⏳' : '';
    return `• #${b.id} — *${b.room?.name ?? '?'}*${b.room?.building ? ` (${b.room.building.name})` : ''}\n   ${start.format('ddd D MMM HH:mm')}–${end.format('HH:mm')}${status}`;
  });
  return {
    intent: 'list_my',
    reply: `📅 *Le tue prenotazioni future:*\n\n${lines.join('\n')}\n\nPer annullare: \`/cancel <id>\``,
  };
}

// =============================================================================
// Intent: cancel
// =============================================================================
async function handleCancel({ user, id, reason }) {
  const b = await Booking.findByPk(id);
  if (!b) return { intent: 'cancel', reply: `❌ Prenotazione #${id} non trovata.` };
  if (b.userId !== user.id)
    return { intent: 'cancel', reply: `❌ La prenotazione #${id} non è tua.` };
  if (b.status !== 'confirmed' && b.status !== 'pending_approval') {
    return {
      intent: 'cancel',
      reply: `❌ La prenotazione #${id} non è cancellabile (stato: ${b.status}).`,
    };
  }
  if (dayjs(b.endTime).isBefore(dayjs())) {
    return { intent: 'cancel', reply: `❌ La prenotazione #${id} è già terminata.` };
  }
  b.status = 'cancelled';
  b.cancelledAt = new Date();
  b.cancelReason = reason ? String(reason).slice(0, 255) : 'Cancellata via bot';
  await b.save();
  return { intent: 'cancel', reply: `✅ Prenotazione #${id} annullata.` };
}

// =============================================================================
// Intent: check_availability
// =============================================================================
async function handleCheck({ roomQuery, dayQuery }) {
  const room = await findRoomByQuery(roomQuery);
  if (!room) return { intent: 'check', reply: `❌ Aula "${roomQuery}" non trovata.` };
  const day = parseDayQuery(dayQuery);
  if (!day)
    return {
      intent: 'check',
      reply: `❌ Data "${dayQuery}" non valida. Es: \`venerdì\`, \`2026-04-30\`.`,
    };
  const dayStart = day.startOf('day').toDate();
  const dayEnd = day.endOf('day').toDate();
  const bookings = await Booking.findAll({
    where: {
      roomId: room.id,
      status: 'confirmed',
      startTime: { [Op.lt]: dayEnd },
      endTime: { [Op.gt]: dayStart },
    },
    order: [['startTime', 'ASC']],
  });
  if (bookings.length === 0) {
    return {
      intent: 'check',
      reply: `✅ ${room.name} è completamente libera ${day.format('ddd D MMM')}.`,
    };
  }
  const occupied = bookings
    .map((b) => `${dayjs(b.startTime).format('HH:mm')}–${dayjs(b.endTime).format('HH:mm')}`)
    .join(', ');
  return {
    intent: 'check',
    reply: `📋 *${room.name}* — ${day.format('ddd D MMM')}\n\nOccupata: ${occupied}\n\nIl resto dell'orario (08–20) è libero.`,
  };
}

// =============================================================================
// Intent: book_room — wizard 3-step
//
// Step 1 — book_room.room  : raccoglie l'aula
// Step 2 — book_room.when  : raccoglie data + range orario
// Step 3 — book_room.confirm: chiede conferma SI/NO
// Se l'utente passa già aula/data/ora nel comando iniziale, saltiamo gli
// step già coperti.
// =============================================================================
async function handleBookStart({ args, session }) {
  const slots = {};
  // Tentativo di parsing dei tre argomenti dal comando iniziale:
  // "/book A.101 ven 14-15" → tokens ["A.101", "ven", "14-15"]
  if (args) {
    const tokens = args.split(/\s+/);
    if (tokens.length >= 1) slots.roomQuery = tokens[0];
    if (tokens.length >= 2) slots.dayQuery = tokens[1];
    if (tokens.length >= 3) slots.timeQuery = tokens.slice(2).join(' ');
  }
  return advanceBookWizard({ session, slots });
}

async function handleBookWizard({ text, session }) {
  const slots = { ...(session.slots || {}) };
  if (session.state === 'book_room.room') {
    slots.roomQuery = text;
  } else if (session.state === 'book_room.when') {
    // Atteso "data ora", es. "ven 14-15"
    const tokens = text.trim().split(/\s+/);
    if (tokens.length >= 2) {
      slots.dayQuery = tokens[0];
      slots.timeQuery = tokens.slice(1).join(' ');
    } else {
      return {
        reply: 'Formato non valido. Esempio: `venerdì 14-15` oppure `2026-04-30 09:00-10:30`.',
      };
    }
  } else if (session.state === 'book_room.confirm') {
    if (/^(s[iì]|yes|conferma|ok)$/i.test(text.trim())) {
      return finalizeBook({ slots, session });
    }
    if (/^(no|n|annulla)$/i.test(text.trim())) {
      return { reply: '↩️ Prenotazione annullata.', session: { state: null, slots: null } };
    }
    return { reply: 'Rispondi *si* per confermare oppure *no* per annullare.' };
  }
  return advanceBookWizard({ session, slots });
}

async function advanceBookWizard({ session, slots }) {
  if (!slots.roomQuery) {
    return {
      reply: '🏛 Quale aula vuoi prenotare? Scrivi il *codice* o il *nome*.',
      session: { state: 'book_room.room', slots },
    };
  }
  // Risolvi aula
  const room = await findRoomByQuery(slots.roomQuery);
  if (!room) {
    return {
      reply: `❌ Aula "${slots.roomQuery}" non trovata. Riprova con un altro nome o codice.`,
      session: { state: 'book_room.room', slots: { ...slots, roomQuery: undefined } },
    };
  }
  slots.roomId = room.id;
  slots.roomName = room.name;

  if (!slots.dayQuery || !slots.timeQuery) {
    return {
      reply: `📅 Quando? Indica *giorno + orario*.\nEs: \`venerdì 14-15\`, \`2026-04-30 09:00-10:30\`.`,
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
  const startTime = day.hour(range.startH).minute(range.startM).second(0).millisecond(0);
  const endTime = day.hour(range.endH).minute(range.endM).second(0).millisecond(0);
  slots.startTime = startTime.toISOString();
  slots.endTime = endTime.toISOString();
  if (session.state !== 'book_room.confirm') {
    return {
      reply: `✅ Confermi la prenotazione?\n\n• *${room.name}*\n• ${startTime.format('ddd D MMM HH:mm')}–${endTime.format('HH:mm')}\n\nRispondi *si* o *no*.`,
      session: { state: 'book_room.confirm', slots },
    };
  }
  return finalizeBook({ slots, session });
}

async function finalizeBook({ slots, session }) {
  const { User } = require('../../models');
  const user = await User.findByPk(session.userId);
  if (!user) {
    return { reply: '❌ Utente non trovato.', session: { state: null, slots: null } };
  }
  // Riusa il validator senza bypass: rispetta rules, quotas, requiresApproval.
  try {
    const result = await validateBooking({
      user,
      roomId: slots.roomId,
      startTime: new Date(slots.startTime),
      endTime: new Date(slots.endTime),
    });
    if (!result?.valid) {
      return {
        reply: `❌ Prenotazione non valida: ${(result?.errors || []).join('; ') || 'regola violata'}.`,
        session: { state: null, slots: null },
      };
    }
  } catch (err) {
    return {
      reply: `❌ Errore validazione: ${err.message || 'errore generico'}.`,
      session: { state: null, slots: null },
    };
  }
  // Crea la booking. Se l'aula richiede approvazione e l'utente non è admin,
  // verrà creata in pending (lo stesso percorso di routes/bookings.js).
  const room = await Room.findByPk(slots.roomId);
  const status = room?.requiresApproval && user.role !== 'admin' ? 'pending_approval' : 'confirmed';
  const booking = await Booking.create({
    userId: session.userId,
    roomId: slots.roomId,
    startTime: new Date(slots.startTime),
    endTime: new Date(slots.endTime),
    type: 'studio_individuale',
    status,
    purpose: 'Prenotazione via bot',
  });
  const reply =
    status === 'pending_approval'
      ? `⏳ Richiesta inviata (#${booking.id}). La direzione approva entro 24h, riceverai un messaggio.`
      : `✅ Prenotazione confermata (#${booking.id})!\n\n• *${slots.roomName}*\n• ${dayjs(slots.startTime).format('ddd D MMM HH:mm')}–${dayjs(slots.endTime).format('HH:mm')}`;
  return { reply, intent: 'book_room', session: { state: null, slots: null } };
}

// =============================================================================
// Helpers
// =============================================================================

async function findRoomByQuery(q) {
  const term = String(q || '').trim();
  if (!term) return null;
  // Match esatto su code o name (case-insensitive). LIKE su entrambi.
  return Room.findOne({
    where: {
      isBookable: true,
      [Op.or]: [
        { code: term },
        { name: term },
        { code: { [Op.like]: `%${term}%` } },
        { name: { [Op.like]: `%${term}%` } },
      ],
    },
  });
}

/** Parsa una "data" come dayjs all'inizio del giorno. Accetta:
 *   - "oggi", "domani"
 *   - nomi giorno IT ("ven", "venerdì") → prossima occorrenza
 *   - "YYYY-MM-DD" / "DD/MM/YYYY" / "DD-MM-YYYY" */
function parseDayQuery(s) {
  const term = String(s || '')
    .trim()
    .toLowerCase();
  if (!term) return null;
  if (term === 'oggi') return dayjs().startOf('day');
  if (term === 'domani') return dayjs().add(1, 'day').startOf('day');
  if (DAY_NAMES[term]) {
    const target = DAY_NAMES[term];
    let d = dayjs().startOf('day');
    while (d.isoWeekday() !== target) d = d.add(1, 'day');
    return d;
  }
  // Try several common formats
  for (const fmt of ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'D/M/YYYY', 'D-M-YYYY']) {
    const parsed = dayjs(term, fmt, true);
    if (parsed.isValid()) return parsed.startOf('day');
  }
  return null;
}

/** Parsa "14-15", "14:00-15:00", "9-10:30" → { startH, startM, endH, endM }. */
function parseTimeRange(s) {
  const m = String(s || '').match(TIME_RANGE_RE);
  if (!m) return null;
  const startH = parseInt(m[1], 10);
  const startM = parseInt(m[2] || '0', 10);
  const endH = parseInt(m[3], 10);
  const endM = parseInt(m[4] || '0', 10);
  if (startH < 0 || startH > 23 || endH < 0 || endH > 23) return null;
  if (endH < startH || (endH === startH && endM <= startM)) return null;
  return { startH, startM, endH, endM };
}

module.exports = { handle };
