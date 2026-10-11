'use strict';

const { MonteOreSettings, MonteOreSuspension } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const { updateCalendar } = require('../../services/monteOreCalendarUpdateService');
const calendarService = require('../../services/monteOreCalendarService');

const {
  sanitizeSuspension,
  resolveDefaultInstituteId,
  findExistingSuspension,
} = require('./shared');

module.exports = function registerExamSessions(adminRouter) {
  // ---- Exam Sessions (sospensioni con category='exam_session') ----
  adminRouter.get('/exam-sessions', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const year = req.query.academicYear || calendarService.currentAcademicYear();
      const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
      const where = { academicYear: year, category: 'exam_session' };
      if (settings) where.instituteId = settings.instituteId;
      const items = await MonteOreSuspension.findAll({
        where,
        order: [['dateFrom', 'ASC']],
      });
      res.json({ examSessions: items.map((s) => s.toJSON()) });
    } catch (err) {
      next(err);
    }
  });

  adminRouter.post('/exam-sessions', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const year = req.body.academicYear || calendarService.currentAcademicYear();
      const data = sanitizeSuspension(req.body);
      if (!data.name || !data.dateFrom || !data.dateTo) {
        return res
          .status(400)
          .json({ error: 'name, dateFrom, dateTo sono obbligatori', code: 'VALIDATION_FAILED' });
      }
      let instituteId;
      const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
      if (settings) instituteId = settings.instituteId;
      else instituteId = await resolveDefaultInstituteId();

      const existing = await findExistingSuspension({
        instituteId,
        academicYear: year,
        name: data.name,
        dateFrom: data.dateFrom,
        dateTo: data.dateTo,
      });
      if (existing) {
        return res.status(409).json({
          error: 'Sessione esame già presente con stesso nome e date',
          code: 'DUPLICATE',
          examSession: existing.toJSON(),
        });
      }

      const susp = await updateCalendar(
        year,
        req.user,
        req.body.confirmImpact === true,
        (transaction) =>
          MonteOreSuspension.create(
            {
              instituteId,
              academicYear: year,
              name: data.name,
              dateFrom: data.dateFrom,
              dateTo: data.dateTo,
              kind: 'partial',
              category: 'exam_session',
              notes: data.notes || null,
            },
            { transaction },
          ),
      );
      res.status(201).json({ examSession: susp.toJSON() });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });

  adminRouter.patch(
    '/exam-sessions/:id',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const susp = await MonteOreSuspension.findByPk(req.params.id);
        if (!susp || susp.category !== 'exam_session') {
          return res.status(404).json({ error: 'Sessione esame non trovata' });
        }
        const patch = {};
        const data = sanitizeSuspension(req.body);
        if (data.name !== undefined) patch.name = data.name;
        if (data.dateFrom !== undefined) patch.dateFrom = data.dateFrom;
        if (data.dateTo !== undefined) patch.dateTo = data.dateTo;
        if (data.notes !== undefined) patch.notes = data.notes;
        await updateCalendar(
          susp.academicYear,
          req.user,
          req.body.confirmImpact === true,
          (transaction) => susp.update(patch, { transaction }),
        );
        res.json({ examSession: susp.toJSON() });
      } catch (err) {
        next(err);
      }
    },
  );

  adminRouter.delete(
    '/exam-sessions/:id',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const susp = await MonteOreSuspension.findByPk(req.params.id);
        if (!susp || susp.category !== 'exam_session') {
          return res.status(404).json({ error: 'Sessione esame non trovata' });
        }
        await updateCalendar(susp.academicYear, req.user, true, (transaction) =>
          susp.destroy({ transaction }),
        );
        res.json({ message: 'Sessione esame eliminata' });
      } catch (err) {
        next(err);
      }
    },
  );
};
