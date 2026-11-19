'use strict';

/**
 * Monte Ore — espansione pattern (Sezione A) → slot griglia (Sezione B).
 *
 * La rigenerazione conserva gli ID e le selezioni delle occorrenze ancora valide.
 * Le nuove date sono inattive; la rimozione di date attive richiede conferma.
 */

const {
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSlot,
  MonteOreSettings,
  MonteOreSuspension,
} = require('../models');
const { computeWeeks } = require('./monteOreCalendarService');
const { activeMinutes } = require('./monteOrePlanRules');

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
  const totalHours = activeMinutes(slots) / 60;
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

module.exports = {
  regenerateSlotsFromPattern,
  recomputeTotals,
  toggleSlot,
  getActiveSettings,
  getSuspensions,
};
