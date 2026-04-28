'use strict';

const dayjs = require('dayjs');
const ics = require('ics');

const TYPE_LABEL = {
  studio_individuale: 'Studio',
  lezione: 'Lezione',
  prova: 'Prova',
  concerto: 'Concerto',
  altro: 'Prenotazione',
};

const APP_DOMAIN = 'cadenza.local';

function toIcsArray(d) {
  const m = dayjs(d);
  return [m.year(), m.month() + 1, m.date(), m.hour(), m.minute()];
}

function bookingSummary(b) {
  const room = b.room?.name || 'Aula';
  const type = TYPE_LABEL[b.type] || 'Prenotazione';
  return `${room} · ${type}`;
}

function bookingLocation(b) {
  const r = b.room;
  if (!r) return '';
  const parts = [r.building?.name, r.floor, r.name].filter(Boolean);
  return parts.join(' - ');
}

function bookingDescription(b) {
  const lines = [];
  if (b.purpose) lines.push(b.purpose);
  if (b.notes) lines.push(b.notes);
  return lines.join('\n');
}

// Raggruppa le prenotazioni in serie ricorrenti con cadenza settimanale fissa.
// Una serie richiede: stessa room, stesso type, stessa fascia oraria (HH:mm),
// stesso purpose, almeno 2 occorrenze, con tutti i delta tra date di start
// multipli esatti di 7 giorni (1, 2, 3, … settimane). Solo cadenza settimanale
// pura (FREQ=WEEKLY;INTERVAL=1) viene riconosciuta — euristica conservativa.
function groupRecurrences(bookings) {
  const buckets = new Map();
  for (const b of bookings) {
    const start = dayjs(b.startTime);
    const end = dayjs(b.endTime);
    const key = [
      b.roomId,
      b.type || '',
      b.purpose || '',
      start.format('HH:mm'),
      end.format('HH:mm'),
      end.diff(start, 'minute'),
    ].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(b);
  }

  const result = []; // { master: Booking, count: number, isRecurring: bool }
  const consumed = new Set();

  for (const [, group] of buckets) {
    if (group.length < 2) continue;
    group.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    const deltas = [];
    for (let i = 1; i < group.length; i++) {
      const d = dayjs(group[i].startTime).diff(dayjs(group[i - 1].startTime), 'day');
      deltas.push(d);
    }
    // Cadenza settimanale uniforme: tutti i delta = 7
    const allWeekly = deltas.length > 0 && deltas.every((d) => d === 7);
    if (allWeekly) {
      result.push({ master: group[0], count: group.length, isRecurring: true });
      for (const b of group) consumed.add(b.id);
    }
  }

  // Le prenotazioni singole (non riconosciute come ricorrenti)
  for (const b of bookings) {
    if (!consumed.has(b.id)) {
      result.push({ master: b, count: 1, isRecurring: false });
    }
  }
  return result;
}

function bookingToEvent(entry) {
  const { master, count, isRecurring } = entry;
  const event = {
    uid: `booking-${master.id}@${APP_DOMAIN}`,
    title: bookingSummary(master),
    location: bookingLocation(master),
    description: bookingDescription(master),
    start: toIcsArray(master.startTime),
    end: toIcsArray(master.endTime),
    productId: 'cadenza/ics',
    calName: 'Cadenza',
    status: 'CONFIRMED',
  };
  if (isRecurring && count > 1) {
    // RRULE settimanale per `count` occorrenze totali
    event.recurrenceRule = `FREQ=WEEKLY;COUNT=${count};INTERVAL=1`;
  }
  return event;
}

/**
 * Costruisce il body iCal a partire da una lista di Booking (Sequelize) con room.building incluso.
 * Restituisce stringa pronta da inviare con Content-Type: text/calendar.
 */
function buildIcs(bookings, opts = {}) {
  const calName = opts.calName || 'Cadenza';
  const grouped = groupRecurrences(bookings);
  const events = grouped.map(bookingToEvent);

  if (events.length === 0) {
    // ICS vuoto valido (alcuni client si lamentano se manca VEVENT, ma è accettato dai principali)
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//cadenza//IT',
      `X-WR-CALNAME:${calName}`,
      'METHOD:PUBLISH',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
  }

  const { error, value } = ics.createEvents(events);
  if (error || !value) {
    throw error || new Error('Errore generazione iCal');
  }
  return value;
}

module.exports = { buildIcs };
