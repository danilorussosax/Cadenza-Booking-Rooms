'use strict';

/**
 * Monte Ore — espansione pattern (Sezione A) → slot griglia (Sezione B).
 *
 * Quando il docente conferma il pattern settimanale (giorni + fasce orarie),
 * il sistema genera UN MonteOreSlot per ogni occorrenza valida nel calendario
 * didattico al netto delle sospensioni. Ogni slot nasce con `isActive=true`:
 * il docente poi può deselezionare singole celle dalla griglia.
 *
 * Idempotenza: la regen cancella TUTTI gli slot della proposta e li ricrea.
 * Per questo si chiama solo quando il pattern viene modificato. Le toggle
 * delle singole celle invece non passano per la regen.
 */

const dayjs = require('dayjs');
const { Op } = require('sequelize');
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
async function regenerateSlotsFromPattern(proposalId, { transaction = null } = {}) {
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

  // Cancella slot precedenti (in tx)
  await MonteOreSlot.destroy({ where: { proposalId }, ...tx });

  // Costruisci payload in memoria, poi UN solo bulkCreate (era N+1 prima).
  // Su 4 schedules × 50 settimane = 200 slot questo passa da 200 INSERT
  // sequenziali a 1 batch INSERT — riduce drasticamente il rischio di pool
  // exhaustion e velocizza ~10×.
  const payloads = [];
  let locked = 0;
  let created = 0;
  for (const sched of proposal.schedules) {
    for (const week of weeks) {
      const day = week.days.find((d) => d.dayOfWeek === sched.dayOfWeek);
      if (!day) continue;
      const isLocked = day.isLocked;
      payloads.push({
        proposalId,
        scheduleId: sched.id,
        date: day.date,
        dayOfWeek: day.dayOfWeek,
        startTime: sched.startTime,
        endTime: sched.endTime,
        // Logica "additiva": tutti nascono INATTIVI. Il docente seleziona
        // cliccando le celle. originalActive parte false; verrà
        // snapshottato dall'approve admin.
        isActive: false,
        isLocked,
        lockReason: day.lockReason,
        originalActive: false,
      });
      if (isLocked) locked++;
      else created++;
    }
  }
  if (payloads.length > 0) {
    await MonteOreSlot.bulkCreate(payloads, { transaction });
  }

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
  const totalHours = slots.reduce((acc, s) => {
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    return acc + (eh + em / 60 - (sh + sm / 60));
  }, 0);
  await MonteOreProposal.update(
    { totalHoursPlanned: Math.round(totalHours * 10) / 10 },
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
  const { Booking, MonteOreSchedule, Room } = require('../models');
  const { validateBooking } = require('./bookingValidator');

  const slot = await MonteOreSlot.findByPk(slotId, { ...tx });
  if (!slot) return { action: 'noop', reason: 'slot_not_found' };
  const proposal = await MonteOreProposal.findByPk(slot.proposalId, { ...tx });
  if (!proposal || proposal.status !== 'generated') {
    return { action: 'noop', reason: 'proposal_not_generated' };
  }
  const schedule = await MonteOreSchedule.findByPk(slot.scheduleId, { ...tx });
  if (!schedule) return { action: 'noop', reason: 'schedule_not_found' };

  // Costruisco gli istanti come fa il generator
  const dayjs = require('dayjs');
  const [sh, sm] = schedule.startTime.split(':').map(Number);
  const [eh, em] = schedule.endTime.split(':').map(Number);
  const startTime = dayjs(slot.date).hour(sh).minute(sm).second(0).millisecond(0).toDate();
  const endTime = dayjs(slot.date).hour(eh).minute(em).second(0).millisecond(0).toDate();

  if (slot.isActive) {
    // Caso "toggle_on" → ricrea il Booking se non esiste già
    // Cerca booking esistente attivo che combaci (potrebbe essere un orfano)
    const existing = await Booking.findOne({
      where: {
        userId: proposal.userId,
        roomId: schedule.roomId,
        startTime,
        status: 'confirmed',
      },
      ...tx,
    });
    if (existing)
      return { action: 'noop', reason: 'already_exists', affectedBookingId: existing.id };
    const validation = await validateBooking({
      user: await require('../models').User.findByPk(proposal.userId, { ...tx }),
      roomId: schedule.roomId,
      startTime,
      endTime,
      type: schedule.bookingType,
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
        roomId: schedule.roomId,
        startTime,
        endTime,
        type: schedule.bookingType,
        purpose: schedule.purpose || null,
        notes: schedule.notes || null,
        status: 'confirmed',
      },
      { transaction },
    );
    // Aggiorna generatedBookingIds della schedule (append)
    const ids = Array.isArray(schedule.generatedBookingIds) ? schedule.generatedBookingIds : [];
    if (!ids.includes(b.id)) {
      await schedule.update({ generatedBookingIds: [...ids, b.id] }, { transaction });
    }
    return { action: 'created', affectedBookingId: b.id };
  }
  // Caso "toggle_off" → cancella il Booking se esiste e non è checked-in/passato
  const now = new Date();
  const target = await Booking.findOne({
    where: {
      userId: proposal.userId,
      roomId: schedule.roomId,
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
 * Classificazione amendment richiesta dalla spec:
 *   - se la modifica `isActive` riguarda uno slot che ERA attivo nel piano
 *     originale (`originalActive=true`) → AUTO-APPROVE
 *   - se riguarda uno slot/giorno NUOVO (originalmente non attivo) →
 *     PENDING (richiede approvazione manuale)
 *
 * @param {MonteOreSlot} slot - lo slot bersaglio dell'amendment
 * @param {string} kind - tipo amendment ('toggle_off' | 'toggle_on' | ...)
 * @returns 'auto_approved' | 'pending'
 */
function classifyAmendment(slot, kind) {
  // Disattivazione di un giorno già approvato: auto-approve
  if (kind === 'toggle_off' && slot.originalActive) return 'auto_approved';
  // Riattivazione di un giorno che era nel piano originale: auto-approve
  if (kind === 'toggle_on' && slot.originalActive) return 'auto_approved';
  // Cambio orario di un giorno già approvato: auto-approve
  if (kind === 'change_time' && slot.originalActive) return 'auto_approved';
  // Aggiunta giorno nuovo / riattivazione di giorno NON nel piano originale:
  // richiede approvazione manuale
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
