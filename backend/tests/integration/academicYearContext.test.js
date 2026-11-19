'use strict';

const request = require('supertest');
const { buildApp } = require('../../app');
const { Institute, MonteOreSettings, User } = require('../../models');
const { createAuthedUser } = require('../factories');

describe('Anno accademico di riferimento: omissione anno e coerenza UI/enforcement', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function makeSettings(academicYear, over = {}) {
    const institute = await Institute.create({
      name: `I${academicYear}`,
      code: `I${academicYear.slice(0, 4)}`,
      city: 'X',
      country: 'IT',
    });
    return MonteOreSettings.create({
      instituteId: institute.id,
      academicYear,
      academicYearStart: '2020-11-01',
      academicYearEnd: '2021-10-31',
      lessonsStartDate: '2020-11-03',
      lessonsEndDate: '2021-06-26',
      submissionWindowStart: '2020-01-01',
      submissionWindowEnd: '2020-02-01', // sempre chiusa
      minRequiredHours: 10,
      maxAmendmentsPerYear: 3,
      ...over,
    });
  }

  it("anno omesso: le rotte docente usano l'anno attivato dall'admin, non il calendario", async () => {
    await makeSettings('2020/2021', { isActiveForTeachers: true, status: 'published' });
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app).get('/api/monte-ore/me').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.proposal.academicYear).toBe('2020/2021');
  });

  it('anno esplicito (query.year) vince sul bersaglio', async () => {
    await makeSettings('2020/2021', { isActiveForTeachers: true, status: 'published' });
    await makeSettings('2019/2020', { status: 'published' });
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app)
      .get('/api/monte-ore/me?year=2019/2020')
      .set('Authorization', authHeader);
    expect(res.body.proposal.academicYear).toBe('2019/2020');
  });

  it("il flag submissionOpen della UI coincide con il controllo dell'invio", async () => {
    await makeSettings('2020/2021', { isActiveForTeachers: true, status: 'published' });
    const a = await createAuthedUser({ role: 'docente' });
    const b = await createAuthedUser({ role: 'docente' });
    await User.update(
      { monteOreSubmissionAllowedUntil: '2999-12-31' },
      { where: { id: b.user.id } },
    );

    for (const [who, expectedOpen] of [
      [a, false],
      [b, true],
    ]) {
      const list = await request(app)
        .get('/api/monte-ore/academic-years')
        .set('Authorization', who.authHeader);
      const item = list.body.items[0];
      expect(item.academicYear).toBe('2020/2021');
      expect(item.submissionOpen).toBe(expectedOpen);
      expect(item.submissionClosedReason).toBe(expectedOpen ? null : 'OUTSIDE_SUBMISSION_WINDOW');

      const submit = await request(app)
        .post('/api/monte-ore/me/submit')
        .set('Authorization', who.authHeader)
        .send({});
      expect(submit.body.code === 'OUTSIDE_SUBMISSION_WINDOW').toBe(!expectedOpen);
    }
  });
});
