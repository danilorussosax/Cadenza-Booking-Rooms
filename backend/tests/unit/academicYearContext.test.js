'use strict';

const ctx = require('../../services/academicYearContext');

const published = (over = {}) => ({
  academicYear: '2025/2026',
  status: 'published',
  submissionWindowStart: '2025-09-01',
  submissionWindowEnd: '2025-10-31',
  ...over,
});

describe('academicYearContext.readYearParam', () => {
  it.each([
    [{ body: { academicYear: 'A' } }, 'A'],
    [{ body: { year: 'B' } }, 'B'],
    [{ query: { academicYear: 'C' } }, 'C'],
    [{ query: { year: 'D' } }, 'D'],
    [{ body: { academicYear: 'A' }, query: { year: 'D' } }, 'A'],
    [{ body: {}, query: {} }, null],
    [{ body: { academicYear: '  ' } }, null],
  ])('%j -> %s', (req, expected) => {
    expect(ctx.readYearParam(req)).toBe(expected);
  });
});

describe('academicYearContext.buildContext (data x stato x deroga)', () => {
  const inWindow = new Date('2025-10-15T10:00:00');
  const after = new Date('2025-11-20T10:00:00');
  const grant = { monteOreSubmissionAllowedUntil: '2025-12-31' };
  const expiredGrant = { monteOreSubmissionAllowedUntil: '2025-11-01' };
  const CLOSED = 'OUTSIDE_SUBMISSION_WINDOW';
  const NOT_PUB = 'ACADEMIC_YEAR_NOT_PUBLISHED';

  const table = [
    ['finestra aperta', published(), null, inWindow, true, null, false],
    ['finestra chiusa', published(), null, after, false, CLOSED, false],
    ['chiusa + deroga valida', published(), grant, after, true, null, true],
    ['chiusa + deroga scaduta', published(), expiredGrant, after, false, CLOSED, false],
    ['bozza', published({ status: 'draft' }), grant, inWindow, false, NOT_PUB, false],
    ['archiviato', published({ status: 'archived' }), null, inWindow, false, NOT_PUB, false],
  ];
  it.each(table)('%s', (_n, settings, user, today, canSubmit, reason, viaGrant) => {
    const r = ctx.buildContext('2025/2026', settings, user, today);
    expect(r.canSubmit).toBe(canSubmit);
    expect(r.reason).toBe(reason);
    expect(r.viaIndividualGrant).toBe(viaGrant);
    expect(r.status).toBe(settings.status);
  });

  it('senza impostazioni (piani legacy) resta aperto', () => {
    const r = ctx.buildContext('2020/2021', null, null, after);
    expect(r).toMatchObject({ canSubmit: true, legacy: true, status: null, reason: null });
  });
});
