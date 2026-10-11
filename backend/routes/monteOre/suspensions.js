'use strict';

const { MonteOreSettings, MonteOreSuspension, BookingRuleException } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const { updateCalendar } = require('../../services/monteOreCalendarUpdateService');
const calendarService = require('../../services/monteOreCalendarService');

const {
  sanitizeSuspension,
  resolveDefaultInstituteId,
  findExistingSuspension,
} = require('./shared');

module.exports = function registerSuspensions(adminRouter) {
  // ---- Suspensions ----
  adminRouter.get('/suspensions', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const year = req.query.academicYear || calendarService.currentAcademicYear();
      const items = await MonteOreSuspension.findAll({
        where: { academicYear: year },
        order: [['dateFrom', 'ASC']],
      });
      res.json({ suspensions: items.map((s) => s.toJSON()) });
    } catch (err) {
      next(err);
    }
  });

  adminRouter.post('/suspensions', authenticate, requireRole('admin'), async (req, res, next) => {
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
          error: 'Sospensione già presente con stesso nome e date',
          code: 'DUPLICATE',
          suspension: existing.toJSON(),
        });
      }

      // Atomico: o entrambi (exception + suspension) sono creati, o nessuno —
      // così non restano BookingRuleException orfane se la suspension fallisce.
      const susp = await updateCalendar(
        year,
        req.user,
        req.body.confirmImpact === true,
        async (t) => {
          let bookingRuleExceptionId = null;
          if (req.body.applyToAllBookings === true) {
            const ex = await BookingRuleException.create(
              {
                role: 'all',
                name: data.name,
                kind: 'block',
                dateFrom: data.dateFrom,
                dateTo: data.dateTo,
                isActive: true,
                notes: `Generata automaticamente dalla sospensione monte ore (${year})`,
              },
              { transaction: t },
            );
            bookingRuleExceptionId = ex.id;
          }
          return MonteOreSuspension.create(
            { instituteId, academicYear: year, bookingRuleExceptionId, ...data },
            { transaction: t },
          );
        },
      );
      res.status(201).json({ suspension: susp.toJSON() });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });

  adminRouter.patch(
    '/suspensions/:id',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const susp = await MonteOreSuspension.findByPk(req.params.id);
        if (!susp) return res.status(404).json({ error: 'Sospensione non trovata' });
        await updateCalendar(
          susp.academicYear,
          req.user,
          req.body.confirmImpact === true,
          async (transaction) => {
            const patch = sanitizeSuspension(req.body);
            if (susp.bookingRuleExceptionId) {
              const linked = {};
              for (const key of ['name', 'dateFrom', 'dateTo'])
                if (patch[key] !== undefined) linked[key] = patch[key];
              await BookingRuleException.update(linked, {
                where: { id: susp.bookingRuleExceptionId },
                transaction,
              });
            }
            return susp.update(patch, { transaction });
          },
        );
        res.json({ suspension: susp.toJSON() });
      } catch (err) {
        next(err);
      }
    },
  );

  adminRouter.delete(
    '/suspensions/:id',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const susp = await MonteOreSuspension.findByPk(req.params.id);
        if (!susp) return res.status(404).json({ error: 'Sospensione non trovata' });
        // Cancella prima l'exception linkata (se presente), poi la suspension.
        await updateCalendar(susp.academicYear, req.user, true, async (transaction) => {
          if (susp.bookingRuleExceptionId)
            await BookingRuleException.destroy({
              where: { id: susp.bookingRuleExceptionId },
              transaction,
            });
          return susp.destroy({ transaction });
        });
        res.json({ message: 'Sospensione eliminata' });
      } catch (err) {
        next(err);
      }
    },
  );
};
