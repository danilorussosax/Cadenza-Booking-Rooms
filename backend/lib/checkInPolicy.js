'use strict';

/**
 * Policy di check-in / ghost-booking: UNICO modulo che possiede soglie e
 * finestra temporale. Interface:
 *   - thresholds()                  → { earlyMinutes, graceMinutes } (da lib/config)
 *   - windowFor(booking, now?)      → { opensAt, closesAt } (Date)
 *   - phaseFor(booking, now?)       → 'too_early' | 'open' | 'too_late'
 *   - candidateRange(now?)          → { from, to } per la lista del check-in
 *   - ghostCutoff(now?)             → Date: startTime < cutoff ⇒ finestra chiusa
 *   - isGhost(booking, now?)        → boolean (per lo sweep di auto-cancel)
 *   - isCheckInRequired(room, b?)   → boolean (cascata Room → Building)
 * Tutte pure: `now` è iniettabile (Date | number | dayjs), default = adesso.
 * Le soglie sono lette da lib/config.js (validate, con tetto), mai da process.env.
 */
const { getConfig } = require('./config');

const CANDIDATE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

function toMs(v) {
  if (v == null) return Date.now();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return new Date(typeof v.toISOString === 'function' ? v.toISOString() : v).getTime();
}

function thresholds() {
  const cfg = getConfig();
  return { earlyMinutes: cfg.CHECKIN_EARLY_MINUTES, graceMinutes: cfg.GHOST_GRACE_MINUTES };
}

function windowFor(booking) {
  const { earlyMinutes, graceMinutes } = thresholds();
  const start = toMs(booking.startTime);
  return {
    opensAt: new Date(start - earlyMinutes * MIN_MS),
    closesAt: new Date(start + graceMinutes * MIN_MS),
  };
}

function phaseFor(booking, now) {
  const t = toMs(now);
  const { opensAt, closesAt } = windowFor(booking);
  if (t < opensAt.getTime()) return 'too_early';
  if (t > closesAt.getTime()) return 'too_late';
  return 'open';
}

function ghostCutoff(now) {
  return new Date(toMs(now) - thresholds().graceMinutes * MIN_MS);
}

function candidateRange(now) {
  const t = toMs(now);
  return { from: ghostCutoff(t), to: new Date(t + CANDIDATE_LOOKAHEAD_MS) };
}

/**
 * Risolve se un'aula richiede il check-in QR.
 *
 * Modello dati (vedi migration 20260514083454-building-checkin-default):
 *   - `Building.checkInDefault` (boolean, default false) → impostazione
 *     generale per tutte le aule dell'edificio.
 *   - `Room.requireCheckIn` (boolean | null) →
 *       - null     → eredita Building.checkInDefault
 *       - true/false → override esplicito sull'aula
 *
 * Priorità:
 *   1. room.requireCheckIn esplicito (true/false) → vince sempre
 *   2. fallback: building.checkInDefault
 *   3. fallback ultimo: false (safer default: no check-in)
 *
 * @param {object|null} room      istanza Sequelize o oggetto plain con
 *                                `requireCheckIn` e (opzionale) `.building`.
 * @param {object|null} [building] opzionale, override del building (utile
 *                                quando l'aula è caricata senza include).
 * @returns {boolean}
 */
function isCheckInRequired(room, building = null) {
  if (room == null) return false;
  if (room.requireCheckIn === true) return true;
  if (room.requireCheckIn === false) return false;
  // null/undefined → eredita
  const b = building || room.building;
  return !!(b && b.checkInDefault);
}

/**
 * Prenotazione "fantasma": confermata, mai check-in-ata, non già auto-cancellata,
 * finestra di check-in chiusa e aula con check-in richiesto.
 * `booking.room` (con eventuale `.building`) deve essere caricato.
 */
function isGhost(booking, now) {
  if (booking.status !== 'confirmed') return false;
  if (booking.checkedInAt || booking.autoCancelledAt) return false;
  if (phaseFor(booking, now) !== 'too_late') return false;
  return isCheckInRequired(booking.room);
}

module.exports = {
  isCheckInRequired,
  thresholds,
  windowFor,
  phaseFor,
  candidateRange,
  ghostCutoff,
  isGhost,
};
