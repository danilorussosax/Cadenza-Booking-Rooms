'use strict';

/**
 * Servizio bookingSuggestions — genera alternative quando una richiesta di
 * prenotazione fallisce per conflitto (BOOKING_CONFLICT / EXCLUSION_VIOLATION).
 *
 * Strategie applicate in ordine deterministico:
 *   A1..A5  stessa aula, slot shiftato (+30, -30, +60, -60, +120 min)
 *   B1      stesso edificio, capacity >= richiesta, type compatibile, stesso orario
 *   C1..C2  stessa aula, +1g / +2g stesso orario (C2 solo se A*+B* < 3)
 *
 * Ogni candidato viene filtrato:
 *   - libero da overlap con altre booking confermate
 *   - aula `isBookable=true`
 *   - permessi utente (allowedRoles, allowedCourseIds)
 *   - validateBooking({bypassQuotas:false}) "leggero" — riusa la logica
 *     unica del validator per evitare drift di regole.
 *
 * Cap 5 risultati. Operazione read-only, nessun side-effect / audit.
 */

const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { Booking, Room } = require('../models');
const { validateBooking } = require('./bookingValidator');

const MAX_SUGGESTIONS = 5;

// Strategie A* — slot stessa aula, traslato per non sovrapporsi con la
// richiesta originale. "30 min dopo" = il nuovo slot inizia 30 minuti DOPO
// la fine della richiesta originale (così resta libero dal conflitto sullo
// stesso intervallo che ha generato il 409). Analogo per "before".
const SHIFT_OFFSETS = [
  { side: 'after', gap: 30, reason: 'same_room_shifted_30_after' },
  { side: 'before', gap: 30, reason: 'same_room_shifted_30_before' },
  { side: 'after', gap: 60, reason: 'same_room_shifted_60_after' },
  { side: 'before', gap: 60, reason: 'same_room_shifted_60_before' },
  { side: 'after', gap: 120, reason: 'same_room_shifted_120_after' },
];

// Strategia C: shift in giorni (mantengono stesso roomId e stesso orario).
const DAY_OFFSETS = [
  { days: 1, reason: 'same_room_next_day' },
  { days: 2, reason: 'same_room_two_days_later' },
];

/**
 * Genera fino a MAX_SUGGESTIONS alternative per uno slot conflittuale.
 *
 * @param {object} args
 * @param {number} args.roomId
 * @param {string|Date} args.startTime
 * @param {string|Date} args.endTime
 * @param {string|null} args.type
 * @param {object} args.user — utente per cui si valuta la prenotazione
 *                            (può essere il target di un on-behalf admin)
 * @returns {Promise<Array<{roomId, startTime, endTime, reason}>>}
 */
async function findAlternatives({ roomId, startTime, endTime, type, user }) {
  const start = dayjs(startTime);
  const end = dayjs(endTime);
  if (!start.isValid() || !end.isValid() || end.isSameOrBefore?.(start) || +end <= +start) {
    return [];
  }
  const durationMin = end.diff(start, 'minute');

  const sourceRoom = await Room.findByPk(roomId);
  if (!sourceRoom) return [];

  const suggestions = [];
  const seenKeys = new Set();
  const pushIfValid = async (candidate) => {
    if (suggestions.length >= MAX_SUGGESTIONS) return;
    const key = `${candidate.roomId}|${candidate.startTime.toISOString()}|${candidate.endTime.toISOString()}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const ok = await isCandidateValid({ candidate, type, user });
    if (ok) {
      suggestions.push({
        roomId: candidate.roomId,
        startTime: candidate.startTime.toISOString(),
        endTime: candidate.endTime.toISOString(),
        reason: candidate.reason,
      });
    }
  };

  // ---- A* stessa aula, orario shiftato ----
  // Cap intermedio a MAX_A: lasciamo posto ad almeno 1 suggerimento B* e
  // 1 C* anche quando le 5 strategie A* sarebbero tutte valide. Diversifica
  // il risultato (mix di "stessa aula altro orario" + "altra aula stesso
  // orario" + "stessa aula altro giorno"), evitando che 5 shift simili
  // saturino la UI.
  const MAX_A = 3;
  for (const off of SHIFT_OFFSETS) {
    if (suggestions.length >= MAX_A) break;
    let candStart;
    let candEnd;
    if (off.side === 'after') {
      candStart = end.add(off.gap, 'minute');
      candEnd = candStart.add(durationMin, 'minute');
    } else {
      candEnd = start.subtract(off.gap, 'minute');
      candStart = candEnd.subtract(durationMin, 'minute');
    }
    await pushIfValid({
      roomId: sourceRoom.id,
      startTime: candStart,
      endTime: candEnd,
      reason: off.reason,
    });
  }

  // ---- B1 aula simile stesso building/orario ----
  if (sourceRoom.buildingId != null) {
    const similar = await Room.findAll({
      where: {
        buildingId: sourceRoom.buildingId,
        isBookable: true,
        capacity: { [Op.gte]: sourceRoom.capacity ?? 1 },
        id: { [Op.ne]: sourceRoom.id },
      },
      attributes: ['id', 'name', 'capacity', 'type', 'allowedRoles', 'allowedCourseIds'],
      order: [
        ['capacity', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    for (const r of similar) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;
      // Tipologia compatibile: se la source ha un type, accettiamo solo
      // aule dello stesso type (es. studio↔studio). Senza vincolo type sui
      // candidati che non hanno una colonna type valorizzata.
      if (sourceRoom.type && r.type && sourceRoom.type !== r.type) continue;
      await pushIfValid({
        roomId: r.id,
        startTime: start,
        endTime: end,
        reason: 'similar_room_same_time',
      });
    }
  }

  // ---- C1/C2 stessa aula, +1g / +2g (C2 solo se totale corrente < 3) ----
  for (const off of DAY_OFFSETS) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    if (off.days === 2 && suggestions.length >= 3) continue;
    const candStart = start.add(off.days, 'day');
    const candEnd = candStart.add(durationMin, 'minute');
    await pushIfValid({
      roomId: sourceRoom.id,
      startTime: candStart,
      endTime: candEnd,
      reason: off.reason,
    });
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}

/**
 * Verifica se un candidato è effettivamente prenotabile dall'utente.
 * Combina:
 *  - controllo overlap rapido (Booking.findOne sullo stesso roomId)
 *  - validateBooking standard (regole/quote/finestre orarie/permessi)
 */
async function isCandidateValid({ candidate, type, user }) {
  // Quick overlap check (libera 80% dei candidati senza eseguire il
  // validator completo).
  const conflict = await Booking.findOne({
    where: {
      roomId: candidate.roomId,
      status: 'confirmed',
      [Op.and]: [
        { startTime: { [Op.lt]: candidate.endTime.toDate() } },
        { endTime: { [Op.gt]: candidate.startTime.toDate() } },
      ],
    },
    attributes: ['id'],
  });
  if (conflict) return false;

  // Validator completo (riusa rules, quote, finestre orarie, permessi).
  // bypassQuotas:false → se il candidato violerebbe una quota, lo escludiamo.
  // bypassAdvance:true perché il candidato è temporalmente vicino alla
  // richiesta originale già passata: i check min/maxAdvance si applicano
  // soprattutto al "futuro lontano", non a uno shift di ±2h o ±2 giorni.
  try {
    const validation = await validateBooking({
      user,
      roomId: candidate.roomId,
      startTime: candidate.startTime.toDate(),
      endTime: candidate.endTime.toDate(),
      type,
      bypassAdvance: true,
    });
    return validation.valid;
  } catch {
    return false;
  }
}

/**
 * Wrapper con hard timeout: se findAlternatives non risponde entro
 * `timeoutMs` (default 200), risolve con [] e logga warn. Pensato per essere
 * chiamato dal route handler: i suggerimenti sono "best effort", la response
 * 409 principale non deve mai degradarsi per loro.
 */
async function findAlternativesWithTimeout(params, { timeoutMs = 200 } = {}) {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const result = await Promise.race([findAlternatives(params).catch(() => null), timeoutPromise]);
    if (result === null) return [];
    return result;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  findAlternatives,
  findAlternativesWithTimeout,
  MAX_SUGGESTIONS,
  // export interno per testabilità
  _internal: { isCandidateValid, SHIFT_OFFSETS, DAY_OFFSETS },
};
