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

  // Cancella slot precedenti
  await MonteOreSlot.destroy({ where: { proposalId }, ...tx });

  let created = 0;
  let locked = 0;
  for (const sched of proposal.schedules) {
    for (const week of weeks) {
      const day = week.days.find((d) => d.dayOfWeek === sched.dayOfWeek);
      if (!day) continue; // sched.dayOfWeek non in Lun-Ven
      const isLocked = day.isLocked;
      // Slot lockati salvati comunque, ma con isActive=false (non possono essere
      // attivati dal docente) — utili per mostrare "rosso" nella griglia.
      await MonteOreSlot.create(
        {
          proposalId,
          scheduleId: sched.id,
          date: day.date,
          dayOfWeek: day.dayOfWeek,
          startTime: sched.startTime,
          endTime: sched.endTime,
          isActive: !isLocked,
          isLocked,
          lockReason: day.lockReason,
          originalActive: !isLocked,
        },
        { transaction },
      );
      if (isLocked) locked++;
      else created++;
    }
  }

  // Aggiorna conteggi sulla proposta
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
  snapshotOriginalActive,
  classifyAmendment,
  getActiveSettings,
  getSuspensions,
};
