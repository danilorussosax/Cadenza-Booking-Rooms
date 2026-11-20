'use strict';

/**
 * Tempo dell'istituto — unico punto che risponde a "che giorno/ora è per
 * il conservatorio?", indipendentemente dal fuso del processo (TZ del VPS).
 *
 * - Il fuso è letto UNA volta (env INSTITUTION_TZ, default 'Europe/Rome') e
 *   può essere riconfigurato con `configure({ timezone })`. Nessuna query DB.
 * - L'orologio è sostituibile: `setClock(...)` / `resetClock()` (orologio di
 *   sistema o orologio fisso per i test).
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const FALLBACK_TZ = 'Europe/Rome';

function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

let _tz = isValidTz(process.env.INSTITUTION_TZ) ? process.env.INSTITUTION_TZ : FALLBACK_TZ;

/** Fuso istituzionale corrente (IANA). */
function getTimezone() {
  return _tz;
}

/** Configurazione iniziale/override del fuso. Valore non valido → ignorato. */
function configure({ timezone: tz } = {}) {
  if (isValidTz(tz)) _tz = tz;
  return _tz;
}

// ---------- Orologio ----------

const systemClock = { now: () => new Date() };

/** Crea un orologio fisso (per i test). */
function fixedClock(at) {
  const fixed = new Date(at);
  if (Number.isNaN(fixed.getTime())) throw new Error('fixedClock: data non valida');
  return { now: () => new Date(fixed.getTime()) };
}

let _clock = systemClock;

/** Sostituisce l'orologio. Accetta { now() }, una funzione, o una data (→ fisso). */
function setClock(clock) {
  if (typeof clock === 'function') _clock = { now: () => new Date(clock()) };
  else if (clock && typeof clock.now === 'function') _clock = clock;
  else _clock = fixedClock(clock);
}

function resetClock() {
  _clock = systemClock;
}

/** Istante corrente secondo l'orologio attivo. */
function now() {
  return _clock.now();
}

// ---------- Helper ----------

/** Istante (Date|string|dayjs, default adesso) come dayjs nel fuso istituzionale. */
function inInstitute(at) {
  return dayjs(at === undefined || at === null ? now() : at).tz(_tz);
}

/** Data ISO 'YYYY-MM-DD' istituzionale di un istante (default: oggi). */
function todayIso(at) {
  return inInstitute(at).format('YYYY-MM-DD');
}

/** 'YYYY-MM-DD' + 'HH:MM' (ora istituzionale) → Date (istante). */
function atLocal(dateIso, hhmm = '00:00') {
  return dayjs.tz(`${String(dateIso).slice(0, 10)} ${hhmm}`, _tz).toDate();
}

/** 'HH:MM' istituzionale di un istante. */
function hhmmOf(at) {
  return inInstitute(at).format('HH:mm');
}

/** Inizio del giorno istituzionale che contiene `at` (default oggi) + offset giorni. */
function startOfDay(at, addDays = 0) {
  return inInstitute(at).add(addDays, 'day').startOf('day').toDate();
}

function endOfDay(at, addDays = 0) {
  return inInstitute(at).add(addDays, 'day').endOf('day').toDate();
}

function startOfIsoWeek(at) {
  return inInstitute(at).startOf('isoWeek').toDate();
}

function endOfIsoWeek(at) {
  return inInstitute(at).endOf('isoWeek').toDate();
}

/** Inizio/fine del mese di calendario istituzionale che contiene `at`. */
function startOfMonth(at) {
  return inInstitute(at).startOf('month').toDate();
}

function endOfMonth(at) {
  return inInstitute(at).endOf('month').toDate();
}

/** Ora locale istituzionale (0-23) di un istante. */
function hourOf(at) {
  return inInstitute(at).hour();
}

/** Minuti dalla mezzanotte istituzionale (0-1439) di un istante. */
function minutesOfDay(at) {
  const d = inInstitute(at);
  return d.hour() * 60 + d.minute();
}

/** Giorno della settimana istituzionale (0=domenica .. 6=sabato) di un istante. */
function dayOfWeek(at) {
  return inInstitute(at).day();
}

/**
 * Differenza in giorni di calendario istituzionali (dateOf(a) - dateOf(b)),
 * insensibile a DST e all'ora del giorno.
 */
function calendarDaysBetween(a, b) {
  return dayjs.utc(todayIso(a)).diff(dayjs.utc(todayIso(b)), 'day');
}

/**
 * Nome del fuso già quotato come literal SQL ('Europe/Rome'), da usare in
 * `AT TIME ZONE ${sqlTimezoneLiteral()}`. Il nome è validato da Intl; gli
 * apici vengono comunque raddoppiati per sicurezza.
 */
function sqlTimezoneLiteral() {
  return `'${_tz.replace(/'/g, "''")}'`;
}

/**
 * Input di API → istante. Una data pura 'YYYY-MM-DD' vale la mezzanotte
 * istituzionale di quel giorno (non quella del processo); altrimenti è un
 * normale istante. Assente → adesso. Non valido → Invalid Date.
 */
function toInstant(input) {
  if (input === undefined || input === null || input === '') return now();
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return atLocal(input);
  return new Date(input);
}

/** Anno accademico ('YYYY/YYYY+1', 1 nov → 31 ott) di un istante (default adesso). */
function academicYearOf(at) {
  const d = inInstitute(at);
  const year = d.year();
  return d.month() + 1 >= 11 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

module.exports = {
  getTimezone,
  configure,
  systemClock,
  fixedClock,
  setClock,
  resetClock,
  now,
  inInstitute,
  todayIso,
  atLocal,
  hhmmOf,
  startOfDay,
  endOfDay,
  startOfIsoWeek,
  endOfIsoWeek,
  startOfMonth,
  endOfMonth,
  hourOf,
  minutesOfDay,
  dayOfWeek,
  calendarDaysBetween,
  sqlTimezoneLiteral,
  toInstant,
  academicYearOf,
};
