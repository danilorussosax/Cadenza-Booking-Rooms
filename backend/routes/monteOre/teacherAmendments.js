'use strict';

const { Op } = require('sequelize');

const {
  MonteOreProposal,
  Room,
  MonteOreSettings,
  MonteOreSlot,
  MonteOreAmendment,
} = require('../../models');
const { authenticate, requireApproved } = require('../../middleware/auth');
const workflow = require('../../services/monteOreWorkflowService');
const { randomUUID } = require('crypto');
const slotService = require('../../services/monteOreSlotService');

/**
 * Helper comune per i 3 endpoint di "spostamento" (change-time, change-room,
 * move-to). Ritorna { proposal, slot } o lancia un Error con .status/.code.
 *
 * - Verifica che lo slot appartenga al docente corrente.
 * - Verifica che la proposta sia in stato approved/generated (in draft il
 *   docente modifica direttamente schedule/slot senza amendment).
 * - Verifica che lo slot non sia locked (festività/sospensione).
 */
async function loadOwnApprovedSlot(slotId, userId) {
  const slot = await MonteOreSlot.findByPk(slotId);
  if (!slot) {
    const e = new Error('Slot non trovato');
    e.status = 404;
    throw e;
  }
  const proposal = await MonteOreProposal.findByPk(slot.proposalId);
  if (!proposal || proposal.userId !== userId) {
    const e = new Error('Non autorizzato');
    e.status = 403;
    throw e;
  }
  if (!['approved', 'generated'].includes(proposal.status)) {
    const e = new Error('Spostamenti consentiti solo dopo approvazione');
    e.status = 400;
    e.code = 'INVALID_STATE';
    throw e;
  }
  if (slot.isLocked) {
    const e = new Error('Cella bloccata (festività/sospensione)');
    e.status = 400;
    e.code = 'SLOT_LOCKED';
    throw e;
  }
  return { proposal, slot };
}

/**
 * Helper: crea un amendment con increment atomico cross-dialect del budget
 * annuale e lascia la richiesta pendente. Nessuna mutazione del piano operativo.
 */
async function createAndApplyAmendment({ req, proposal, slot, kind, payload }) {
  return workflow.requestAmendment(proposal.id, req.user.id, {
    operations: [{ kind, slotId: slot.id, payload }],
    notes: req.body.notes,
    requestKey: req.body.requestKey || randomUUID(),
  });
}

const {
  currentAcademicYearLabel,
  findOwnProposalEditable,
  serializeAmendments,
} = require('./shared');

module.exports = function registerTeacherAmendments(router) {
  /**
   * Richiesta di un nuovo giorno FUORI dal pattern settimanale approvato.
   * Crea un `MonteOreAmendment` kind='add_new_day' status='pending' che dovrà
   * essere approvato dal coordinatore. L'effettivo `MonteOreSlot` (e l'eventuale
   * Booking) viene creato solo all'approvazione.
   *
   * Body atteso: { date: "YYYY-MM-DD", startTime: "HH:MM", endTime: "HH:MM",
   *                roomId: number, bookingType?: string, notes?: string,
   *                purpose?: string }
   */
  router.post(
    '/me/amendments/add-new-day',
    authenticate,
    requireApproved,
    async (req, res, next) => {
      try {
        const year = req.body.year || currentAcademicYearLabel();
        const proposal = await MonteOreProposal.findOne({
          where: { userId: req.user.id, academicYear: year },
        });
        if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
        if (!['approved', 'generated'].includes(proposal.status)) {
          return res
            .status(400)
            .json({ error: 'La proposta non è approvata', code: 'INVALID_STATE' });
        }
        const { date, startTime, endTime, roomId, bookingType, notes, purpose } = req.body || {};
        if (!date || !startTime || !endTime) {
          return res.status(400).json({ error: 'Campi obbligatori: date, startTime, endTime' });
        }
        const isoDate = String(date).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
          return res.status(400).json({ error: 'Formato data non valido (YYYY-MM-DD)' });
        }
        const sT = String(startTime).slice(0, 5);
        const eT = String(endTime).slice(0, 5);
        if (!/^\d{2}:\d{2}$/.test(sT) || !/^\d{2}:\d{2}$/.test(eT)) {
          return res.status(400).json({ error: 'Formato orario non valido (HH:MM)' });
        }
        if (sT >= eT) {
          return res.status(400).json({ error: 'startTime deve essere prima di endTime' });
        }
        // roomId opzionale: il coordinatore la assegna in fase di approve.
        // Esistenza convalidata in approve (FK + lookup), non qui.
        const roomIdNum =
          roomId !== undefined && roomId !== null && roomId !== '' ? Number(roomId) : null;

        const amendment = await workflow.requestAmendment(proposal.id, req.user.id, {
          requestKey: req.body.requestKey || randomUUID(),
          notes,
          operations: [
            {
              kind: 'add_new_day',
              payload: {
                date: isoDate,
                startTime: sT,
                endTime: eT,
                roomId: roomIdNum,
                bookingType: bookingType || 'lezione',
                purpose: purpose || null,
              },
            },
          ],
        });

        res.status(201).json({ amendment: amendment.toJSON() });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /api/monte-ore/me/slots/:id/change-time
   * Cambia l'orario di UN'occorrenza ricorrente (lascia il pattern intatto).
   * Body: { startTime?: "HH:MM", endTime?: "HH:MM", notes?: string }
   * Ogni richiesta rimane pendente fino alla decisione del revisore.
   */
  router.post(
    '/me/slots/:id/change-time',
    authenticate,
    requireApproved,
    async (req, res, next) => {
      try {
        const { proposal, slot } = await loadOwnApprovedSlot(req.params.id, req.user.id);
        const sT = req.body?.startTime ? String(req.body.startTime).slice(0, 5) : null;
        const eT = req.body?.endTime ? String(req.body.endTime).slice(0, 5) : null;
        if (!sT && !eT) {
          return res.status(400).json({ error: 'Indicare almeno startTime o endTime' });
        }
        const finalStart = sT ?? slot.startTime;
        const finalEnd = eT ?? slot.endTime;
        if (!/^\d{2}:\d{2}$/.test(finalStart) || !/^\d{2}:\d{2}$/.test(finalEnd)) {
          return res.status(400).json({ error: 'Formato orario non valido (HH:MM)' });
        }
        if (finalStart >= finalEnd) {
          return res.status(400).json({ error: 'startTime deve essere prima di endTime' });
        }
        const amendment = await createAndApplyAmendment({
          req,
          proposal,
          slot,
          kind: 'change_time',
          payload: { startTime: finalStart, endTime: finalEnd },
        });
        res.status(201).json({ amendment: amendment.toJSON() });
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
        next(err);
      }
    },
  );

  /**
   * POST /api/monte-ore/me/slots/:id/change-room
   * Cambia l'aula di UN'occorrenza (override puntuale). Pattern e altre
   * settimane restano invariati. Sempre pending: l'aula è risorsa condivisa.
   * Body: { roomId: number, notes?: string }
   */
  router.post(
    '/me/slots/:id/change-room',
    authenticate,
    requireApproved,
    async (req, res, next) => {
      try {
        const { proposal, slot } = await loadOwnApprovedSlot(req.params.id, req.user.id);
        const newRoomId = Number(req.body?.roomId);
        if (!Number.isInteger(newRoomId) || newRoomId <= 0) {
          return res.status(400).json({ error: 'roomId obbligatorio (intero positivo)' });
        }
        const room = await Room.findByPk(newRoomId);
        if (!room) {
          return res.status(400).json({ error: 'Aula non trovata', code: 'ROOM_NOT_FOUND' });
        }
        // Always pending: l'admin verifica disponibilità aula.
        const amendment = await createAndApplyAmendment({
          req,
          proposal,
          slot,
          kind: 'change_room',
          payload: { roomId: newRoomId },
        });
        res.status(201).json({ amendment: amendment.toJSON() });
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
        next(err);
      }
    },
  );

  /**
   * POST /api/monte-ore/me/slots/:id/move-to
   * Sposta UNA lezione attiva su una cella diversa (toggle off+on atomico).
   * Conta come 1 sola variazione di budget.
   * Body: { targetSlotId: number, notes?: string }
   *
   * Ogni spostamento richiede la decisione del revisore.
   */
  router.post('/me/slots/:id/move-to', authenticate, requireApproved, async (req, res, next) => {
    try {
      const { proposal, slot: source } = await loadOwnApprovedSlot(req.params.id, req.user.id);
      if (!source.isActive) {
        return res
          .status(400)
          .json({ error: 'Lo slot sorgente non è attivo', code: 'SOURCE_NOT_ACTIVE' });
      }
      const targetSlotId = Number(req.body?.targetSlotId);
      if (!Number.isInteger(targetSlotId) || targetSlotId <= 0) {
        return res.status(400).json({ error: 'targetSlotId obbligatorio' });
      }
      if (targetSlotId === source.id) {
        return res.status(400).json({ error: 'Source e target coincidono' });
      }
      const target = await MonteOreSlot.findByPk(targetSlotId);
      if (!target || target.proposalId !== proposal.id) {
        return res.status(400).json({ error: 'Target non valido', code: 'TARGET_NOT_FOUND' });
      }
      if (target.isLocked) {
        return res
          .status(400)
          .json({ error: 'Cella target bloccata (festività)', code: 'TARGET_LOCKED' });
      }
      if (target.isActive) {
        return res
          .status(400)
          .json({ error: 'Cella target già attiva', code: 'TARGET_ALREADY_ACTIVE' });
      }
      const amendment = await createAndApplyAmendment({
        req,
        proposal,
        slot: source,
        kind: 'move_to',
        payload: { targetSlotId: target.id, sourceDate: source.date, targetDate: target.date },
      });
      res.status(201).json({ amendment: amendment.toJSON() });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });

  /**
   * Elenco amendments della propria proposta (per visibilità docente).
   */
  router.post('/me/amendments', authenticate, requireApproved, async (req, res, next) => {
    try {
      const proposal = await MonteOreProposal.findOne({
        where: {
          userId: req.user.id,
          academicYear: req.body.academicYear || currentAcademicYearLabel(),
        },
      });
      if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
      const amendment = await workflow.requestAmendment(proposal.id, req.user.id, req.body);
      res.status(201).json({ amendment });
    } catch (err) {
      next(err);
    }
  });

  router.post('/me/slots/select', authenticate, requireApproved, async (req, res, next) => {
    try {
      const proposal = await findOwnProposalEditable(
        req.user.id,
        req.body.academicYear || currentAcademicYearLabel(),
      );
      const { dateFrom, dateTo, dayOfWeek, isActive } = req.body;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom || '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(dateTo || '') ||
        dateFrom > dateTo ||
        typeof isActive !== 'boolean'
      )
        return res.status(400).json({ error: 'Periodo o selezione non validi' });
      await workflow.transact(async (transaction) => {
        await findOwnProposalEditable(req.user.id, proposal.academicYear, transaction);
        const where = {
          proposalId: proposal.id,
          isLocked: false,
          date: { [Op.between]: [dateFrom, dateTo] },
        };
        if (dayOfWeek !== undefined && dayOfWeek !== null) {
          if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 6)
            workflow.fail('Giorno non valido');
          where.dayOfWeek = dayOfWeek;
        }
        await MonteOreSlot.update({ isActive }, { where, transaction, validate: false });
        await slotService.recomputeTotals(proposal.id, { transaction });
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me/amendments', authenticate, requireApproved, async (req, res, next) => {
    try {
      const year = req.query.year || currentAcademicYearLabel();
      const proposal = await MonteOreProposal.findOne({
        where: { userId: req.user.id, academicYear: year },
      });
      if (!proposal) return res.json({ amendments: [] });
      const amendments = await MonteOreAmendment.findAll({
        where: { proposalId: proposal.id },
        order: [['createdAt', 'DESC']],
      });
      const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
      const maximum = settings?.maxAmendmentsPerYear ?? 3;
      res.json({
        amendments: await serializeAmendments(amendments),
        budget: {
          used: proposal.requestCount,
          maximum,
          remaining: Math.max(0, maximum - proposal.requestCount),
        },
      });
    } catch (err) {
      next(err);
    }
  });
};
