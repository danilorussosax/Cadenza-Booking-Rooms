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

// IMPORTANTE su timezone:
// La libreria `ics` con default `startInputType: 'local'` interpreta l'array
// [Y,M,D,h,m] come "wall-clock nella TZ del PROCESSO Node" e lo converte
// in UTC (suffix Z) per il serializzato finale. Quindi `dayjs(d).hour()`
// (che ritorna l'ora nella TZ del processo) produce SEMPRE il risultato
// giusto, indipendentemente dalla TZ del server: su VPS UTC dayjs(12UTC)
// .hour()=12 → ics emette `T120000Z`; su Europe/Rome dayjs(12UTC).hour()=14
// → ics interpreta come 14:00 Roma e ri-converte a `T120000Z`. NON applicare
// `.tz(istituto)` qui: forzare una TZ diversa da quella del processo rompe
// la doppia conversione di ics e introduce uno shift di N ore.
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

// Raggruppa le prenotazioni in serie ricorrenti.
//
// Priorità 1 (ground-truth): booking che hanno `recurrenceId` valorizzato +
//   l'oggetto `recurrence` incluso → vengono raggruppati per recurrenceId e
//   l'RRULE viene emesso dalla regola esatta (DAILY/WEEKLY, INTERVAL, BYDAY,
//   UNTIL, EXDATE). Questo è il caso post-F2 (POST /bookings/recurring).
//
// Priorità 2 (euristica legacy): booking SENZA recurrenceId che vengono
//   riconosciuti per pattern (stessa room/orario/type, delta = 7 giorni).
//   Serve per i booking creati prima dell'introduzione della feature.
//
// I booking residui non aggregabili restano come VEVENT singoli.
function groupRecurrences(bookings) {
  const result = [];
  const consumed = new Set();

  // ─── Priorità 1: gruppi per recurrenceId (ground-truth) ────────────────
  const byRecurrence = new Map();
  for (const b of bookings) {
    if (!b.recurrenceId) continue;
    if (!byRecurrence.has(b.recurrenceId)) byRecurrence.set(b.recurrenceId, []);
    byRecurrence.get(b.recurrenceId).push(b);
  }
  for (const [, group] of byRecurrence) {
    group.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    const master = group[0];
    // Usa la regola esposta da Sequelize via include — se non c'è (es. il
    // chiamante non ha incluso 'recurrence') ricadi sull'euristica per quel
    // gruppo.
    const rule = master.recurrence;
    if (rule) {
      result.push({
        master,
        count: group.length,
        isRecurring: true,
        rule, // BookingRecurrence istanza con frequency/interval/byWeekday/endDate/excludeDates
      });
      for (const b of group) consumed.add(b.id);
    }
  }

  // ─── Priorità 2: euristica weekly su booking senza recurrenceId ────────
  return groupRecurrencesByHeuristic(bookings, result, consumed);
}

function groupRecurrencesByHeuristic(bookings, result, consumed) {
  const buckets = new Map();
  for (const b of bookings) {
    if (consumed.has(b.id)) continue; // già consumato da Priorità 1
    if (b.recurrenceId) continue; // ha già una serie ufficiale, skip euristica
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

/**
 * Costruisce la stringa RRULE da una BookingRecurrence (ground-truth).
 * Esempi:
 *   weekly 1 byWeekday=[MO,WE,FR] endDate=2026-12-31
 *     → FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;UNTIL=20261231T235959Z
 *   daily 2 endDate=2026-05-20
 *     → FREQ=DAILY;INTERVAL=2;UNTIL=20260520T235959Z
 */
function rruleFromRecurrence(rule) {
  const parts = [];
  parts.push(`FREQ=${rule.frequency.toUpperCase()}`);
  if (rule.interval && rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.frequency === 'weekly' && Array.isArray(rule.byWeekday) && rule.byWeekday.length > 0) {
    parts.push(`BYDAY=${rule.byWeekday.join(',')}`);
  }
  // UNTIL deve essere in UTC alla fine giornata
  const until = dayjs(rule.endDate).endOf('day');
  parts.push(`UNTIL=${until.format('YYYYMMDD')}T${until.format('HHmmss')}Z`);
  return parts.join(';');
}

function bookingToEvent(entry) {
  const { master, count, isRecurring, rule } = entry;
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
  if (isRecurring && rule) {
    // Caso 1 (post-F2): regola ground-truth. Emette RRULE preciso + EXDATE
    // per le date escluse (festività configurate dall'utente).
    event.recurrenceRule = rruleFromRecurrence(rule);
    if (Array.isArray(rule.excludeDates) && rule.excludeDates.length > 0) {
      // Le EXDATE in iCal usano lo stesso fuso/format del DTSTART. La libreria
      // `ics` non espone direttamente exdate ma accetta `exclusionDates` come
      // array di Date (gestite con la stessa logica TZ di start/end).
      event.exclusionDates = rule.excludeDates.map((iso) => {
        const d = dayjs(iso);
        return [
          d.year(),
          d.month() + 1,
          d.date(),
          dayjs(master.startTime).hour(),
          dayjs(master.startTime).minute(),
        ];
      });
    }
  } else if (isRecurring && count > 1) {
    // Caso 2 (legacy): solo euristica weekly → COUNT
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
