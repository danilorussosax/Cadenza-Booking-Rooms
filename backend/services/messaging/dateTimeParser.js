'use strict';

// =============================================================================
// Parser puro di giorni e fasce orarie del bot. Nessun accesso al DB.
//
// Le date sono stringhe ISO 'YYYY-MM-DD' (giorno di calendario dell'istituto,
// senza fuso). La conversione in istanti passa SEMPRE da lib/institutionTime,
// così il risultato non dipende dal TZ del processo.
// =============================================================================

const institutionTime = require('../../lib/institutionTime');

// Format orari accettati nel parser:
//   "14:00-15:00", "14-15", "14:00", "9-10:30"
const TIME_RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/;

// Mappa giorni IT → isoWeekday
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

const DATE_FORMATS = [
  { re: /^(\d{4})-(\d{2})-(\d{2})$/, order: [1, 2, 3] },
  { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: [3, 2, 1] },
  { re: /^(\d{2})-(\d{2})-(\d{4})$/, order: [3, 2, 1] },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: [3, 2, 1] },
  { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: [3, 2, 1] },
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Istante UTC "mezzogiorno" del giorno ISO: evita ogni deriva da fuso/DST. */
function utcNoon(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Somma `n` giorni a una data ISO. */
function addDaysIso(iso, n) {
  const d = utcNoon(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Giorno della settimana ISO (1 = lunedì … 7 = domenica) di una data ISO. */
function isoWeekdayOf(iso) {
  const wd = utcNoon(iso).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/**
 * Parsa una "data" in 'YYYY-MM-DD' (giorno istituzionale). Accetta:
 *   - "oggi", "domani"
 *   - nomi giorno IT ("ven", "venerdì") → prossima occorrenza (oggi incluso)
 *   - "YYYY-MM-DD" / "DD/MM/YYYY" / "DD-MM-YYYY" / "D/M/YYYY" / "D-M-YYYY"
 * `todayIso` è iniettabile per i test; default: oggi secondo institutionTime.
 * @returns {string|null}
 */
function parseDayQuery(s, todayIso = institutionTime.todayIso()) {
  const term = String(s || '')
    .trim()
    .toLowerCase();
  if (!term) return null;
  if (term === 'oggi') return todayIso;
  if (term === 'domani') return addDaysIso(todayIso, 1);
  if (DAY_NAMES[term]) {
    const target = DAY_NAMES[term];
    let d = todayIso;
    while (isoWeekdayOf(d) !== target) d = addDaysIso(d, 1);
    return d;
  }
  for (const { re, order } of DATE_FORMATS) {
    const m = term.match(re);
    if (!m) continue;
    const y = Number(m[order[0]]);
    const mo = Number(m[order[1]]);
    const d = Number(m[order[2]]);
    const iso = `${String(y).padStart(4, '0')}-${pad2(mo)}-${pad2(d)}`;
    // Validazione calendario (rifiuta 2026-02-31)
    if (mo >= 1 && mo <= 12 && d >= 1 && addDaysIso(iso, 0) === iso) return iso;
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

/** Giorno ISO + fascia → { start, end } come Date (ora istituzionale). */
function rangeToInstants(dayIso, range) {
  return {
    start: institutionTime.atLocal(dayIso, `${pad2(range.startH)}:${pad2(range.startM)}`),
    end: institutionTime.atLocal(dayIso, `${pad2(range.endH)}:${pad2(range.endM)}`),
  };
}

/** Estremi [inizio, fine] del giorno istituzionale ISO come Date. */
function dayBounds(dayIso) {
  const start = institutionTime.atLocal(dayIso, '00:00');
  return { start, end: institutionTime.endOfDay(start) };
}

module.exports = {
  TIME_RANGE_RE,
  parseDayQuery,
  parseTimeRange,
  rangeToInstants,
  dayBounds,
  addDaysIso,
  pad2,
};
