'use strict';

/**
 * Regole PURE di validazione prenotazioni: nessun accesso al DB, nessun orologio
 * implicito. Ogni regola riceve istanti e `rule` già caricata e restituisce un
 * array di problemi strutturati `{ message, code }` (vuoto = ok).
 *
 * Giorno/ora "locali" sono sempre quelli dell'istituto (lib/institutionTime),
 * mai quelli del fuso del processo. `bookingValidator.validateBooking` si
 * occupa dei lookup (stanza, regole, conflitti, quote) e compone queste regole.
 */

const dayjs = require('dayjs');
const institutionTime = require('../lib/institutionTime');

// Floor aggiuntivo per lo "studio individuale" (richiesto dal direttivo per
// evitare frammentazione delle aule in slot troppo brevi): si somma al minimo
// generico per ruolo (BookingRule.minBookingDurationMinutes).
const STUDIO_MIN_DURATION_MINUTES = 60;

const issue = (message, code = null) => ({ message, code });

function parseHHmm(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
}

/** La fine deve essere successiva all'inizio. */
function endAfterStartIssues(start, end) {
  return dayjs(end).isAfter(dayjs(start))
    ? []
    : [issue("L'orario di fine deve essere successivo a quello di inizio")];
}

/** Non si prenota nel passato (salvo bypass). */
function notInPastIssues(start, now, { bypassPastDates = false } = {}) {
  if (bypassPastDates) return [];
  return dayjs(start).isBefore(dayjs(now)) ? [issue('Non puoi prenotare nel passato')] : [];
}

/** Durata min/max per ruolo + floor dello studio individuale. */
function durationIssues({ durationMin, rule, type = null, bypassDuration = false }) {
  if (bypassDuration) return [];
  const out = [];
  if (durationMin < rule.minBookingDurationMinutes) {
    out.push(issue(`Durata minima prenotazione: ${rule.minBookingDurationMinutes} minuti`));
  }
  if (durationMin > rule.maxBookingDurationMinutes) {
    out.push(issue(`Durata massima prenotazione: ${rule.maxBookingDurationMinutes} minuti`));
  }
  if (type === 'studio_individuale' && durationMin < STUDIO_MIN_DURATION_MINUTES) {
    out.push(
      issue(`Durata minima per lo studio individuale: ${STUDIO_MIN_DURATION_MINUTES} minuti`),
    );
  }
  return out;
}

/** Anticipo massimo (giorni di calendario istituzionali) e minimo (ore). */
function advanceIssues({ start, now, rule, bypassAdvance = false }) {
  if (bypassAdvance) return [];
  const out = [];
  const daysAhead = institutionTime.calendarDaysBetween(start, now);
  if (daysAhead > rule.maxAdvanceDays) {
    out.push(issue(`Puoi prenotare al massimo con ${rule.maxAdvanceDays} giorni di anticipo`));
  }
  const hoursAhead = dayjs(start).diff(dayjs(now), 'hour', true);
  if (hoursAhead < rule.minAdvanceHours) {
    out.push(issue(`Devi prenotare almeno ${rule.minAdvanceHours} ore prima dell'inizio`));
  }
  return out;
}

/**
 * Fascia oraria consentita: rule.allowedStartTime/EndTime ("08:00") sono ore
 * locali dell'istituto. Una fine a mezzanotte (0 minuti) è sempre accettata.
 */
function allowedWindowIssues({ start, end, rule }) {
  if (!rule.allowedStartTime || !rule.allowedEndTime) return [];
  const startMins = institutionTime.minutesOfDay(start);
  const endMins = institutionTime.minutesOfDay(end);
  const allowedStart = parseHHmm(rule.allowedStartTime);
  const allowedEnd = parseHHmm(rule.allowedEndTime);
  if (startMins < allowedStart || (endMins > allowedEnd && endMins !== 0)) {
    return [
      issue(
        `Le prenotazioni sono consentite solo dalle ${rule.allowedStartTime} alle ${rule.allowedEndTime}`,
      ),
    ];
  }
  return [];
}

// ---------- Eccezioni / finestre HH:mm ----------

/** L'eccezione si applica al giorno (istituzionale) della prenotazione? */
function exceptionAppliesToDate(exception, at) {
  if (
    Array.isArray(exception.daysOfWeek) &&
    exception.daysOfWeek.length > 0 &&
    !exception.daysOfWeek.includes(institutionTime.dayOfWeek(at))
  ) {
    return false;
  }
  const day = institutionTime.todayIso(at);
  if (exception.dateFrom && day < exception.dateFrom) return false;
  if (exception.dateTo && day > exception.dateTo) return false;
  return true;
}

/**
 * [start,end] si sovrappone alla finestra HH:mm (ora istituzionale)?
 * Finestra assente → copre tutto il giorno.
 */
function overlapsWindow(start, end, winStart, winEnd) {
  if (!winStart || !winEnd) return true;
  const s = institutionTime.minutesOfDay(start);
  const e = institutionTime.minutesOfDay(end);
  return s < parseHHmm(winEnd) && e > parseHHmm(winStart);
}

/** Minuti di [start,end] che cadono dentro la finestra HH:mm istituzionale. */
function minutesInsideWindow(start, end, winStart, winEnd) {
  const sM = institutionTime.minutesOfDay(start);
  const eM = institutionTime.minutesOfDay(end);
  const ws = winStart ? parseHHmm(winStart) : 0;
  const we = winEnd ? parseHHmm(winEnd) : 24 * 60;
  return Math.max(0, Math.min(eM, we) - Math.max(sM, ws));
}

module.exports = {
  STUDIO_MIN_DURATION_MINUTES,
  issue,
  parseHHmm,
  endAfterStartIssues,
  notInPastIssues,
  durationIssues,
  advanceIssues,
  allowedWindowIssues,
  exceptionAppliesToDate,
  overlapsWindow,
  minutesInsideWindow,
};
