'use strict';

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

module.exports = { isCheckInRequired };
