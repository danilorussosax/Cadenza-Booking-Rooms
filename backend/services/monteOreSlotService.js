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
 * Auto-approve se la modifica resta dentro il pattern settimanale già
 * approvato (stesso dayOfWeek+orario, scheduleId valorizzato), o se è una
 * deselezione (libero ore = sempre lecito). Tutto il resto richiede il
 * coordinatore.
 *
 * - toggle_off: sempre auto (libera ore)
 * - toggle_on: auto se slot dentro pattern, pending altrimenti
 * - change_time: auto se slot.originalActive (era in piano), pending altrimenti
 * - change_room: sempre pending (l'aula è risorsa condivisa)
 * - move_to: auto se sia source sia target sono in pattern; pending altrimenti.
 *   Il target è passato come secondo argomento opzionale dal route handler.
 * - add_new_day: sempre pending
 */
function classifyAmendment(slot, kind, opts = {}) {
  if (kind === 'toggle_off') return 'auto_approved';
  if (kind === 'toggle_on') {
    return slot.scheduleId ? 'auto_approved' : 'pending';
  }
  if (kind === 'change_time' && slot.originalActive) return 'auto_approved';
  if (kind === 'change_room') return 'pending';
  if (kind === 'move_to') {
    const target = opts.targetSlot;
    return slot.scheduleId && target && target.scheduleId ? 'auto_approved' : 'pending';
  }
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
