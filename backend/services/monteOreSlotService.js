'use strict';

/**
 * Monte Ore — espansione pattern (Sezione A) → slot griglia (Sezione B).
 *
 * La rigenerazione conserva gli ID e le selezioni delle occorrenze ancora valide.
 * Le nuove date sono inattive; la rimozione di date attive richiede conferma.
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

// Slot date sono YYYY-MM-DD (Europe/Rome). Senza tz esplicito un VPS UTC
// produce Date sfasate di 1-2h e il findOne per cancellare il Booking
// originale non lo trova mai (orfani in DB).
const DEFAULT_TZ = 'Europe/Rome';
const {
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSlot,
  MonteOreSettings,
  MonteOreSuspension,
} = require('../models');
const { computeWeeks } = require('./monteOreCalendarService');

async function getActiveSettings(academicYear, instituteId = null) {
  const where = { academicYear };
  if (instituteId) where.instituteId = instituteId;
  return MonteOreSettings.findOne({ where });
}

async function getSuspensions(academicYear, instituteId = null) {
  const where = { academicYear };
  if (instituteId) where.instituteId = instituteId;
  return MonteOreSuspension.findAll({ where });
}

/**
 * Rigenera gli slot di una proposta a partire dai pattern (MonteOreSchedule)
 * e dal calendario didattico (settings + suspensions).
 *
 * Ritorna { created, locked, total }.
 */
async function regenerateSlotsFromPattern(
  proposalId,
  { transaction = null, confirmRemoval = false } = {},
) {
  const tx = transaction ? { transaction } : {};
  const proposal = await MonteOreProposal.findByPk(proposalId, {
    include: [{ model: MonteOreSchedule, as: 'schedules' }],
    ...tx,
  });
  if (!proposal) throw new Error('Proposta non trovata');

  // Cerca settings dell'AA della proposta
  const settings = await getActiveSettings(proposal.academicYear);
  if (!settings) throw new Error(`Settings monte ore mancanti per AA ${proposal.academicYear}`);
  const suspensions = await getSuspensions(proposal.academicYear, settings.instituteId);
  const weeks = computeWeeks(settings, suspensions);

  const previous = await MonteOreSlot.findAll({ where: { proposalId }, ...tx });
  const existing = new Map(previous.map((s) => [`${s.scheduleId}:${s.date}`, s]));
  const desired = new Set();
  let locked = 0;
  let created = 0;
  const payloads = [];
  for (const sched of proposal.schedules) {
    for (const week of weeks) {
      const day = week.days.find((d) => d.dayOfWeek === sched.dayOfWeek);
      if (!day || day.date < proposal.validFrom || day.date > proposal.validTo) continue;
      const key = `${sched.id}:${day.date}`;
      desired.add(key);
      const old = existing.get(key);
      const values = {
        proposalId,
        scheduleId: sched.id,
        date: day.date,
        dayOfWeek: day.dayOfWeek,
        startTime: sched.startTime,
        endTime: sched.endTime,
        isLocked: day.isLocked,
        lockReason: day.lockReason,
        isActive: day.isLocked ? false : old?.isActive || false,
        originalActive: old?.originalActive || false,
      };
      payloads.push({ old, values });
      if (day.isLocked) locked++;
      else created++;
    }
  }
  const removed = previous.filter((s) => !desired.has(`${s.scheduleId}:${s.date}`));
  const lost = removed.filter((s) => s.isActive);
  if (lost.length && !confirmRemoval) {
    return {
      created: 0,
      locked: 0,
      total: previous.length,
      requiresConfirmation: true,
      removedActive: lost.map((s) => ({
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    };
  }
  for (const { old, values } of payloads) {
    if (old) await old.update(values, tx);
    else await MonteOreSlot.create(values, tx);
  }
  if (removed.length)
    await MonteOreSlot.destroy({ where: { id: removed.map((s) => s.id) }, ...tx });

  // Aggiorna conteggi sulla proposta (dentro la stessa tx)
  await recomputeTotals(proposalId, { transaction });

  return { created, locked, total: created + locked };
}

/**
 * Ricalcola `totalHoursPlanned` sommando le ore degli slot attivi.
 */
async function recomputeTotals(proposalId, { transaction = null } = {}) {
  const tx = transaction ? { transaction } : {};
  const slots = await MonteOreSlot.findAll({
    where: { proposalId, isActive: true, isLocked: false },
    ...tx,
  });
  const totalMinutes = slots.reduce((acc, s) => {
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    return acc + (eh * 60 + em - sh * 60 - sm);
  }, 0);
  const totalHours = totalMinutes / 60;
  await MonteOreProposal.update(
    { totalHoursPlanned: totalHours },
    { where: { id: proposalId }, ...tx },
  );
  return totalHours;
}

/**
 * Toggle dello stato `isActive` di un singolo slot (cliccando una cella
 * nella griglia). Restituisce lo slot aggiornato e il nuovo totale ore.
 *
 * Se la proposta è in stato 'approved' o 'generated', il toggle NON viene
 * applicato direttamente: deve passare per `MonteOreAmendment` (gestito
 * dal route handler, non da questo service).
 */
async function toggleSlot(slotId, { force = false, transaction = null } = {}) {
  const tx = transaction ? { transaction } : {};
  const slot = await MonteOreSlot.findByPk(slotId, { ...tx });
  if (!slot) throw new Error('Slot non trovato');
  if (slot.isLocked && !force) {
    const e = new Error('Questa cella è bloccata (festività/sospensione)');
    e.code = 'SLOT_LOCKED';
    throw e;
  }
  await slot.update({ isActive: !slot.isActive }, { transaction });
  await recomputeTotals(slot.proposalId, { transaction });
  return slot;
}

/**
 * Sincronizza il Booking corrispondente quando uno slot viene toggle-ato
 * in stato 'generated'. Logica:
 *   - se isActive passa da true a false: cancella il Booking ricorrente
 *     (status='cancelled', preserva l'id in generatedBookingIds per il
 *     re-link futuro)
 *   - se isActive passa da false a true: ricrea il Booking via
 *     validateBooking + Booking.create (riusando i bypass admin del
 *     generator monte ore)
 *
 * Lo slot deve essere già stato aggiornato (isActive nuovo) prima della
 * chiamata; questo helper guarda all'isActive corrente per decidere.
 *
 * Ritorna { affectedBookingId, action: 'cancelled'|'created'|'noop' }.
 */
async function syncBookingForSlot(slotId, { actorUser, transaction = null } = {}) {
  const tx = transaction ? { transaction } : {};
  const { Booking, MonteOreSchedule } = require('../models');
  const { validateBooking } = require('./bookingValidator');

  const slot = await MonteOreSlot.findByPk(slotId, { ...tx });
  if (!slot) return { action: 'noop', reason: 'slot_not_found' };
  const proposal = await MonteOreProposal.findByPk(slot.proposalId, { ...tx });
  if (!proposal || proposal.status !== 'generated') {
    return { action: 'noop', reason: 'proposal_not_generated' };
  }

  // Origine info booking: lo schedule (slot dentro pattern) oppure i campi
  // sullo slot stesso (slot fuori pattern, nato da amendment add_new_day).
  //
  // Sullo schedule prendiamo un row-lock (SELECT FOR UPDATE in Postgres) per
  // serializzare le append concorrenti su `generatedBookingIds`: senza lock
  // due toggle simultanei leggerebbero lo stesso array, ognuno aggiungerebbe
  // il proprio id e l'ultimo write vincerebbe perdendo l'altro id.
  //
  // Override individuale (change_room): se slot.roomId/bookingType sono
  // valorizzati ANCHE per uno slot in-pattern, vincono sullo schedule.
  // Questo permette di sostituire l'aula di una singola occorrenza senza
  // toccare il pattern (= senza propagare a tutte le altre settimane).
  let roomId, bookingType, purpose, notes;
  let schedule = null;
  if (slot.scheduleId) {
    schedule = await MonteOreSchedule.findByPk(slot.scheduleId, {
      ...tx,
      ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
    });
    if (!schedule) return { action: 'noop', reason: 'schedule_not_found' };
    roomId = slot.roomId ?? schedule.roomId;
    bookingType = slot.bookingType ?? schedule.bookingType;
    purpose = slot.purpose ?? schedule.purpose ?? null;
    notes = schedule.notes || null;
  } else {
    if (!slot.roomId || !slot.bookingType) {
      return { action: 'noop', reason: 'slot_missing_room_or_type' };
    }
    roomId = slot.roomId;
    bookingType = slot.bookingType;
    purpose = slot.purpose || null;
    notes = null;
  }

  const dateIso = dayjs(slot.date).format('YYYY-MM-DD');
  const startTime = dayjs.tz(`${dateIso} ${slot.startTime}`, DEFAULT_TZ).toDate();
  const endTime = dayjs.tz(`${dateIso} ${slot.endTime}`, DEFAULT_TZ).toDate();

  if (slot.isActive) {
    // Caso "toggle_on" → ricrea il Booking se non esiste già
    // Cerca booking esistente attivo che combaci (potrebbe essere un orfano)
    const existing = await Booking.findOne({
      where: {
        userId: proposal.userId,
        roomId,
        startTime,
        status: 'confirmed',
      },
      ...tx,
    });
    if (existing)
      return { action: 'noop', reason: 'already_exists', affectedBookingId: existing.id };
    const validation = await validateBooking({
      user: await require('../models').User.findByPk(proposal.userId, { ...tx }),
      roomId,
      startTime,
      endTime,
      type: bookingType,
      bypassQuotas: !!actorUser && actorUser.role === 'admin',
      bypassAdvance: !!actorUser && actorUser.role === 'admin',
      bypassDuration: !!actorUser && actorUser.role === 'admin',
      // bypassPastDates: false — se il docente vuole riattivare uno slot
      // passato, deve farlo via amendment + admin (che decide se
      // materializzarlo come booking storico)
      transaction,
    });
    if (!validation.valid) {
      return { action: 'noop', reason: 'validation_failed', errors: validation.errors };
    }
    const b = await Booking.create(
      {
        userId: proposal.userId,
        roomId,
        startTime,
        endTime,
        type: bookingType,
        purpose,
        notes,
        status: 'confirmed',
        origin: 'monte_ore',
      },
      { transaction },
    );
    // Aggiorna generatedBookingIds della schedule (append) solo se lo slot
    // proviene da un pattern. Per slot fuori-pattern salviamo il bookingId
    // sullo slot stesso.
    if (schedule) {
      const ids = Array.isArray(schedule.generatedBookingIds) ? schedule.generatedBookingIds : [];
      if (!ids.includes(b.id)) {
        await schedule.update({ generatedBookingIds: [...ids, b.id] }, { transaction });
      }
    }
    await slot.update({ bookingId: b.id }, { transaction });
    return { action: 'created', affectedBookingId: b.id };
  }
  // Caso "toggle_off" → cancella il Booking se esiste e non è checked-in/passato
  const now = new Date();
  const target = await Booking.findOne({
    where: {
      userId: proposal.userId,
      roomId,
      startTime,
      status: 'confirmed',
    },
    ...tx,
  });
  if (!target) return { action: 'noop', reason: 'booking_not_found' };
  if (target.checkedInAt) {
    return { action: 'noop', reason: 'already_checked_in', affectedBookingId: target.id };
  }
  if (new Date(target.startTime) < now) {
    return { action: 'noop', reason: 'past_booking', affectedBookingId: target.id };
  }
  await target.update(
    {
      status: 'cancelled',
      cancelledAt: now,
      cancelReason: 'Variazione monte ore (slot disattivato)',
    },
    { transaction },
  );
  return { action: 'cancelled', affectedBookingId: target.id };
}

/**
 * Snapshot del valore `isActive` corrente come `originalActive`.
 * Da chiamare al momento dell'approvazione admin per congelare lo stato.
 */
async function snapshotOriginalActive(proposalId, { transaction = null } = {}) {
  const tx = transaction ? { transaction } : {};
  const slots = await MonteOreSlot.findAll({ where: { proposalId }, ...tx });
  for (const s of slots) {
    await s.update({ originalActive: s.isActive }, { transaction });
  }
}

/**
 * Ogni nuova variazione richiede una decisione del revisore.
 * Le decisioni auto_approved rimangono leggibili soltanto nello storico.
 */
function classifyAmendment() {
  return 'pending';
}

module.exports = {
  regenerateSlotsFromPattern,
  recomputeTotals,
  toggleSlot,
  syncBookingForSlot,
  snapshotOriginalActive,
  classifyAmendment,
  getActiveSettings,
  getSuspensions,
};
