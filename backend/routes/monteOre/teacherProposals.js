'use strict';

const dayjs = require('dayjs');

const {
  MonteOreProposal,
  MonteOreSchedule,
  Room,
  Building,
  MonteOreSettings,
  MonteOreSlot,
} = require('../../models');
const { authenticate, requireApproved } = require('../../middleware/auth');
const workflow = require('../../services/monteOreWorkflowService');
const slotService = require('../../services/monteOreSlotService');
const { resolveAnnualThreshold } = require('../../services/monteOreThresholdService');

async function isWithinSubmissionWindow(academicYear, user = null) {
  const settings = await MonteOreSettings.findOne({ where: { academicYear } });
  if (!settings) return true; // Compatibility for legacy plans without a calendar.
  if (settings.status !== 'published') return false;
  const now = dayjs().format('YYYY-MM-DD');
  if (now >= settings.submissionWindowStart && now <= settings.submissionWindowEnd) {
    return true;
  }
  // Deroga individuale (Fase 6.1): un docente subentrato in corso d'anno
  // può avere `monteOreSubmissionAllowedUntil` valorizzato dalla Direzione,
  // che lo abilita a inviare/modificare la propria proposta anche fuori
  // dalla finestra globale, fino a quella data inclusa.
  if (user && user.monteOreSubmissionAllowedUntil) {
    const until = String(user.monteOreSubmissionAllowedUntil).slice(0, 10);
    if (now <= until) return true;
  }
  return false;
}

const {
  currentAcademicYearLabel,
  defaultRangeForYear,
  serializeProposal,
  findOwnProposalEditable,
  sanitizeSchedule,
} = require('./shared');

module.exports = function registerTeacherProposals(router) {
  // ============================================================
  // DOCENTE — endpoints "miei"
  // ============================================================

  /**
   * GET /api/monte-ore/me/threshold — risolve la soglia ore applicabile
   * all'utente corrente per l'AA passato (o quello in corso).
   * Restituisce { minHours, bypassDayConstraint, source, contractType, reason }.
   * Usato dal banner docente quando ha un override personalizzato.
   */
  router.get('/me/threshold', authenticate, requireApproved, async (req, res, next) => {
    try {
      const year = req.query.year || currentAcademicYearLabel();
      const resolved = await resolveAnnualThreshold(req.user.id, year);
      // Esponi anche i vincoli giornalieri istituzionali (Z2/Z3) per consentire
      // al frontend di mostrare warning inline durante l'editing del pattern.
      const settings = await MonteOreSettings.findOne({
        where: { academicYear: year },
        attributes: ['maxHoursPerDay', 'dailyBreakAfterHours', 'dailyBreakMinutes'],
      });
      res.json({
        academicYear: year,
        ...resolved,
        dailyConstraints: {
          maxHoursPerDay: settings?.maxHoursPerDay ?? null,
          dailyBreakAfterHours: settings?.dailyBreakAfterHours ?? null,
          dailyBreakMinutes: settings?.dailyBreakMinutes ?? null,
        },
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });

  router.get('/me', authenticate, requireApproved, async (req, res, next) => {
    try {
      const year = req.query.year || currentAcademicYearLabel();
      const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
      if (settings && settings.status !== 'published')
        return res.status(409).json({
          error: 'Anno non pubblicato per la compilazione',
          code: 'ACADEMIC_YEAR_NOT_PUBLISHED',
        });
      const range = settings
        ? { validFrom: settings.lessonsStartDate, validTo: settings.lessonsEndDate }
        : defaultRangeForYear(year);
      const existing = await MonteOreProposal.findOne({
        where: { userId: req.user.id, academicYear: year },
      });
      const proposal =
        existing ||
        (
          await MonteOreProposal.findCreateFind({
            where: { userId: req.user.id, academicYear: year },
            defaults: {
              userId: req.user.id,
              academicYear: year,
              validFrom: range.validFrom,
              validTo: range.validTo,
              status: 'draft',
            },
            include: [
              {
                model: MonteOreSchedule,
                as: 'schedules',
                include: [
                  { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
                ],
              },
            ],
          })
        )[0];
      // Se la findOrCreate ha trovato senza include (caso "find existing"),
      // ricarichiamo per avere le schedules popolate
      const full = await MonteOreProposal.findByPk(proposal.id, {
        include: [
          {
            model: MonteOreSchedule,
            as: 'schedules',
            include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
          },
        ],
        order: [
          [{ model: MonteOreSchedule, as: 'schedules' }, 'dayOfWeek', 'ASC'],
          [{ model: MonteOreSchedule, as: 'schedules' }, 'startTime', 'ASC'],
        ],
      });
      const plan = await workflow.loadPlan(full.id);
      const windowOpen = await isWithinSubmissionWindow(year, req.user);
      res.json({
        proposal: {
          ...serializeProposal(full),
          workflow: await workflow.describePlan(plan, { windowOpen }),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.put('/me', authenticate, requireApproved, async (req, res, next) => {
    try {
      const proposal = await workflow.transact(async (transaction) => {
        const proposal = await findOwnProposalEditable(
          req.user.id,
          req.body.academicYear || currentAcademicYearLabel(),
          transaction,
        );
        const updates = {};
        if (req.body.notes !== undefined) updates.notes = req.body.notes;
        if (req.body.validFrom) updates.validFrom = req.body.validFrom;
        if (req.body.validTo) updates.validTo = req.body.validTo;
        const from = updates.validFrom || proposal.validFrom;
        const to = updates.validTo || proposal.validTo;
        if (from > to || !dayjs(from).isValid() || !dayjs(to).isValid())
          workflow.fail('Periodo non valido');
        await proposal.update(updates, { transaction });
        await workflow.reopenIfRejected(proposal, transaction);
        return proposal;
      });
      res.json({ proposal: proposal.toJSON() });
    } catch (err) {
      next(err);
    }
  });

  router.post('/me/schedules', authenticate, requireApproved, async (req, res, next) => {
    try {
      const schedule = await workflow.transact(async (transaction) => {
        const proposal = await findOwnProposalEditable(
          req.user.id,
          req.body.academicYear || req.query.year || currentAcademicYearLabel(),
          transaction,
        );
        const data = sanitizeSchedule(req.body);
        if (!data.bookingType) data.bookingType = 'lezione';
        if (data.dayOfWeek === undefined || !data.startTime || !data.endTime)
          workflow.fail('dayOfWeek, startTime, endTime sono obbligatori');
        const schedule = await MonteOreSchedule.create(
          { proposalId: proposal.id, ...data },
          { transaction },
        );
        await workflow.reopenIfRejected(proposal, transaction);
        return schedule;
      });
      res.status(201).json({ schedule: schedule.toJSON() });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/me/schedules/:id', authenticate, requireApproved, async (req, res, next) => {
    try {
      const schedule = await workflow.transact(async (transaction) => {
        const proposal = await findOwnProposalEditable(
          req.user.id,
          req.body.academicYear || req.query.year || currentAcademicYearLabel(),
          transaction,
        );
        const schedule = await MonteOreSchedule.findOne({
          where: { id: req.params.id, proposalId: proposal.id },
          transaction,
        });
        if (!schedule) workflow.fail('Riga non trovata', 'NOT_FOUND', 404);
        await schedule.update(sanitizeSchedule(req.body), { transaction });
        return schedule;
      });
      res.json({ schedule: schedule.toJSON() });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/me/schedules/:id', authenticate, requireApproved, async (req, res, next) => {
    try {
      await workflow.transact(async (transaction) => {
        const proposal = await findOwnProposalEditable(
          req.user.id,
          req.body.academicYear || req.query.year || currentAcademicYearLabel(),
          transaction,
        );
        const schedule = await MonteOreSchedule.findOne({
          where: { id: req.params.id, proposalId: proposal.id },
          transaction,
        });
        if (!schedule) workflow.fail('Riga non trovata', 'NOT_FOUND', 404);
        const active = await MonteOreSlot.count({
          where: { scheduleId: schedule.id, isActive: true },
          transaction,
        });
        if (active && !req.body.confirmRemoval)
          workflow.fail(
            `La fascia contiene ${active} date selezionate. Deselezionale prima di eliminare la fascia.`,
            'ACTIVE_SCHEDULE',
          );
        await schedule.destroy({ transaction });
        await slotService.recomputeTotals(proposal.id, { transaction });
      });
      res.json({ message: 'Riga eliminata' });
    } catch (err) {
      next(err);
    }
  });

  router.post('/me/submit', authenticate, requireApproved, async (req, res, next) => {
    try {
      const year = req.body.academicYear || currentAcademicYearLabel();
      if (!(await isWithinSubmissionWindow(year, req.user)))
        workflow.fail(
          'Sei fuori dalla finestra di inserimento del monte ore',
          'OUTSIDE_SUBMISSION_WINDOW',
        );
      const proposal = await workflow.submitPlan(req.user.id, year);
      res.json({ proposal: proposal.toJSON() });
    } catch (err) {
      if (err.violations)
        return res
          .status(err.status)
          .json({ error: err.message, code: err.code, violations: err.violations });
      next(err);
    }
  });
};
