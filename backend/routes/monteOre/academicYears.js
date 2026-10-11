'use strict';

const { MonteOreSettings } = require('../../models');
const { authenticate } = require('../../middleware/auth');
const calendarService = require('../../services/monteOreCalendarService');

module.exports = function registerAcademicYears(router) {
  /**
   * GET /api/monte-ore/academic-years
   *
   * Lista degli AA disponibili. Comportamento dipendente dal ruolo:
   *
   *   - Utente NON admin → ritorna SOLO l'AA target del docente (calcolato
   *     con `resolveTargetAcademicYearForTeacher`): 1 elemento.
   *   - Admin (o `scope=admin`) → ritorna tutti gli AA con settings + flag
   *     `canCreateNew` per AA futuri non ancora presenti.
   *
   * Shape:
   *   { items: [{ academicYear, label, isCurrent, isNext, submissionOpen,
   *               hasSettings, canCreateNew? }],
   *     default: "Y/Y+1" }
   */
  router.get('/academic-years', authenticate, async (req, res, next) => {
    try {
      const today = new Date();
      const currentLabel = calendarService.currentAcademicYear(today);
      const nextLabel = calendarService.nextAcademicYear(today);

      const isAdmin =
        req.user?.role === 'admin' || (req.query.scope === 'admin' && req.user?.role === 'admin');

      if (!isAdmin) {
        // Override admin: settings con isActiveForTeachers=true vincono.
        const activeSettings = await MonteOreSettings.findOne({
          where: { isActiveForTeachers: true, status: 'published' },
        });
        const nextSettings = await MonteOreSettings.findOne({
          where: { academicYear: nextLabel },
        });
        const target = calendarService.resolveTargetAcademicYearForTeacher(
          today,
          nextSettings,
          activeSettings,
        );
        const targetSettings = await MonteOreSettings.findOne({ where: { academicYear: target } });
        const submissionOpen = targetSettings
          ? calendarService.isSubmissionWindowOpen(targetSettings, today)
          : false;
        const isNext = target === nextLabel;
        const isCurrent = target === currentLabel;
        const adminActivated = !!activeSettings && activeSettings.academicYear === target;
        let label = `AA ${target}`;
        if (adminActivated) label += " (attivato dall'amministrazione)";
        else if (isCurrent) label += ' (in corso)';
        else if (isNext) label += ' (prossimo)';
        return res.json({
          items: [
            {
              academicYear: target,
              label,
              isCurrent,
              isNext,
              submissionOpen,
              hasSettings: !!targetSettings,
              status: targetSettings?.status,
              adminActivated,
            },
          ],
          default: target,
        });
      }

      // Admin: tutti gli AA con settings + AA "futuri" candidati alla creazione.
      const all = await MonteOreSettings.findAll({ order: [['academicYear', 'DESC']] });
      const items = all.map((s) => {
        const isCurrent = s.academicYear === currentLabel;
        const isNext = s.academicYear === nextLabel;
        let label = `AA ${s.academicYear}`;
        if (s.isActiveForTeachers) label += ' (attivato per docenti)';
        else if (isCurrent) label += ' (in corso)';
        else if (isNext) label += ' (prossimo)';
        return {
          academicYear: s.academicYear,
          label,
          isCurrent,
          isNext,
          submissionOpen: calendarService.isSubmissionWindowOpen(s, today),
          hasSettings: true,
          adminActivated: !!s.isActiveForTeachers,
          settingsId: s.id,
          status: s.status,
        };
      });

      // Assicura che current e next siano presenti (anche se senza settings)
      const present = new Set(items.map((i) => i.academicYear));
      const ensure = (aaLabel) => {
        if (!present.has(aaLabel)) {
          items.push({
            academicYear: aaLabel,
            label: `AA ${aaLabel}${aaLabel === currentLabel ? ' (in corso)' : aaLabel === nextLabel ? ' (prossimo)' : ''}`,
            isCurrent: aaLabel === currentLabel,
            isNext: aaLabel === nextLabel,
            submissionOpen: false,
            hasSettings: false,
            canCreateNew: true,
          });
        }
      };
      ensure(currentLabel);
      ensure(nextLabel);

      // Ordina DESC per stringa "YYYY/YYYY"
      items.sort((a, b) => (a.academicYear < b.academicYear ? 1 : -1));

      res.json({ items, default: currentLabel });
    } catch (err) {
      next(err);
    }
  });
};
