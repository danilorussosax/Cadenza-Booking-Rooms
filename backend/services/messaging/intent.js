'use strict';

// =============================================================================
// Intent parser regole-based + state machine 5-step per il bot.
//
// Intent supportati:
//   - help        : /help, "?" → guida comandi
//   - book_room   : /book [aula] [data] [ora]  → wizard a 5 step
//                   step 1: chiedi sede        (skip se 1 sola sede attiva)
//                   step 2: chiedi aula        (filtrata sulla sede scelta)
//                   step 3: chiedi data + ora  (formati accettati:
//                           "ven 14:00", "venerdì 14-15", "2026-04-30 14:00")
//                   step 4: chiedi tipo attività (studio_individuale/lezione/…)
//                           (skip se l'utente ha già passato un tipo o ce n'è 1)
//                   step 5: conferma
//   - list_my     : /list, "elenco", "le mie prenotazioni"
//                   → ultime 5 prenotazioni future
//   - cancel      : /cancel <id> [motivo] → cancella se di proprietà
//   - check       : /check <aula>[@sede] <data>  → slot liberi del giorno per
//                   una specifica aula. Il suffisso `@sede` disambigua quando
//                   esistono aule omonime in edifici diversi.
//   - free_rooms  : /libere [@sede] [data] [ora] → cerca aule libere con
//                   filtri opzionali: sede (`@<nome>`), giorno e fascia oraria.
//                   Se è specificata una fascia oraria mostra le aule libere
//                   in quel range; senza fascia, le aule libere tutto il giorno.
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
const { Booking, Room, Building, BookingTypeCatalog } = require('../../models');
const { validateBooking } = require('../bookingValidator');

const HELP_TEXT = `🤖 *Cadenza — Bot*

📅 *Vista d'insieme*
• /aule — elenco delle aule prenotabili (nome + codice)
• /agenda [data] — chi prenota cosa nel giorno (default: oggi)
• /oggi · /domani — scorciatoie per /agenda
• /libere [@sede] [data] [ora] — cerca aule libere con filtri opzionali

📝 *Prenotazione*
• /book — prenota un'aula (wizard: sede → aula → quando → tipo → conferma)
• /list — le mie prenotazioni future
• /cancel <id> — annulla la prenotazione
• /check <aula>[@sede] <data> — slot liberi del giorno per una specifica aula

ℹ️ *Altro*
• /help — questa guida

📌 *Esempi*
  \`/aule\`
  \`/agenda\`                            (oggi)
  \`/agenda venerdì\`
  \`/libere ven 14-15\`                   (libere venerdì 14-15, ovunque)
  \`/libere @Storica ven 14-15\`          (filtro sede)
  \`/libere ven\`                          (libere tutto il giorno)
  \`/book\`                                (wizard guidato)
  \`/book <codice> ven 14-15\`             (shortcut: aula + quando)
  \`/book <codice> ven 14-15 lezione\`     (con tipo attività)
  \`/check <codice> venerdì\`
  \`/check <codice>@Storica venerdì\`      (disambigua aule omonime)
  \`/cancel 142\`

Per qualsiasi dubbio: contatta la segreteria.`;

// Format orari accettati nel parser:
//   "14:00-15:00", "14-15", "14:00", "9-10:30"
const TIME_RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/;

// Tronca un messaggio Telegram (limite hard ~4096) in modo da:
//   - rispettare un budget conservativo (default 4000 char)
//   - tagliare all'ultimo newline disponibile sotto il budget, così non
//     spezziamo a metà di un'entità Markdown (es. `*Aula 12*` diventerebbe
//     `*Aula` e Telegram risponderebbe 400 → invio fallisce silentemente)
//   - aggiungere un suffix che spieghi il troncamento
function truncateForTelegram(text, suffix, maxLen = 4000) {
  if (text.length <= maxLen) return text;
  const sliceEnd = Math.max(0, maxLen - suffix.length);
  // Cerca un newline ragionevole sotto il budget (entro gli ultimi 200 char)
  const newlineIdx = text.lastIndexOf('\n', sliceEnd);
  const cut = newlineIdx > sliceEnd - 400 && newlineIdx > 0 ? newlineIdx : sliceEnd;
  return text.slice(0, cut) + suffix;
}

// Caratteri "speciali" del Markdown legacy di Telegram. Quando un nome aula,
// nome sede o input dell'utente contiene `*`, `_`, `` ` ``, `[`, `]` non
// bilanciati, il Bot API risponde 400 "can't parse entities" e l'invio
// fallisce silentemente nella pipeline webhook (la 200 al provider è già
// stata inviata) → l'utente vede solo "doppia spunta" senza risposta.
//
// Strategia conservativa: stripping dei caratteri pericolosi dalle stringhe
// dinamiche prima dell'interpolazione nei template Markdown. Non perfetto
// (es. "Studio_5" diventa "Studio 5") ma garantisce che il messaggio non
// rompa mai il rendering. Migrare a MarkdownV2 richiederebbe di rifare
// anche TUTTI i template statici (anche i `.` e `+` vanno escapati in V2).
const MD_SPECIAL_RE = /[*_`[\]]/g;
function mdSafe(s) {
  return String(s ?? '')
    .replace(MD_SPECIAL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    session.state === 'book_room.building' ||
    session.state === 'book_room.room' ||
    session.state === 'book_room.when' ||
    session.state === 'book_room.type' ||
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
  // /aule, /rooms, /aula → lista delle aule prenotabili (no bookings).
  if (/^\/?(aule|rooms|aula)\b\s*$/i.test(cmd)) {
    return handleListRooms();
  }
  // /agenda [data], /oggi, /domani → snapshot prenotazioni del giorno
  // su tutte le aule, raggruppate per sede.
  const agendaMatch = cmd.match(/^\/?agenda(?:\s+(.+))?$/i);
  if (agendaMatch) {
    return handleAgenda({ dayQuery: (agendaMatch[1] || '').trim() || 'oggi' });
  }
  if (/^\/?oggi\b\s*$/i.test(cmd)) return handleAgenda({ dayQuery: 'oggi' });
  if (/^\/?domani\b\s*$/i.test(cmd)) return handleAgenda({ dayQuery: 'domani' });
  const cancelMatch = cmd.match(/^\/?cancel\s+(\d+)(?:\s+(.+))?$/i);
  if (cancelMatch) {
    return handleCancel({ user, id: Number(cancelMatch[1]), reason: cancelMatch[2] });
  }
  // /libere [@sede] [data] [ora] — cerca aule libere
  const freeMatch = cmd.match(/^\/?(libere|free)\b\s*(.*)$/i);
  if (freeMatch) {
    return handleFreeRooms({ argsLine: freeMatch[2] || '' });
  }
  // /check <aula>[@<sede>] <data>
  // L'aula può contenere spazi (es. "Aula 5", "Sala Prove"); la data è
  // sempre il singolo token finale (es. "venerdì", "2026-04-30").
  const checkMatch = cmd.match(/^\/?check\s+(.+)\s+(\S+)\s*$/i);
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
    const roomName = mdSafe(b.room?.name ?? '?');
    const buildingName = b.room?.building ? ` (${mdSafe(b.room.building.name)})` : '';
    return `• #${b.id} — *${roomName}*${buildingName}\n   ${start.format('ddd D MMM HH:mm')}–${end.format('HH:mm')}${status}`;
  });
  return {
    intent: 'list_my',
    reply: `📅 *Le tue prenotazioni future:*\n\n${lines.join('\n')}\n\nPer annullare: \`/cancel <id>\``,
  };
}

// =============================================================================
// Intent: cancel
//
// Cancellazione atomica via UPDATE … WHERE status IN (...): se due `/cancel`
// arrivano in parallelo, solo il primo trova `status='confirmed'` e succede;
// il secondo ottiene `affectedRows=0` e risponde "già annullata" senza
// duplicare side effects (audit, notifiche, ecc.).
// =============================================================================
async function handleCancel({ user, id, reason }) {
  const b = await Booking.findByPk(id);
  if (!b) return { intent: 'cancel', reply: `❌ Prenotazione #${id} non trovata.` };
  if (b.userId !== user.id)
    return { intent: 'cancel', reply: `❌ La prenotazione #${id} non è tua.` };
  if (b.status !== 'confirmed' && b.status !== 'pending_approval') {
    return {
      intent: 'cancel',
      reply: `❌ La prenotazione #${id} non è cancellabile (stato: ${mdSafe(b.status)}).`,
    };
  }
  if (dayjs(b.endTime).isBefore(dayjs())) {
    return { intent: 'cancel', reply: `❌ La prenotazione #${id} è già terminata.` };
  }
  const cancelReason = reason ? String(reason).slice(0, 255) : 'Cancellata via bot';
  const [affected] = await Booking.update(
    {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason,
    },
    {
      where: {
        id,
        userId: user.id,
        status: { [Op.in]: ['confirmed', 'pending_approval'] },
      },
    },
  );
  if (affected === 0) {
    // Race con un altro `/cancel` o cambio stato concorrente
    return {
      intent: 'cancel',
      reply: `ℹ️ Prenotazione #${id} già annullata o non più cancellabile.`,
    };
  }
  return { intent: 'cancel', reply: `✅ Prenotazione #${id} annullata.` };
}

// =============================================================================
// Intent: check_availability
//
// `roomQuery` può essere:
//   - "A12"            → match per code/name
//   - "A12@Storica"    → match scoped sulla sede "Storica"
//   - "Storica/A12"    → variante con slash
// La forma con sede è utile quando esistono aule omonime in più edifici.
// =============================================================================
async function handleCheck({ roomQuery, dayQuery }) {
  const { roomTerm, buildingTerm } = splitRoomBuildingQuery(roomQuery);
  let buildingId = null;
  let buildingName = null;
  if (buildingTerm) {
    const buildings = await listActiveBuildings();
    const match = matchBuildingByQuery(buildings, buildingTerm);
    if (!match) {
      return {
        intent: 'check',
        reply:
          `❌ Sede "${mdSafe(buildingTerm)}" non trovata.\n\n` + renderBuildingsList(buildings),
      };
    }
    buildingId = match.id;
    buildingName = match.name;
  }
  const room = await findRoomByQuery(roomTerm, buildingId ? { buildingId } : {});
  if (!room) {
    const where = buildingName ? ` in *${mdSafe(buildingName)}*` : '';
    return { intent: 'check', reply: `❌ Aula "${mdSafe(roomTerm)}"${where} non trovata.` };
  }
  const day = parseDayQuery(dayQuery);
  if (!day)
    return {
      intent: 'check',
      reply: `❌ Data "${mdSafe(dayQuery)}" non valida. Es: \`venerdì\`, \`2026-04-30\`.`,
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
  const safeRoomName = mdSafe(room.name);
  if (bookings.length === 0) {
    return {
      intent: 'check',
      reply: `✅ ${safeRoomName} è completamente libera ${day.format('ddd D MMM')}.`,
    };
  }
  const occupied = bookings
    .map((b) => `${dayjs(b.startTime).format('HH:mm')}–${dayjs(b.endTime).format('HH:mm')}`)
    .join(', ');
  return {
    intent: 'check',
    reply: `📋 *${safeRoomName}* — ${day.format('ddd D MMM')}\n\nOccupata: ${occupied}\n\nIl resto dell'orario (08–20) è libero.`,
  };
}

// =============================================================================
// Intent: list_rooms — `/aule` mostra tutte le aule prenotabili raggruppate
// per sede, con nome + codice + tipologia + capienza. Vista statica per
// memorizzare i codici da usare poi con /book o /check.
// =============================================================================
async function handleListRooms() {
  const rows = await Room.findAll({
    where: { isBookable: true },
    attributes: ['id', 'name', 'code', 'type', 'capacity'],
    include: [
      {
        model: Building,
        as: 'building',
        attributes: ['id', 'name'],
        required: true, // INNER JOIN: scarta orfani di edifici cestinati
      },
    ],
    order: [
      [{ model: Building, as: 'building' }, 'name', 'ASC'],
      ['name', 'ASC'],
    ],
    limit: 200,
  });
  if (rows.length === 0) {
    return {
      intent: 'list_rooms',
      reply: '🏛 Nessuna aula prenotabile configurata. Contatta la segreteria.',
    };
  }
  // Raggruppa per buildingId mantenendo l'ordine alfabetico delle sedi.
  const byBuilding = new Map();
  for (const r of rows) {
    const key = r.building.id;
    if (!byBuilding.has(key)) {
      byBuilding.set(key, { name: r.building.name, rooms: [] });
    }
    byBuilding.get(key).rooms.push(r);
  }

  const lines = ['🏛 *Aule prenotabili*', ''];
  for (const { name: buildingName, rooms } of byBuilding.values()) {
    lines.push(`🏢 *${mdSafe(buildingName)}*`);
    for (const r of rooms) {
      const code = r.code ? ` \`${mdSafe(r.code)}\`` : '';
      const meta = [];
      if (r.type) meta.push(mdSafe(r.type));
      if (r.capacity) meta.push(`${r.capacity} posti`);
      const metaStr = meta.length ? ` — _${meta.join(' · ')}_` : '';
      lines.push(`• ${mdSafe(r.name)}${code}${metaStr}`);
    }
    lines.push('');
  }
  lines.push(
    `📊 *${rows.length}* aule in *${byBuilding.size}* ${byBuilding.size === 1 ? 'sede' : 'sedi'}`,
  );
  lines.push('Per prenotare: `/book <codice>` oppure `/agenda` per vedere il giorno.');

  // Telegram limita a ~4096 caratteri per messaggio. Tronca al newline più
  // vicino per non spezzare un'entità Markdown.
  const text = lines.join('\n');
  const reply = truncateForTelegram(
    text,
    '\n\n…_(elenco troncato — contatta la segreteria per la lista completa)_',
  );
  return { intent: 'list_rooms', reply };
}

// =============================================================================
// Intent: agenda — `/agenda [data]` (default: oggi) mostra una panoramica del
// giorno: per ogni aula, libera 🟢 oppure lista degli intervalli occupati 🟡.
// Permette di vedere "a colpo d'occhio" cosa è prenotabile prima di /book.
//
// Accetta gli stessi formati data di /check e /book (oggi, domani, ven,
// 2026-04-30, 30/04/2026).
// =============================================================================
async function handleAgenda({ dayQuery }) {
  const day = parseDayQuery(dayQuery);
  if (!day) {
    return {
      intent: 'agenda',
      reply: `❌ Data "${mdSafe(dayQuery)}" non valida. Esempi: \`oggi\`, \`domani\`, \`venerdì\`, \`2026-04-30\`.`,
    };
  }

  const rooms = await Room.findAll({
    where: { isBookable: true },
    attributes: ['id', 'name', 'code'],
    include: [
      {
        model: Building,
        as: 'building',
        attributes: ['id', 'name'],
        required: true,
      },
    ],
    order: [
      [{ model: Building, as: 'building' }, 'name', 'ASC'],
      ['name', 'ASC'],
    ],
    limit: 200,
  });
  if (rooms.length === 0) {
    return {
      intent: 'agenda',
      reply: '🏛 Nessuna aula prenotabile configurata. Contatta la segreteria.',
    };
  }

  const dayStart = day.startOf('day').toDate();
  const dayEnd = day.endOf('day').toDate();
  // Carichiamo tutte le prenotazioni del giorno in una query, poi raggruppiamo
  // per roomId. Più efficiente di una query per aula.
  const bookings = await Booking.findAll({
    where: {
      roomId: { [Op.in]: rooms.map((r) => r.id) },
      status: { [Op.in]: ['confirmed', 'pending_approval'] },
      startTime: { [Op.lt]: dayEnd },
      endTime: { [Op.gt]: dayStart },
    },
    attributes: ['roomId', 'startTime', 'endTime', 'type', 'status'],
    order: [['startTime', 'ASC']],
  });
  const bookingsByRoom = new Map();
  for (const b of bookings) {
    if (!bookingsByRoom.has(b.roomId)) bookingsByRoom.set(b.roomId, []);
    bookingsByRoom.get(b.roomId).push(b);
  }

  // Raggruppa aule per sede
  const byBuilding = new Map();
  for (const r of rooms) {
    const key = r.building.id;
    if (!byBuilding.has(key)) {
      byBuilding.set(key, { name: r.building.name, rooms: [] });
    }
    byBuilding.get(key).rooms.push(r);
  }

  const lines = [`📅 *Agenda · ${day.format('dddd D MMMM')}*`, ''];
  let freeCount = 0;

  for (const { name: buildingName, rooms: bRooms } of byBuilding.values()) {
    lines.push(`🏢 *${mdSafe(buildingName)}*`);
    for (const r of bRooms) {
      const slots = bookingsByRoom.get(r.id) || [];
      const code = r.code ? ` \`${mdSafe(r.code)}\`` : '';
      const safeName = mdSafe(r.name);
      if (slots.length === 0) {
        lines.push(`🟢 *${safeName}*${code} — libera`);
        freeCount += 1;
      } else {
        lines.push(`🟡 *${safeName}*${code}`);
        for (const b of slots) {
          const s = dayjs(b.startTime).format('HH:mm');
          const e = dayjs(b.endTime).format('HH:mm');
          const pendBadge = b.status === 'pending_approval' ? ' ⏳' : '';
          const typeStr = b.type ? ` _${mdSafe(b.type)}_` : '';
          lines.push(`   ▸ ${s}–${e}${typeStr}${pendBadge}`);
        }
      }
    }
    lines.push('');
  }
  lines.push(`📊 Libere: *${freeCount}/${rooms.length}* aule`);
  if (freeCount > 0) {
    lines.push('Per prenotare una di queste: `/book` o `/book <codice>`.');
  }

  const text = lines.join('\n');
  const reply = truncateForTelegram(
    text,
    '\n\n…_(agenda troncata per lunghezza — usa `/check <aula> <data>` per il dettaglio)_',
  );
  return { intent: 'agenda', reply };
}

// =============================================================================
// Intent: book_room — wizard a 5 step
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
// =============================================================================
async function handleBookStart({ args, session }) {
  const slots = {};
  // Tentativo di parsing degli argomenti dal comando iniziale:
  // "/book <codice> ven 14-15 lezione" → tokens [codice, "ven", "14-15", "lezione"]
  // Per retrocompatibilità accettiamo da 0 a 4 tokens. Il 4° (tipo) è opzionale.
  if (args) {
    const tokens = args.split(/\s+/);
    if (tokens.length >= 1) slots.roomQuery = tokens[0];
    if (tokens.length >= 2) slots.dayQuery = tokens[1];
    if (tokens.length >= 3) slots.timeQuery = tokens[2]; // 1 solo token per orario es. "14-15"
    if (tokens.length >= 4) slots.typeQuery = tokens.slice(3).join(' ');
  }
  return advanceBookWizard({ session, slots });
}

async function handleBookWizard({ text, session }) {
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
      return finalizeBook({ slots, session });
    }
    if (/^(no|n|annulla)$/i.test(trimmed)) {
      return { reply: '↩️ Prenotazione annullata.', session: { state: null, slots: null } };
    }
    return { reply: 'Rispondi *si* per confermare oppure *no* per annullare.' };
  }
  return advanceBookWizard({ session, slots });
}

async function advanceBookWizard({ session, slots }) {
  // ── Step 1: SEDE ─────────────────────────────────────────────────────────
  // Se non abbiamo ancora una sede, la chiediamo. Skip se c'è una sola sede
  // attiva (il caso del Conservatorio mono-sede): pre-compiliamo.
  if (!slots.buildingId) {
    const buildings = await listActiveBuildings();
    if (buildings.length === 0) {
      return {
        reply: '❌ Nessuna sede configurata. Contatta la segreteria.',
        session: { state: null, slots: null },
      };
    }
    if (buildings.length === 1) {
      // Mono-sede: skip silenzioso
      slots.buildingId = buildings[0].id;
      slots.buildingName = buildings[0].name;
    } else if (slots.buildingQuery) {
      // L'utente ha digitato un termine, prova a risolverlo
      const match = matchBuildingByQuery(buildings, slots.buildingQuery);
      if (!match) {
        return {
          reply:
            `❌ Sede "${mdSafe(slots.buildingQuery)}" non riconosciuta.\n\n` +
            renderBuildingsList(buildings),
          session: {
            state: 'book_room.building',
            slots: { ...slots, buildingQuery: undefined },
          },
        };
      }
      slots.buildingId = match.id;
      slots.buildingName = match.name;
    } else {
      // Prima volta: chiedi
      return {
        reply:
          '🏛 *Quale sede?* Scegli scrivendo il numero o il nome:\n\n' +
          renderBuildingsList(buildings),
        session: { state: 'book_room.building', slots },
      };
    }
  }

  // ── Step 2: AULA ────────────────────────────────────────────────────────
  // La risoluzione è scoped sulla sede scelta: due aule "12" in edifici
  // diversi non si confondono.
  if (!slots.roomId) {
    if (!slots.roomQuery) {
      return {
        reply: `🚪 Quale aula in *${mdSafe(slots.buildingName)}*? Scrivi il *codice* o il *nome*.`,
        session: { state: 'book_room.room', slots },
      };
    }
    const room = await findRoomByQuery(slots.roomQuery, { buildingId: slots.buildingId });
    if (!room) {
      return {
        reply: `❌ Aula "${mdSafe(slots.roomQuery)}" non trovata in *${mdSafe(slots.buildingName)}*. Riprova con un altro nome o codice.`,
        session: { state: 'book_room.room', slots: { ...slots, roomQuery: undefined } },
      };
    }
    slots.roomId = room.id;
    slots.roomName = room.name;
  }

  // ── Step 3: DATA + ORARIO ────────────────────────────────────────────────
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
    const startTime = day.hour(range.startH).minute(range.startM).second(0).millisecond(0);
    const endTime = day.hour(range.endH).minute(range.endM).second(0).millisecond(0);
    slots.startTime = startTime.toISOString();
    slots.endTime = endTime.toISOString();
  }

  // ── Step 4: TIPO ATTIVITÀ ────────────────────────────────────────────────
  if (!slots.type) {
    const types = await listActiveBookingTypes();
    if (types.length === 0) {
      // Catalogo vuoto (improbabile): fallback al default storico
      slots.type = 'studio_individuale';
      slots.typeLabel = 'Studio individuale';
    } else if (types.length === 1) {
      // Unico tipo abilitato: skip silenzioso
      slots.type = types[0].code;
      slots.typeLabel = types[0].label;
    } else if (slots.typeQuery) {
      const match = matchBookingTypeByQuery(types, slots.typeQuery);
      if (!match) {
        return {
          reply:
            `❌ Tipo "${mdSafe(slots.typeQuery)}" non riconosciuto.\n\n` +
            renderBookingTypesList(types),
          session: { state: 'book_room.type', slots: { ...slots, typeQuery: undefined } },
        };
      }
      slots.type = match.code;
      slots.typeLabel = match.label;
    } else {
      return {
        reply:
          '🎯 *Tipo di attività?* Scegli scrivendo il numero o il nome:\n\n' +
          renderBookingTypesList(types),
        session: { state: 'book_room.type', slots },
      };
    }
  }

  // ── Step 5: CONFERMA ─────────────────────────────────────────────────────
  if (session.state !== 'book_room.confirm') {
    const start = dayjs(slots.startTime);
    const end = dayjs(slots.endTime);
    return {
      reply:
        `✅ *Confermi la prenotazione?*\n\n` +
        `• 🏛 *Sede:* ${mdSafe(slots.buildingName)}\n` +
        `• 🚪 *Aula:* ${mdSafe(slots.roomName)}\n` +
        `• 📅 *Quando:* ${start.format('ddd D MMM HH:mm')}–${end.format('HH:mm')}\n` +
        `• 🎯 *Tipo:* ${mdSafe(slots.typeLabel)}\n\n` +
        `Rispondi *si* o *no*.`,
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
      const errMsg = mdSafe((result?.errors || []).join('; ') || 'regola violata');
      return {
        reply: `❌ Prenotazione non valida: ${errMsg}.`,
        session: { state: null, slots: null },
      };
    }
  } catch (err) {
    return {
      reply: `❌ Errore validazione: ${mdSafe(err.message || 'errore generico')}.`,
      session: { state: null, slots: null },
    };
  }
  // Crea la booking. Se l'aula richiede approvazione e l'utente non è admin,
  // verrà creata in pending (lo stesso percorso di routes/bookings.js).
  // Re-check isBookable + building non-cestinato: il wizard può aver
  // selezionato l'aula molti minuti fa (TTL sessione 15min) e nel frattempo
  // l'admin può averla disattivata o averne cestinato la sede. Senza questo
  // re-check creeremmo silenziosamente una booking su risorsa non più valida.
  const room = await Room.findByPk(slots.roomId, {
    include: [{ model: Building, as: 'building' }],
  });
  if (!room || !room.isBookable) {
    return {
      reply: '❌ L’aula selezionata non è più prenotabile. Riprova con `/book`.',
      session: { state: null, slots: null },
    };
  }
  if (!room.building || room.building.deletedAt) {
    return {
      reply: '❌ La sede dell’aula selezionata non è più attiva. Riprova con `/book`.',
      session: { state: null, slots: null },
    };
  }
  const status = room?.requiresApproval && user.role !== 'admin' ? 'pending_approval' : 'confirmed';
  const booking = await Booking.create({
    userId: session.userId,
    roomId: slots.roomId,
    startTime: new Date(slots.startTime),
    endTime: new Date(slots.endTime),
    type: slots.type || 'studio_individuale',
    status,
    purpose: 'Prenotazione via bot',
  });
  const start = dayjs(slots.startTime);
  const end = dayjs(slots.endTime);
  const summary =
    `• 🏛 ${mdSafe(slots.buildingName)}\n` +
    `• 🚪 *${mdSafe(slots.roomName)}*\n` +
    `• 📅 ${start.format('ddd D MMM HH:mm')}–${end.format('HH:mm')}\n` +
    `• 🎯 ${mdSafe(slots.typeLabel || slots.type)}`;
  const reply =
    status === 'pending_approval'
      ? `⏳ Richiesta inviata (#${booking.id}). La direzione approva entro 24h, riceverai un messaggio.\n\n${summary}`
      : `✅ Prenotazione confermata (#${booking.id})!\n\n${summary}`;
  return { reply, intent: 'book_room', session: { state: null, slots: null } };
}

// =============================================================================
// Helpers
// =============================================================================

async function findRoomByQuery(q, opts = {}) {
  const term = String(q || '').trim();
  if (!term) return null;
  const where = {
    isBookable: true,
    [Op.or]: [
      { code: term },
      { name: term },
      { code: { [Op.like]: `%${term}%` } },
      { name: { [Op.like]: `%${term}%` } },
    ],
  };
  // Scope opzionale alla sede: utile dal wizard per evitare collisioni
  // tra aule con lo stesso codice in edifici diversi.
  if (opts.buildingId != null) where.buildingId = opts.buildingId;
  return Room.findOne({ where });
}

/** Spezza una query "aula@sede" o "sede/aula" in parti separate. La forma
 *  pura "aula" lascia `buildingTerm = null`. Lo scope su sede serve a
 *  disambiguare aule omonime in edifici diversi. */
function splitRoomBuildingQuery(q) {
  const term = String(q || '').trim();
  if (!term) return { roomTerm: '', buildingTerm: null };
  // "<aula>@<sede>" — preferito perché auto-esplicativo e non collide con
  // codici aula che possono contenere "/" (es. "A/12").
  const at = term.split('@');
  if (at.length === 2 && at[0].trim() && at[1].trim()) {
    return { roomTerm: at[0].trim(), buildingTerm: at[1].trim() };
  }
  // "<sede>/<aula>" — solo se la metà sinistra non sembra un codice aula
  // breve. Per sicurezza accettiamo solo se il `/` è presente UNA volta e
  // la parte sinistra è almeno 3 char (riduce falsi positivi tipo "A/12").
  const slashIdx = term.indexOf('/');
  if (slashIdx >= 3 && term.indexOf('/', slashIdx + 1) === -1) {
    const left = term.slice(0, slashIdx).trim();
    const right = term.slice(slashIdx + 1).trim();
    if (left && right) return { roomTerm: right, buildingTerm: left };
  }
  return { roomTerm: term, buildingTerm: null };
}

// =============================================================================
// Intent: free_rooms — `/libere [@sede] [data] [ora]`
//
// Cerca le aule libere applicando filtri opzionali:
//   - `@<sede>` (anywhere nella stringa) → restringe a un edificio
//   - `<data>`  → giorno (default: oggi); accetta gli stessi formati di /check
//   - `<ora>`   → range orario (es. "14-15"). Se presente, mostra le aule
//                  libere SOLO in quella fascia. Se assente, le aule libere
//                  per l'intero giorno.
//
// Esempi:
//   /libere                      → tutte le aule libere oggi (intero giorno)
//   /libere ven                  → libere venerdì (intero giorno)
//   /libere ven 14-15            → libere venerdì in fascia 14-15
//   /libere @Storica ven 14-15   → libere a Storica venerdì 14-15
//   /libere @Verdi               → libere a Verdi oggi (intero giorno)
//
// L'ordine dei token è libero: il parser estrae @sede ovunque, poi tenta di
// riconoscere il range orario come ultimo token, e tratta il resto come data.
// =============================================================================
async function handleFreeRooms({ argsLine }) {
  let rest = String(argsLine || '').trim();

  // Estrai @<sede>: accetta @"Sede con spazi" oppure @ParolaSingola
  let buildingQuery = null;
  const atQuoted = rest.match(/@"([^"]+)"/);
  if (atQuoted) {
    buildingQuery = atQuoted[1].trim();
    rest = rest.replace(atQuoted[0], ' ').replace(/\s+/g, ' ').trim();
  } else {
    const atSimple = rest.match(/@(\S+)/);
    if (atSimple) {
      buildingQuery = atSimple[1].trim();
      rest = rest.replace(atSimple[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // Estrai range orario (TIME_RANGE_RE) — di solito è l'ultimo token, ma per
  // robustezza cerchiamo ovunque (gli orari hanno una forma facilmente
  // riconoscibile e non collidono con i nomi giorno).
  let timeQuery = null;
  const timeMatch = rest.match(TIME_RANGE_RE);
  if (timeMatch) {
    timeQuery = timeMatch[0];
    rest = rest.replace(timeMatch[0], ' ').replace(/\s+/g, ' ').trim();
  }

  // Tutto ciò che rimane è la data (può essere multi-token come "2026-04-30")
  const dayQuery = rest || 'oggi';
  const day = parseDayQuery(dayQuery);
  if (!day) {
    return {
      intent: 'free',
      reply: `❌ Data "${mdSafe(dayQuery)}" non valida. Esempi: \`oggi\`, \`domani\`, \`venerdì\`, \`2026-04-30\`.`,
    };
  }
  let timeRange = null;
  if (timeQuery) {
    timeRange = parseTimeRange(timeQuery);
    if (!timeRange) {
      return {
        intent: 'free',
        reply: `❌ Orario "${mdSafe(timeQuery)}" non valido. Esempi: \`14-15\`, \`14:00-15:30\`.`,
      };
    }
  }

  // Risolvi sede se richiesta
  let buildingFilter = null;
  if (buildingQuery) {
    const buildings = await listActiveBuildings();
    if (buildings.length === 0) {
      return {
        intent: 'free',
        reply: '🏛 Nessuna sede configurata. Contatta la segreteria.',
      };
    }
    buildingFilter = matchBuildingByQuery(buildings, buildingQuery);
    if (!buildingFilter) {
      return {
        intent: 'free',
        reply:
          `❌ Sede "${mdSafe(buildingQuery)}" non trovata.\n\n` + renderBuildingsList(buildings),
      };
    }
  }

  // Carica aule (eventualmente filtrate per sede)
  const roomWhere = { isBookable: true };
  if (buildingFilter) roomWhere.buildingId = buildingFilter.id;
  const rooms = await Room.findAll({
    where: roomWhere,
    attributes: ['id', 'name', 'code'],
    include: [
      {
        model: Building,
        as: 'building',
        attributes: ['id', 'name'],
        required: true,
      },
    ],
    order: [
      [{ model: Building, as: 'building' }, 'name', 'ASC'],
      ['name', 'ASC'],
    ],
    limit: 200,
  });
  if (rooms.length === 0) {
    const scope = buildingFilter ? ` in *${mdSafe(buildingFilter.name)}*` : '';
    return {
      intent: 'free',
      reply: `🏛 Nessuna aula prenotabile${scope}. Contatta la segreteria.`,
    };
  }

  // Finestra di interesse: range orario se passato, altrimenti l'intero giorno
  let windowStart;
  let windowEnd;
  if (timeRange) {
    windowStart = day
      .hour(timeRange.startH)
      .minute(timeRange.startM)
      .second(0)
      .millisecond(0)
      .toDate();
    windowEnd = day.hour(timeRange.endH).minute(timeRange.endM).second(0).millisecond(0).toDate();
  } else {
    windowStart = day.startOf('day').toDate();
    windowEnd = day.endOf('day').toDate();
  }

  const bookings = await Booking.findAll({
    where: {
      roomId: { [Op.in]: rooms.map((r) => r.id) },
      status: { [Op.in]: ['confirmed', 'pending_approval'] },
      startTime: { [Op.lt]: windowEnd },
      endTime: { [Op.gt]: windowStart },
    },
    attributes: ['roomId', 'startTime', 'endTime', 'status'],
    order: [['startTime', 'ASC']],
  });
  const busyByRoom = new Map();
  for (const b of bookings) {
    if (!busyByRoom.has(b.roomId)) busyByRoom.set(b.roomId, []);
    busyByRoom.get(b.roomId).push(b);
  }

  // Raggruppa aule libere per sede (mantiene visibilità di dove sta cosa anche
  // quando non si filtra per @sede).
  const byBuilding = new Map();
  for (const r of rooms) {
    if (busyByRoom.has(r.id)) continue; // occupata nella finestra
    const key = r.building.id;
    if (!byBuilding.has(key)) {
      byBuilding.set(key, { name: r.building.name, rooms: [] });
    }
    byBuilding.get(key).rooms.push(r);
  }

  const totalFree = Array.from(byBuilding.values()).reduce((acc, b) => acc + b.rooms.length, 0);
  const dayLabel = day.format('ddd D MMM');
  const timeLabel = timeRange
    ? ` ${pad2(timeRange.startH)}:${pad2(timeRange.startM)}–${pad2(timeRange.endH)}:${pad2(timeRange.endM)}`
    : ' (tutto il giorno)';
  const scopeLabel = buildingFilter ? ` · 🏢 ${mdSafe(buildingFilter.name)}` : '';

  const header = `🟢 *Aule libere — ${dayLabel}${timeLabel}*${scopeLabel}`;

  if (totalFree === 0) {
    const safeDayQuery = mdSafe(dayQuery);
    const hint = timeRange
      ? `Nessuna aula libera nella fascia richiesta. Prova a cambiare orario o usa \`/agenda ${safeDayQuery}\` per vedere chi prenota cosa.`
      : `Nessuna aula completamente libera quel giorno. Usa \`/agenda ${safeDayQuery}\` per vedere le fasce libere.`;
    return { intent: 'free', reply: `${header}\n\n${hint}` };
  }

  const lines = [header, ''];
  for (const { name: buildingName, rooms: bRooms } of byBuilding.values()) {
    // Mostra l'header sede solo se non stiamo già filtrando su una sede sola
    if (!buildingFilter) lines.push(`🏢 *${mdSafe(buildingName)}*`);
    for (const r of bRooms) {
      const code = r.code ? ` \`${mdSafe(r.code)}\`` : '';
      lines.push(`• ${mdSafe(r.name)}${code}`);
    }
    if (!buildingFilter) lines.push('');
  }
  lines.push(`📊 *${totalFree}/${rooms.length}* aule libere`);
  lines.push('Per prenotare: `/book <codice>` (oppure `/book` per il wizard).');

  const text = lines.join('\n');
  const reply = truncateForTelegram(
    text,
    '\n\n…_(elenco troncato — restringi con `@sede` o un orario specifico)_',
  );
  return { intent: 'free', reply };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// =============================================================================
// Building helpers (Step 1 del wizard /book)
// =============================================================================

/** Carica le sedi attive (= con almeno 1 aula prenotabile, niente edifici
 *  vuoti o cestinati). Cap a 25 per non rendere il messaggio Telegram
 *  troppo lungo. */
async function listActiveBuildings() {
  const buildings = await Building.findAll({
    attributes: ['id', 'name'],
    include: [
      {
        model: Room,
        as: 'rooms',
        attributes: ['id'],
        where: { isBookable: true },
        required: true, // INNER JOIN: solo edifici con aule prenotabili
      },
    ],
    order: [['name', 'ASC']],
    limit: 25,
  });
  // Dedup per id (l'INNER JOIN può generare righe per ciascuna aula)
  const seen = new Set();
  const out = [];
  for (const b of buildings) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push({ id: b.id, name: b.name });
  }
  return out;
}

/** Match flessibile: numero (1-based dell'elenco), id numerico, oppure
 *  ricerca case-insensitive sul nome. */
function matchBuildingByQuery(buildings, q) {
  const term = String(q || '').trim();
  if (!term) return null;
  // Numero 1-based dalla lista mostrata all'utente
  const asIndex = Number.parseInt(term, 10);
  if (!Number.isNaN(asIndex) && asIndex >= 1 && asIndex <= buildings.length) {
    return buildings[asIndex - 1];
  }
  // Match esatto su nome (case-insensitive)
  const lower = term.toLowerCase();
  const exact = buildings.find((b) => b.name.toLowerCase() === lower);
  if (exact) return exact;
  // Match parziale (substring)
  const partial = buildings.find((b) => b.name.toLowerCase().includes(lower));
  return partial || null;
}

/** Render della lista sedi numerata, formato Telegram-friendly. */
function renderBuildingsList(buildings) {
  return buildings.map((b, i) => `${i + 1}. *${mdSafe(b.name)}*`).join('\n');
}

// =============================================================================
// BookingType helpers (Step 4 del wizard /book)
// =============================================================================

/** Carica i tipi di prenotazione attivi dal catalogo, ordinati come l'admin
 *  ha previsto. Il bot mostra solo `code` + `label` — color/icon non hanno
 *  senso in chat testuale. */
async function listActiveBookingTypes() {
  const rows = await BookingTypeCatalog.findAll({
    where: { isActive: true },
    attributes: ['code', 'label'],
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  return rows.map((r) => ({ code: r.code, label: r.label }));
}

/** Match flessibile su code o label. Accetta anche il numero 1-based. */
function matchBookingTypeByQuery(types, q) {
  const term = String(q || '').trim();
  if (!term) return null;
  const asIndex = Number.parseInt(term, 10);
  if (!Number.isNaN(asIndex) && asIndex >= 1 && asIndex <= types.length) {
    return types[asIndex - 1];
  }
  const lower = term.toLowerCase();
  // Match esatto su code (es. "lezione")
  const byCode = types.find((t) => t.code === lower);
  if (byCode) return byCode;
  // Match esatto su label (case-insensitive)
  const byLabel = types.find((t) => t.label.toLowerCase() === lower);
  if (byLabel) return byLabel;
  // Match parziale su entrambi
  const partial = types.find(
    (t) => t.code.includes(lower) || t.label.toLowerCase().includes(lower),
  );
  return partial || null;
}

/** Render della lista tipi numerata. */
function renderBookingTypesList(types) {
  return types.map((t, i) => `${i + 1}. *${mdSafe(t.label)}*`).join('\n');
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
