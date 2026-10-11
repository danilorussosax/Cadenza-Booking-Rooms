'use strict';

const { MonteOreSettings, Institute } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const workflow = require('../../services/monteOreWorkflowService');
const { updateCalendar } = require('../../services/monteOreCalendarUpdateService');
const calendarService = require('../../services/monteOreCalendarService');
const { validateYear, validateSettings } = require('../../services/academicYearConfig');

const {
  bootstrapAcademicYear,
  previewAcademicYear,
} = require('../../services/academicYearBootstrap');

// IMPORTANTE: le route concrete (/settings, /suspensions, /amendments) DEVONO
// stare PRIMA delle route param /:id, altrimenti Express matcha "settings"
// come parametro :id e ritorna 404 dal handler proposta.

// ---- Academic Years (bootstrap) ----
/**
 * POST /api/admin/monte-ore/academic-years
 *
 * Body: { academicYear, mode?, previousYear?, overwrite? }
 *
 *   - `academicYear` deve matchare `^\d{4}/\d{4}$` con Y+1 = secondo numero.
 *   - `mode` ∈ {'default','from_previous'} (default 'default').
 *   - `previousYear` richiesto in mode='from_previous'.
 *   - `overwrite` (default false) → se true sovrascrive settings esistenti e
 *     ri-applica le festività deterministiche.
 *
 * Ritorna `{ settings, suspensionsCreated, suspensionsSkipped }`.
 */
// HTTP input never supplies a transaction or changes the installation's institute.
function academicYearInput(body = {}) {
  return Object.fromEntries(
    [
      'academicYear',
      'mode',
      'previousYear',
      'copyRules',
      'copyCalendar',
      'copyCustom',
      'copyExamSessions',
      'settings',
      'publish',
    ]
      .filter((key) => body[key] !== undefined)
      .map((key) => [key, body[key]]),
  );
}

const { resolveDefaultInstituteId } = require('./shared');

module.exports = function registerAdminAcademicYears(adminRouter) {
  adminRouter.post(
    '/academic-years/preview',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        res.json(await previewAcademicYear(academicYearInput(req.body)));
      } catch (err) {
        next(err);
      }
    },
  );

  adminRouter.post(
    '/academic-years',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        validateYear(req.body.academicYear);
        const result = await updateCalendar(
          req.body.academicYear,
          req.user,
          req.body.confirmImpact === true,
          (transaction) =>
            bootstrapAcademicYear({
              ...academicYearInput(req.body),
              overwrite: req.body.overwrite === true,
              transaction,
            }),
        );
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  adminRouter.post(
    '/academic-years/:academicYear/status',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const { academicYear } = req.params;
        validateYear(academicYear);
        const status = req.body.status;
        if (!['published', 'archived'].includes(status)) workflow.fail('Stato non valido');
        const instituteId = await resolveDefaultInstituteId();
        const settings = await workflow.transact(async (transaction) => {
          await Institute.findByPk(instituteId, { transaction, lock: transaction.LOCK.UPDATE });
          const target = await MonteOreSettings.findOne({
            where: { academicYear, instituteId },
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          if (!target) workflow.fail('Anno non trovato', 'NOT_FOUND', 404);
          if (status === 'published') validateSettings(target.toJSON());
          if (status === 'archived') {
            const active = await MonteOreSettings.findOne({
              where: { instituteId, isActiveForTeachers: true, status: 'published' },
              transaction,
            });
            const reference = calendarService.referenceAcademicYear(active);
            if (calendarService.academicYearPhase(academicYear, reference) !== 'past')
              workflow.fail(
                'Puoi archiviare solo gli anni accademici passati',
                'ACADEMIC_YEAR_NOT_ENDED',
                409,
              );
          }
          await target.update(
            { status, ...(status === 'archived' ? { isActiveForTeachers: false } : {}) },
            { transaction },
          );
          return target;
        });
        res.json({ settings });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /api/admin/monte-ore/academic-years/:academicYear/activate-for-teachers
   *
   * Marca l'AA specificato come "attivo per i docenti": vince sulla logica
   * automatica della finestra di submission. Atomico in transazione:
   * disattiva tutti gli altri AA dello stesso istituto, poi attiva quello
   * indicato. Body opzionale: `{ active: false }` per rimuovere l'override.
   *
   * Ritorna `{ activated: settings|null, deactivated: number }`.
   */
  adminRouter.post(
    '/academic-years/:academicYear/activate-for-teachers',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const { academicYear } = req.params;
        const active = req.body?.active !== false; // default true
        if (!/^\d{4}\/\d{4}$/.test(academicYear)) {
          return res.status(400).json({ error: 'academicYear non valido' });
        }
        const instituteId = await resolveDefaultInstituteId();
        const target = await MonteOreSettings.findOne({ where: { academicYear, instituteId } });
        if (!target) {
          return res.status(404).json({ error: 'Settings non trovati per questo AA' });
        }
        if (active && target.status !== 'published')
          workflow.fail(
            'Pubblica prima questo anno accademico',
            'ACADEMIC_YEAR_NOT_PUBLISHED',
            409,
          );
        const result = await workflow.transact(async (t) => {
          await Institute.findByPk(instituteId, { transaction: t, lock: t.LOCK.UPDATE });
          await target.reload({ transaction: t });
          if (active && target.status !== 'published')
            workflow.fail(
              'Pubblica prima questo anno accademico',
              'ACADEMIC_YEAR_NOT_PUBLISHED',
              409,
            );
          const [deactivated] = await MonteOreSettings.update(
            { isActiveForTeachers: false },
            {
              where: {
                instituteId: target.instituteId,
                isActiveForTeachers: true,
                ...(active ? {} : { id: target.id }),
              },
              transaction: t,
            },
          );
          if (active) {
            target.isActiveForTeachers = true;
            await target.save({ transaction: t });
          }
          return { deactivated };
        });
        const fresh = await MonteOreSettings.findByPk(target.id);
        res.json({ activated: active ? fresh : null, deactivated: result.deactivated });
      } catch (err) {
        next(err);
      }
    },
  );
};
