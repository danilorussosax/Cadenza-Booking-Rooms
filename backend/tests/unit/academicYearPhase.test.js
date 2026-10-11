'use strict';

const svc = require('../../services/monteOreCalendarService');

describe('academicYearPhase', () => {
  it('classifica gli AA rispetto al riferimento', () => {
    expect(svc.academicYearPhase('2024/2025', '2025/2026')).toBe('past');
    expect(svc.academicYearPhase('2025/2026', '2025/2026')).toBe('current');
    expect(svc.academicYearPhase('2026/2027', '2025/2026')).toBe('next');
    expect(svc.academicYearPhase('2027/2028', '2025/2026')).toBe('future');
  });

  it("usa l'AA avviato dall'admin come riferimento, altrimenti il calendario", () => {
    const today = new Date('2026-05-13');
    expect(svc.referenceAcademicYear(null, today)).toBe('2025/2026');
    expect(svc.referenceAcademicYear({ academicYear: '2026/2027' }, today)).toBe('2026/2027');
  });
});
