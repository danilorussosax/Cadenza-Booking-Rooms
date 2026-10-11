'use strict';

const {
  MonteOreProposal,
  MonteOreSettings,
  MonteOreSuspension,
  MonteOreSlot,
} = require('../../models');
const { authenticate, requireApproved } = require('../../middleware/auth');
const workflow = require('../../services/monteOreWorkflowService');
const { randomUUID } = require('crypto');
const slotService = require('../../services/monteOreSlotService');
const calendarService = require('../../services/monteOreCalendarService');
const { currentAcademicYearLabel, findOwnProposalEditable } = require('./shared');

module.exports = function registerTeacherCalendar(router) {
  // ============================================================
  // DOCENTE — calendario griglia + slot toggle + amendments
  // ============================================================

  /**
   * Restituisce la griglia delle settimane (Lun-Sab) filtrata da
   * lessonsStart/End e dalle suspensions admin. Usata per renderizzare
   * la sezione B della pagina docente.
   */
  router.get('/me/calendar', authenticate, requireApproved, async (req, res, next) => {
    try {
      const year = req.query.year || currentAcademicYearLabel();
      const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
      if (!settings) {
        return res.status(404).json({
          error: 'Configurazione monte ore non disponibile per questo AA',
          code: 'SETTINGS_NOT_FOUND',
        });
      }
      const suspensions = await MonteOreSuspension.findAll({
        where: { academicYear: year, instituteId: settings.instituteId },
      });
      const weeks = calendarService.computeWeeks(settings, suspensions);
      res.json({ settings: settings.toJSON(), weeks });
    } catch (err) {
      if (err.message?.startsWith('Settings monte ore mancanti')) {
        return res.status(400).json({ error: err.message, code: 'SETTINGS_INCOMPLETE' });
      }
      next(err);
    }
  });

  /**
   * Rigenera gli slot a partire dal pattern corrente. Da chiamare quando
   * il docente conferma il pattern in Sezione A (e ogni volta che modifica
   * le righe schedule).
   */
  router.post('/me/regenerate-slots', authenticate, requireApproved, async (req, res, next) => {
    try {
      const proposal = await findOwnProposalEditable(
        req.user.id,
        req.body.academicYear || req.query.year || currentAcademicYearLabel(),
      );
      // Atomico: destroy + bulkCreate + recomputeTotals in una sola transazione.
      // Senza tx un crash a metà lasciava la proposta con metà degli slot persi.
      const result = await workflow.transact(async (transaction) => {
        await findOwnProposalEditable(req.user.id, proposal.academicYear, transaction);
        return slotService.regenerateSlotsFromPattern(proposal.id, {
          transaction,
          confirmRemoval: req.body.confirmRemoval === true,
        });
      });
      res.json({ result });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });

  /**
   * Lista degli slot della propria proposta (per renderizzare la griglia).
   */
  router.get('/me/slots', authenticate, requireApproved, async (req, res, next) => {
    try {
      const year = req.query.year || currentAcademicYearLabel();
      const proposal = await MonteOreProposal.findOne({
        where: { userId: req.user.id, academicYear: year },
      });
      if (!proposal) return res.json({ slots: [] });
      const slots = await MonteOreSlot.findAll({
        where: { proposalId: proposal.id },
        order: [
          ['date', 'ASC'],
          ['startTime', 'ASC'],
        ],
      });
      res.json({ slots: slots.map((s) => s.toJSON()) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Toggle attiva/disattiva singola cella della griglia. Per proposte
   * draft/rejected agisce direttamente; per approved/generated crea un
   * `MonteOreAmendment` (auto-approvato o pending a seconda della logica).
   */
  router.post('/me/slots/:id/toggle', authenticate, requireApproved, async (req, res, next) => {
    try {
      const slot = await MonteOreSlot.findByPk(req.params.id);
      if (!slot) return res.status(404).json({ error: 'Slot non trovato' });
      const proposal = await MonteOreProposal.findByPk(slot.proposalId);
      if (!proposal || proposal.userId !== req.user.id) {
        return res.status(403).json({ error: 'Non autorizzato' });
      }
      if (proposal.status === 'submitted') {
        return res.status(400).json({
          error: 'La proposta è in attesa di approvazione e non può essere modificata',
          code: 'INVALID_STATE',
        });
      }
      // Stati editabili direttamente
      if (['draft', 'rejected'].includes(proposal.status)) {
        const updated = await workflow.transact(async (transaction) => {
          await findOwnProposalEditable(req.user.id, proposal.academicYear, transaction);
          return slotService.toggleSlot(slot.id, { transaction });
        });
        return res.json({ slot: updated.toJSON() });
      }
      // Stati che richiedono amendment workflow
      if (['approved', 'generated'].includes(proposal.status)) {
        const amendment = await workflow.requestAmendment(proposal.id, req.user.id, {
          operations: [
            { kind: slot.isActive ? 'toggle_off' : 'toggle_on', slotId: slot.id, payload: {} },
          ],
          notes: req.body.notes,
          requestKey: req.body.requestKey || randomUUID(),
        });
        return res.status(201).json({ amendment: amendment.toJSON() });
      }
      return res.status(400).json({ error: 'Stato non gestito' });
    } catch (err) {
      if (err.code === 'SLOT_LOCKED' || err.code === 'AMENDMENT_LIMIT_REACHED')
        return res.status(err.status || 400).json({ error: err.message, code: err.code });
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });
};
