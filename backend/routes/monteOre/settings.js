'use strict';

const { MonteOreSettings } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const workflow = require('../../services/monteOreWorkflowService');
const { updateCalendar } = require('../../services/monteOreCalendarUpdateService');
const calendarService = require('../../services/monteOreCalendarService');
const { validateYear, validateSettings } = require('../../services/academicYearConfig');
const { bootstrapAcademicYear } = require('../../services/academicYearBootstrap');

// Normalizzazione del payload delle impostazioni annuali.

function sanitizeSettings(body) {
  const out = {};
  const dateFields = [
    'academicYearStart',
    'academicYearEnd',
    'lessonsStartDate',
    'lessonsEndDate',
    'submissionWindowStart',
    'submissionWindowEnd',
  ];
  for (const f of dateFields) {
    if (body[f] !== undefined) out[f] = body[f] ? String(body[f]).slice(0, 10) : null;
  }
  if (body.minRequiredHours !== undefined) out.minRequiredHours = Number(body.minRequiredHours);
  if (body.maxAmendmentsPerYear !== undefined)
    out.maxAmendmentsPerYear = Number(body.maxAmendmentsPerYear);
  // Vincoli giornalieri (Z2/Z3): nullable, "" o null → null, numero altrimenti.
  // Il range è validato dal modello; qui ci limitiamo a normalizzare il tipo.
  if (body.maxHoursPerDay !== undefined) out.maxHoursPerDay = nullableNumber(body.maxHoursPerDay);
  if (body.dailyBreakAfterHours !== undefined)
    out.dailyBreakAfterHours = nullableNumber(body.dailyBreakAfterHours);
  if (body.dailyBreakMinutes !== undefined)
    out.dailyBreakMinutes = nullableNumber(body.dailyBreakMinutes, { integer: true });
  return out;
}

function nullableNumber(v, { integer = false } = {}) {
  if (v === null || v === '' || v === undefined) return null;
  const n = integer ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : null;
}

const { resolveDefaultInstituteId } = require('./shared');

module.exports = function registerSettings(adminRouter) {
  // ---- Settings ----
  adminRouter.get('/settings/list', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const where = {};
      if (req.query.academicYear) where.academicYear = req.query.academicYear;
      const items = await MonteOreSettings.findAll({ where, order: [['academicYear', 'DESC']] });
      res.json({ settings: items.map((s) => s.toJSON()) });
    } catch (err) {
      next(err);
    }
  });

  adminRouter.get('/settings', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const year = req.query.academicYear || calendarService.currentAcademicYear();
      validateYear(year);
      const instituteId = await resolveDefaultInstituteId();
      const settings = await MonteOreSettings.findOne({
        where: { academicYear: year, instituteId },
      });
      res.json({ settings: settings ? settings.toJSON() : null });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });

  adminRouter.put('/settings', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const year = req.body.academicYear || calendarService.currentAcademicYear();
      validateYear(year);
      const instituteId = await resolveDefaultInstituteId();
      const settings = await updateCalendar(
        year,
        req.user,
        req.body.confirmImpact === true,
        async (transaction) => {
          let target = await MonteOreSettings.findOne({
            where: { academicYear: year, instituteId },
            transaction,
          });
          if (!target) {
            const created = await bootstrapAcademicYear({
              academicYear: year,
              instituteId,
              settings: sanitizeSettings(req.body),
              transaction,
            });
            return created.settings;
          }
          if (target.status === 'archived')
            workflow.fail(
              'Anno archiviato: ripubblicalo prima di modificarlo',
              'ACADEMIC_YEAR_ARCHIVED',
              409,
            );
          const values = sanitizeSettings(req.body);
          validateSettings({ ...target.toJSON(), ...values });
          await target.update(values, { transaction });
          return target.toJSON();
        },
      );
      res.json({ settings });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      // Errore di validazione model (es. range fuori scope o coerenza
      // dailyBreakAfterHours/dailyBreakMinutes) → 400 con messaggio leggibile
      // invece di 500 generico.
      if (err.name === 'SequelizeValidationError') {
        return res.status(400).json({
          error: err.errors?.[0]?.message || err.message,
          code: 'INVALID_SETTINGS',
        });
      }
      next(err);
    }
  });
};
