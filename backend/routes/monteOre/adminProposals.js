'use strict';

const {
  sequelize,
  MonteOreProposal,
  MonteOreSchedule,
  User,
  Room,
  Building,
  MonteOreSettings,
  MonteOreSlot,
} = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const monteOreService = require('../../services/monteOreService');
const workflow = require('../../services/monteOreWorkflowService');
const slotService = require('../../services/monteOreSlotService');
const { parsePagination, setPaginationHeaders } = require('../../lib/pagination');

// Keep administrative pattern changes and the selected grid in the same transaction.
async function editAdminSchedule(req, action) {
  return workflow.transact(async (transaction) => {
    const plan = await workflow.loadPlan(Number(req.params.id), transaction, true);
    if (plan.proposal.status === 'generated')
      workflow.fail(
        'Esegui prima "Annulla generazione" oppure usa la rivalidazione',
        'INVALID_STATE',
      );
    let schedule;
    if (action === 'create') {
      const data = sanitizeSchedule(req.body);
      if (!data.bookingType) data.bookingType = 'lezione';
      if (data.dayOfWeek === undefined || !data.startTime || !data.endTime)
        workflow.fail('dayOfWeek, startTime, endTime sono obbligatori');
      schedule = await MonteOreSchedule.create(
        { proposalId: plan.proposal.id, ...data },
        { transaction },
      );
    } else {
      schedule = plan.schedules.find((s) => s.id === Number(req.params.sid));
      if (!schedule) workflow.fail('Riga non trovata', 'NOT_FOUND', 404);
      if (action === 'delete') {
        if (
          plan.slots.some((s) => s.scheduleId === schedule.id && s.isActive) &&
          req.body.confirmRemoval !== true
        )
          workflow.fail(
            'La fascia contiene date selezionate. Riporta il piano in bozza e deselezionale prima di eliminarla.',
            'ACTIVE_SCHEDULE',
            409,
          );
        await schedule.destroy({ transaction });
      } else await schedule.update(sanitizeSchedule(req.body), { transaction });
    }
    if (plan.settings) {
      const result = await slotService.regenerateSlotsFromPattern(plan.proposal.id, {
        transaction,
        confirmRemoval: req.body.confirmRemoval === true,
      });
      if (result.requiresConfirmation)
        workflow.fail(
          `La modifica rimuoverebbe ${result.removedActive.length} date selezionate. Riporta il piano in bozza per rivedere la selezione.`,
          'ACTIVE_SCHEDULE',
          409,
        );
    }
    await plan.proposal.update({ revision: plan.proposal.revision + 1 }, { transaction });
    return schedule;
  });
}

const { serializeProposal, sanitizeSchedule } = require('./shared');

module.exports = function registerAdminProposals(adminRouter) {
  adminRouter.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.academicYear) where.academicYear = req.query.academicYear;
      if (req.query.userId) where.userId = Number(req.query.userId);
      const { limit, offset } = parsePagination(req.query);
      const { rows, count } = await MonteOreProposal.findAndCountAll({
        where,
        include: [
          {
            model: User,
            as: 'user',
            // required: true → INNER JOIN: le proposte di utenti soft-deleted
            // (paranoid) non compaiono. Difesa addizionale rispetto al cleanup
            // applicativo nelle DELETE route.
            required: true,
            attributes: [
              'id',
              'firstName',
              'lastName',
              'email',
              'role',
              'matricola',
              'courseId',
              // Campi deroga Monte Ore: l'admin deve poter vedere a colpo
              // d'occhio se un docente ha una soglia personalizzata e con quale
              // motivazione, sia nella lista che nel dettaglio della proposta.
              'contractType',
              'monteOreAnnualHoursOverride',
              'monteOreBypassDayConstraint',
              'monteOreOverrideReason',
            ],
          },
          {
            model: MonteOreSchedule,
            as: 'schedules',
            include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
          },
        ],
        order: [['updatedAt', 'DESC']],
        limit,
        offset,
        // distinct=true: conteggio corretto in presenza di N include con
        // associazioni hasMany (schedules). Senza, count gonfia per ogni JOIN.
        distinct: true,
      });
      setPaginationHeaders(res, count, limit, offset);
      res.json({ proposals: rows.map(serializeProposal) });
    } catch (err) {
      next(err);
    }
  });

  adminRouter.use('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      if (req.method !== 'GET' && /^\d+$/.test(req.params.id)) {
        const proposal = await MonteOreProposal.findByPk(req.params.id);
        const settings =
          proposal &&
          (await MonteOreSettings.findOne({ where: { academicYear: proposal.academicYear } }));
        if (settings?.status === 'archived')
          workflow.fail(
            'Anno archiviato: ripubblicalo prima di modificarlo',
            'ACADEMIC_YEAR_ARCHIVED',
            409,
          );
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  adminRouter.get('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const proposal = await MonteOreProposal.findByPk(req.params.id, {
        include: [
          {
            model: User,
            as: 'user',
            attributes: [
              'id',
              'firstName',
              'lastName',
              'email',
              'role',
              'matricola',
              'courseId',
              // Campi deroga Monte Ore: l'admin deve poter vedere a colpo
              // d'occhio se un docente ha una soglia personalizzata e con quale
              // motivazione, sia nella lista che nel dettaglio della proposta.
              'contractType',
              'monteOreAnnualHoursOverride',
              'monteOreBypassDayConstraint',
              'monteOreOverrideReason',
            ],
          },
          {
            model: MonteOreSchedule,
            as: 'schedules',
            include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
          },
          { model: MonteOreSlot, as: 'slots' },
          { model: User, as: 'approver', attributes: ['id', 'firstName', 'lastName'] },
        ],
        order: [
          [{ model: MonteOreSchedule, as: 'schedules' }, 'dayOfWeek', 'ASC'],
          [{ model: MonteOreSchedule, as: 'schedules' }, 'startTime', 'ASC'],
        ],
      });
      if (!proposal)
        return res.status(404).json({ error: 'Proposta non trovata', code: 'NOT_FOUND' });
      res.json({ proposal: serializeProposal(proposal) });
    } catch (err) {
      next(err);
    }
  });

  adminRouter.patch(
    '/:id/schedules/:sid',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const schedule = await editAdminSchedule(req, 'update');
        res.json({ schedule: schedule.toJSON() });
      } catch (err) {
        next(err);
      }
    },
  );

  adminRouter.post('/:id/schedules', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const schedule = await editAdminSchedule(req, 'create');
      res.status(201).json({ schedule: schedule.toJSON() });
    } catch (err) {
      next(err);
    }
  });

  adminRouter.delete(
    '/:id/schedules/:sid',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        await editAdminSchedule(req, 'delete');
        res.json({ message: 'Riga eliminata' });
      } catch (err) {
        next(err);
      }
    },
  );

  adminRouter.get('/:id/preview', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      res.json(await workflow.preview(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  adminRouter.post('/:id/preview', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      res.json(await workflow.preview(Number(req.params.id), req.body.assignments || []));
    } catch (err) {
      next(err);
    }
  });

  adminRouter.post('/:id/approve', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const proposal = await workflow.approvePlan(
        Number(req.params.id),
        req.user,
        req.body.assignments || [],
      );
      res.json({ proposal });
    } catch (err) {
      next(err);
    }
  });

  adminRouter.post('/:id/reject', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const proposal = await MonteOreProposal.findByPk(req.params.id);
      if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
      if (proposal.status !== 'submitted') {
        return res
          .status(400)
          .json({ error: 'Solo submitted può essere rifiutata', code: 'INVALID_STATE' });
      }
      const reason = req.body.reason ? String(req.body.reason).slice(0, 1024) : null;
      await proposal.update({
        status: 'rejected',
        rejectedAt: new Date(),
        approverId: req.user.id,
        rejectionReason: reason,
      });
      res.json({ proposal: proposal.toJSON() });
    } catch (err) {
      next(err);
    }
  });

  adminRouter.post('/:id/generate', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      // includePast (opzionale, body): se true il generator materializza anche
      // le occorrenze già trascorse — usato per AA arretrati o ricostruzione
      // storico contabile. Default false: si genera solo dal momento in poi.
      const includePast = req.body?.includePast === true;
      const existing = await MonteOreProposal.findByPk(req.params.id);
      const settings =
        existing &&
        (await MonteOreSettings.findOne({ where: { academicYear: existing.academicYear } }));
      const result = settings
        ? await workflow
            .approvePlan(Number(req.params.id), req.user)
            .then((p) => ({ created: p.generationSummary.created, skipped: [], errors: [] }))
        : await monteOreService.generateBookingsForProposal(Number(req.params.id), {
            actorUser: req.user,
            includePast,
          });
      // Reload proposta aggiornata per la risposta
      const fresh = await MonteOreProposal.findByPk(req.params.id);
      res.status(201).json({ result, proposal: fresh.toJSON() });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });

  adminRouter.post('/:id/unlock', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      // Atomico: clear booking + status update. Se crash a metà, lo stato resta
      // 'generated' coerente. Senza tx, restavano booking cancellati ma
      // proposta ancora in 'generated' → impossibile rigenerare.
      const result = await sequelize.transaction(async (t) => {
        const proposal = await MonteOreProposal.findByPk(req.params.id, { transaction: t });
        if (!proposal) {
          const e = new Error('Proposta non trovata');
          e.status = 404;
          throw e;
        }
        if (proposal.status !== 'generated') {
          const e = new Error('Solo generated può essere unlocked');
          e.status = 400;
          e.code = 'INVALID_STATE';
          throw e;
        }
        const cleared = await monteOreService.clearGeneratedBookings(Number(req.params.id), {
          transaction: t,
        });
        await proposal.update(
          { status: 'approved', generatedAt: null, generationSummary: null },
          { transaction: t },
        );
        return { proposal, cleared };
      });
      res.json({ proposal: result.proposal.toJSON(), cleared: result.cleared });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });

  /**
   * Fase 6.4 — l'admin riporta una proposta in 'draft' per chiedere al docente
   * di modificarla. Ammesso solo per submitted/approved: per 'generated' va
   * fatto prima l'unlock (che cancella i Booking) e poi questo endpoint.
   *
   * Reset di tutti i campi di workflow (approvedAt, rejectedAt, ...) così che
   * il prossimo submit ricalcoli snapshot soglie/giorni a partire da zero.
   * `revalidationReason` è valorizzato con la motivazione dell'admin.
   */
  adminRouter.post(
    '/:id/revert-to-draft',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const proposal = await MonteOreProposal.findByPk(req.params.id);
        if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
        if (!['submitted', 'approved'].includes(proposal.status)) {
          if (proposal.status === 'generated') {
            return res.status(400).json({
              error: 'Esegui prima "Annulla generazione" per riportare la proposta in draft',
              code: 'INVALID_STATE',
            });
          }
          return res.status(400).json({
            error: 'Solo submitted o approved possono tornare in draft',
            code: 'INVALID_STATE',
          });
        }
        const reason = req.body?.reason
          ? String(req.body.reason).trim().slice(0, 500)
          : "Richiesta modifica dall'amministrazione";
        await proposal.update({
          status: 'draft',
          submittedAt: null,
          approvedAt: null,
          rejectedAt: null,
          approverId: null,
          rejectionReason: null,
          coordinatorNotes: null,
          requiresRevalidation: true,
          revalidationReason: reason,
        });
        res.json({ proposal: proposal.toJSON() });
      } catch (err) {
        next(err);
      }
    },
  );
};
