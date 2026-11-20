'use strict';

// =============================================================================
// Comandi di lettura/azione singola del bot: list, cancel, check, aule,
// agenda, libere. Interrogano il DB e producono testo Telegram.
// =============================================================================

const { Op } = require('sequelize');
const { cancel } = require('../bookingLifecycle');
const { Booking, Room, Building } = require('../../models');
const institutionTime = require('../../lib/institutionTime');
const {
  TIME_RANGE_RE,
  parseDayQuery,
  parseTimeRange,
  rangeToInstants,
  dayBounds,
  pad2,
} = require('./dateTimeParser');
const {
  truncateForTelegram,
  mdSafe,
  dayLabelIso,
  formatSlot,
  formatTimeSpan,
} = require('./telegramText');
const {
  findRoomByQuery,
  splitRoomBuildingQuery,
  listActiveBuildings,
  matchBuildingByQuery,
  renderBuildingsList,
} = require('./catalog');

// =============================================================================
// Intent: list_my (prossime 5 prenotazioni dell'utente)
// =============================================================================
async function handleListMy({ user }) {
  const rows = await Booking.findAll({
    where: {
      userId: user.id,
      status: { [Op.in]: ['confirmed', 'pending_approval'] },
      endTime: { [Op.gt]: institutionTime.now() },
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
    const status = b.status === 'pending_approval' ? ' ⏳' : '';
    const roomName = mdSafe(b.room?.name ?? '?');
    const buildingName = b.room?.building ? ` (${mdSafe(b.room.building.name)})` : '';
    return `• #${b.id} — *${roomName}*${buildingName}\n   ${formatSlot(b.startTime, b.endTime)}${status}`;
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
  if (new Date(b.endTime) < institutionTime.now()) {
    return { intent: 'cancel', reply: `❌ La prenotazione #${id} è già terminata.` };
  }
  const cancelReason = reason ? String(reason).slice(0, 255) : 'Cancellata via bot';
  // Annullo condizionale (race con un altro /cancel o cambio stato concorrente)
  // + promozione esplicita della lista d'attesa nel ciclo di vita.
  const { cancelled } = await cancel({
    booking: b,
    reason: cancelReason,
    expectStatuses: ['confirmed', 'pending_approval'],
    onlyIf: { userId: user.id },
  });
  if (!cancelled) {
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
  const { start: dayStart, end: dayEnd } = dayBounds(day);
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
      reply: `✅ ${safeRoomName} è completamente libera ${dayLabelIso(day)}.`,
    };
  }
  const occupied = bookings.map((b) => formatTimeSpan(b.startTime, b.endTime)).join(', ');
  return {
    intent: 'check',
    reply: `📋 *${safeRoomName}* — ${dayLabelIso(day)}\n\nOccupata: ${occupied}\n\nIl resto dell'orario (08–20) è libero.`,
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

  const { start: dayStart, end: dayEnd } = dayBounds(day);
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

  const lines = [`📅 *Agenda · ${dayLabelIso(day, 'dddd D MMMM')}*`, ''];
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
          const span = formatTimeSpan(b.startTime, b.endTime);
          const pendBadge = b.status === 'pending_approval' ? ' ⏳' : '';
          const typeStr = b.type ? ` _${mdSafe(b.type)}_` : '';
          lines.push(`   ▸ ${span}${typeStr}${pendBadge}`);
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
    ({ start: windowStart, end: windowEnd } = rangeToInstants(day, timeRange));
  } else {
    ({ start: windowStart, end: windowEnd } = dayBounds(day));
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
  const dayLabel = dayLabelIso(day);
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

module.exports = {
  handleListMy,
  handleCancel,
  handleCheck,
  handleListRooms,
  handleAgenda,
  handleFreeRooms,
};
