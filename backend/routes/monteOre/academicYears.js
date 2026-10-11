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
   * `phase` ('past'|'current'|'next'|'future') è relativa all'AA di riferimento:
   * l'AA avviato dall'admin, altrimenti quello del calendario.
   *
   * Shape:
   *   { items: [{ academicYear, label, phase, isCurrent, isNext, submissionOpen,
   *               hasSettings, canCreateNew? }],
   *     default: "Y/Y+1" }
   */
  router.get('/academic-years', authenticate, async (req, res, next) => {
    try {
      const today = new Date();
      const currentLabel = calendarService.currentAcademicYear(today);
      const nextLabel = calendarService.nextAcademicYear(today);

      const activeForRef = await MonteOreSettings.findOne({
        where: { isActiveForTeachers: true, status: 'published' },
      });
      const referenceYear = calendarService.referenceAcademicYear(activeForRef, today);
      const phaseOf = (aa) => calendarService.academicYearPhase(aa, referenceYear);
      const labelOf = (aa) => `AA ${aa} (${calendarService.PHASE_LABEL_IT[phaseOf(aa)]})`;

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
        const label = labelOf(target);
        return res.json({
          items: [
            {
              academicYear: target,
              label,
              phase: phaseOf(target),
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
        return {
          academicYear: s.academicYear,
          label: labelOf(s.academicYear),
          phase: phaseOf(s.academicYear),
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
            label: labelOf(aaLabel),
            phase: phaseOf(aaLabel),
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

      res.json({ items, default: referenceYear });
    } catch (err) {
      next(err);
    }
  });
};
