'use strict';

/**
 * Servizio: rilevamento delle prenotazioni preesistenti che cadrebbero in
 * una BookingRuleException di tipo `block` — tipicamente festività, chiusure
 * sede, sospensioni didattiche.
 *
 * USE CASE
 *   L'admin sta per creare/aggiornare un'eccezione "block" (es. "Chiusura
 *   natalizia 23/12-7/1"). Le prenotazioni inserite *prima* di questo blocco
 *   non vengono cancellate automaticamente: quelle future cadrebbero in un
 *   periodo dichiarato chiuso ma resterebbero nell'agenda. Questo servizio
 *   le elenca e (con `cancelOverlappingBookings`) le cancella in batch con
 *   una motivazione tracciabile.
 *
 * SEMANTICA DEL MATCH (allineata a `bookingValidator.exceptionAppliesToDate`)
 *   - role: 'all' → tutte le prenotazioni di non-admin; ruolo specifico →
 *     solo quel ruolo. Gli admin sono sempre esclusi (coerente con la
 *     validazione: gli admin bypassano regole e quote).
 *   - dateFrom/dateTo (DATEONLY): finestra giornaliera; null = nessun limite.
 *   - daysOfWeek: array 0-6 (0=domenica). Vuoto/null = tutti i giorni.
 *   - startTime/endTime (HH:mm): finestra oraria *intra-giornaliera*. Una
 *     prenotazione conta se [bStart, bEnd) ha overlap con [winStart, winEnd).
 *     Null = giorno intero.
 *
 * Per kind='time_window' NON consideriamo overlap "storico": la finestra
 * limita le ore future ma non rende illegittime prenotazioni esistenti
 * sotto-soglia (sarebbe rumoroso e ambiguo). Solo `block`.
 */

const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { Booking, User, Room, Building, MonteOreSlot } = require('../models');

function parseHHmm(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Elenca le prenotazioni `confirmed` che cadrebbero nello scope dell'eccezione.
 *
 * @param {object} excDef  campi: role, kind, daysOfWeek, dateFrom, dateTo,
 *                         startTime, endTime
 * @param {object} opts    onlyFuture: se true, solo bookings con startTime > now
 * @returns {Promise<Array>}  array di Booking con user e room popolati
 */
async function findOverlappingBookings(excDef, { onlyFuture = true } = {}) {
  if (excDef.kind !== 'block') return [];

  const where = { status: 'confirmed' };

  // Range giornaliero: filtriamo a SQL le prenotazioni che potenzialmente
  // intersecano [dateFrom 00:00, dateTo 23:59:59]. Il controllo fine
  // (giorno-della-settimana + finestra oraria) è in JS perché dipende da
  // funzioni date/time non portabili tra dialetti (Postgres EXTRACT vs
  // SQLite strftime).
  if (excDef.dateFrom) {
    where.endTime = { [Op.gt]: dayjs(excDef.dateFrom).startOf('day').toDate() };
  }
  if (excDef.dateTo) {
    where.startTime = { [Op.lt]: dayjs(excDef.dateTo).endOf('day').toDate() };
  }
  if (onlyFuture) {
    const now = new Date();
    where.startTime = { ...(where.startTime || {}), [Op.gt]: now };
  }

  // Filtro per ruolo: 'all' = tutti i non-admin (gli admin bypassano
  // sempre le exception). Ruolo specifico = solo quel ruolo.
  const userWhere = excDef.role === 'all' ? { role: { [Op.ne]: 'admin' } } : { role: excDef.role };

  const bookings = await Booking.findAll({
    where,
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'role'],
        where: userWhere,
        required: true,
      },
      {
        model: Room,
        as: 'room',
        attributes: ['id', 'name'],
        include: [{ model: Building, as: 'building', attributes: ['id', 'name'] }],
      },
    ],
    order: [['startTime', 'ASC']],
  });

  // Filtro JS: daysOfWeek + finestra oraria.
  const dowSet =
    Array.isArray(excDef.daysOfWeek) && excDef.daysOfWeek.length > 0
      ? new Set(excDef.daysOfWeek.map(Number))
      : null;
  const winStart = excDef.startTime ? parseHHmm(excDef.startTime) : null;
  const winEnd = excDef.endTime ? parseHHmm(excDef.endTime) : null;

  return bookings.filter((b) => {
    const start = dayjs(b.startTime);
    const end = dayjs(b.endTime);
    if (dowSet && !dowSet.has(start.day())) return false;
    if (winStart != null && winEnd != null) {
      const sM = start.hour() * 60 + start.minute();
      const eM = end.hour() * 60 + end.minute();
      if (!(sM < winEnd && eM > winStart)) return false;
    }
    return true;
  });
}

/**
 * Cancella in batch (status='cancelled') tutte le prenotazioni overlap.
 * Solo prenotazioni FUTURE non ancora checked-in: le passate restano per
 * integrità storica, le checked-in sono "consumate" e cancellarle falserebbe
 * presenze e statistiche.
 */
async function cancelOverlappingBookings(excDef, { reason = null, transaction = null } = {}) {
  const overlapping = await findOverlappingBookings(excDef, { onlyFuture: true });
  const cancellable = overlapping.filter((b) => !b.checkedInAt);
  if (cancellable.length === 0) return { cancelled: 0, ids: [], monteOreSlotsSynced: 0 };

  const ids = cancellable.map((b) => b.id);
  const now = new Date();
  const cancelReason = reason
    ? `Periodo non prenotabile: ${reason}`
    : 'Cancellata da setup eccezione (block)';

  await Booking.update(
    { status: 'cancelled', cancelledAt: now, cancelReason },
    {
      where: { id: { [Op.in]: ids }, status: 'confirmed' },
      ...(transaction ? { transaction } : {}),
    },
  );

  // Sync con Monte Ore: gli slot che puntavano ai booking appena cancellati
  // vanno disattivati altrimenti il docente li vede ancora "pianificati"
  // nella griglia e una eventuale rigenerazione li ricreerebbe. Li
  // marchiamo anche `isLocked=true` con la motivazione del block così la
  // cella appare bloccata (non più cliccabile dal docente).
  // NB: funziona solo per bookings con slot.bookingId valorizzato — slot
  // creati prima dell'introduzione del link rimangono orfani: in tal caso
  // la rigenerazione esplicita del Monte Ore (che filtra per active+!locked)
  // ricreerebbe i booking, comportamento accettabile in via transitoria.
  const linkedSlots = await MonteOreSlot.findAll({
    where: { bookingId: { [Op.in]: ids } },
    ...(transaction ? { transaction } : {}),
  });
  // Update per-istanza: il bulk Model.update non carica i campi mancanti
  // dal DB e fa fallire il validatore `consistentBookingSource` (controlla
  // roomId+bookingType per slot fuori-pattern). Caricando ogni istanza
  // i campi esistenti restano valorizzati.
  for (const slot of linkedSlots) {
    await slot.update(
      {
        bookingId: null,
        isActive: false,
        isLocked: true,
        lockReason: (cancelReason || 'Bloccato').slice(0, 120),
      },
      transaction ? { transaction } : {},
    );
  }

  return { cancelled: ids.length, ids, monteOreSlotsSynced: linkedSlots.length };
}

module.exports = { findOverlappingBookings, cancelOverlappingBookings };
