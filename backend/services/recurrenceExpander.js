'use strict';

/**
 * Espansione di una regola di ricorrenza in lista di occorrenze (Date pairs).
 *
 * Pattern: RRULE semplificato MRBS-style. Frequencies supportati:
 *   - 'daily'  → ogni N giorni (interval)
 *   - 'weekly' → ogni N settimane (interval) + byWeekday opzionale
 *
 * Volutamente NO 'monthly'/'yearly' al momento: il caso d'uso conservatorio
 * è dominato da lezioni settimanali. Aggiungere monthly richiederebbe
 * gestione di edge cases (es. "31° giorno del mese" in febbraio) che non
 * paga la complessità extra.
 *
 * Vincoli applicati:
 *   - max MAX_OCCURRENCES (52) per serie → 1 anno di settimane
 *   - max MAX_RANGE_DAYS (366) tra startDate e endDate
 *   - interval 1..12
 *
 * Le occorrenze sono ritornate come `{ startTime: Date, endTime: Date }`
 * combinando la DATA della regola con l'ORA passata in `templateStartTime`/
 * `templateEndTime` (presi dal Booking template della UI).
 */

const dayjs = require('dayjs');

const MAX_OCCURRENCES = 52;
const MAX_RANGE_DAYS = 366;

// Mappa codici ISO weekday → indice dayjs (0=Sunday, 1=Monday, ..., 6=Saturday)
const WEEKDAY_TO_INDEX = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

class RecurrenceError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * Valida una recurrence rule + ritorna i parametri normalizzati.
 * Lancia RecurrenceError con `code` per UX backend → frontend.
 */
function validateRule({ frequency, interval, byWeekday, startDate, endDate, excludeDates }) {
  if (!['daily', 'weekly'].includes(frequency)) {
    throw new RecurrenceError(
      `Frequency non supportata: ${frequency}`,
      'RECURRENCE_FREQUENCY_INVALID',
    );
  }
  const intervalNum = Number(interval) || 1;
  if (intervalNum < 1 || intervalNum > 12) {
    throw new RecurrenceError(
      'Interval deve essere compreso tra 1 e 12',
      'RECURRENCE_INTERVAL_INVALID',
    );
  }
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  if (!start.isValid() || !end.isValid()) {
    throw new RecurrenceError('startDate o endDate non valida', 'RECURRENCE_DATE_INVALID');
  }
  if (end.isBefore(start, 'day')) {
    throw new RecurrenceError(
      'endDate deve essere uguale o successiva a startDate',
      'RECURRENCE_DATE_RANGE_INVALID',
    );
  }
  if (end.diff(start, 'day') > MAX_RANGE_DAYS) {
    throw new RecurrenceError(
      `Range troppo ampio (max ${MAX_RANGE_DAYS} giorni)`,
      'RECURRENCE_DATE_RANGE_TOO_LONG',
    );
  }
  // byWeekday significativo solo per weekly
  let normalizedWeekdays = null;
  if (frequency === 'weekly') {
    if (Array.isArray(byWeekday) && byWeekday.length > 0) {
      for (const w of byWeekday) {
        if (!(w in WEEKDAY_TO_INDEX)) {
          throw new RecurrenceError(
            `byWeekday contiene codice non valido: ${w}`,
            'RECURRENCE_WEEKDAY_INVALID',
          );
        }
      }
      normalizedWeekdays = [...new Set(byWeekday)];
    } else {
      // Se non specificato, usa il weekday di startDate
      const w = Object.keys(WEEKDAY_TO_INDEX).find((k) => WEEKDAY_TO_INDEX[k] === start.day());
      normalizedWeekdays = [w];
    }
  }
  // excludeDates: array di YYYY-MM-DD
  const exclSet = new Set();
  if (Array.isArray(excludeDates)) {
    for (const d of excludeDates) {
      const dd = dayjs(d);
      if (!dd.isValid()) {
        throw new RecurrenceError(
          `excludeDates contiene data non valida: ${d}`,
          'RECURRENCE_EXCLUDE_INVALID',
        );
      }
      exclSet.add(dd.format('YYYY-MM-DD'));
    }
  }

  return {
    frequency,
    interval: intervalNum,
    byWeekday: normalizedWeekdays,
    startDate: start.format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
    excludeDates: [...exclSet],
  };
}

/**
 * Espande la regola in lista di DATE (YYYY-MM-DD) attive.
 * Applica excludeDates ed il cap MAX_OCCURRENCES.
 */
function expandDates(rule) {
  const out = [];
  const excluded = new Set(rule.excludeDates);
  let cursor = dayjs(rule.startDate);
  const end = dayjs(rule.endDate);

  if (rule.frequency === 'daily') {
    while (!cursor.isAfter(end, 'day')) {
      const iso = cursor.format('YYYY-MM-DD');
      if (!excluded.has(iso)) out.push(iso);
      if (out.length >= MAX_OCCURRENCES) break;
      cursor = cursor.add(rule.interval, 'day');
    }
  } else if (rule.frequency === 'weekly') {
    // Set indici dei weekday attivi (0..6 con 0=dom)
    const activeDays = new Set(rule.byWeekday.map((w) => WEEKDAY_TO_INDEX[w]));
    // Parto dalla settimana di startDate. Ogni "interval" settimane scansiono
    // i 7 giorni e prendo quelli in activeDays.
    let weekStart = cursor.startOf('week'); // domenica di default in dayjs
    while (!weekStart.isAfter(end, 'day')) {
      for (let d = 0; d < 7; d++) {
        const day = weekStart.add(d, 'day');
        if (day.isBefore(cursor, 'day')) continue; // skip giorni prima di startDate
        if (day.isAfter(end, 'day')) break;
        if (!activeDays.has(day.day())) continue;
        const iso = day.format('YYYY-MM-DD');
        if (!excluded.has(iso)) out.push(iso);
        if (out.length >= MAX_OCCURRENCES) return out;
      }
      weekStart = weekStart.add(rule.interval, 'week');
    }
  }

  return out;
}

/**
 * Espande la regola in array di occorrenze `{ startTime, endTime }`.
 *
 * @param {object} rule  La regola validata da `validateRule()`.
 * @param {string} templateStartTime  ISO string del Booking template (es. "2026-05-13T10:00:00Z").
 *                                    Usato SOLO per ora/minuti (la data viene dalla regola).
 * @param {string} templateEndTime    Idem per l'orario di fine.
 * @returns {Array<{ startTime: Date, endTime: Date }>}
 */
function expandOccurrences(rule, templateStartTime, templateEndTime) {
  const dates = expandDates(rule);
  const t0 = dayjs(templateStartTime);
  const t1 = dayjs(templateEndTime);
  if (!t0.isValid() || !t1.isValid()) {
    throw new RecurrenceError(
      'templateStartTime/templateEndTime non validi',
      'RECURRENCE_TEMPLATE_TIME_INVALID',
    );
  }
  if (!t1.isAfter(t0)) {
    throw new RecurrenceError(
      'templateEndTime deve essere posteriore a templateStartTime',
      'RECURRENCE_TEMPLATE_TIME_INVALID',
    );
  }
  const startHour = t0.hour();
  const startMinute = t0.minute();
  const endHour = t1.hour();
  const endMinute = t1.minute();
  // Se l'evento finisce il giorno dopo dell'inizio (es. 23:30 → 00:30), aggiungo 1 giorno
  const crossesMidnight = t1.isAfter(t0.endOf('day'));

  return dates.map((iso) => {
    const d = dayjs(iso);
    const startTime = d.hour(startHour).minute(startMinute).second(0).millisecond(0).toDate();
    let endDay = d;
    if (crossesMidnight) endDay = endDay.add(1, 'day');
    const endTime = endDay.hour(endHour).minute(endMinute).second(0).millisecond(0).toDate();
    return { startTime, endTime };
  });
}

module.exports = {
  validateRule,
  expandDates,
  expandOccurrences,
  RecurrenceError,
  MAX_OCCURRENCES,
  MAX_RANGE_DAYS,
  WEEKDAY_TO_INDEX,
};
