'use strict';
const request = require('supertest');
const { buildApp } = require('../../app');
const { sequelize, Institute, MonteOreSettings, MonteOreSuspension } = require('../../models');
const { createAdmin, createAuthedUser } = require('../factories');
const {
  bootstrapAcademicYear,
  previewAcademicYear,
  ensureBootstrapForActiveYears,
} = require('../../services/academicYearBootstrap');
const { defaultSettingsFor } = require('../../services/academicYearConfig');

describe('Academic year preparation and publication', () => {
  let app, authHeader, instituteId;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await resetDatabase();
    instituteId = (
      await Institute.create({ name: 'Test', code: 'AA', city: 'Roma', country: 'Italia' })
    ).id;
    ({ authHeader } = await createAdmin());
  });
  const post = (url, body) =>
    request(app).post(`/api/admin/monte-ore/${url}`).set('Authorization', authHeader).send(body);

  it('preview is read only and GET settings never creates a partial calendar', async () => {
    const preview = await post('academic-years/preview', { academicYear: '2026/2027' }).expect(200);
    expect(preview.body.settings.lessonsStartDate).toBe('2026-11-02');
    expect(preview.body.suspensions).toHaveLength(6);
    expect(preview.body.availableDays[1]).toBeGreaterThan(0);
    const read = await request(app)
      .get('/api/admin/monte-ore/settings?academicYear=2026/2027')
      .set('Authorization', authHeader)
      .expect(200);
    expect(read.body.settings).toBeNull();
    expect(await MonteOreSettings.count()).toBe(0);
    expect(await MonteOreSuspension.count()).toBe(0);
  });

  it('draft cannot be activated or opened by a teacher; publishing preserves closed window', async () => {
    const created = await post('academic-years', { academicYear: '2030/2031' }).expect(201);
    expect(created.body.settings.status).toBe('draft');
    await post('academic-years/2030%2F2031/activate-for-teachers', {}).expect(409);
    const teacher = await createAuthedUser({ role: 'docente' });
    await request(app)
      .get('/api/monte-ore/me?year=2030/2031')
      .set('Authorization', teacher.authHeader)
      .expect(409);
    await post('academic-years/2030%2F2031/status', { status: 'published' }).expect(200);
    await post('academic-years/2030%2F2031/activate-for-teachers', {}).expect(200);
    const target = await request(app)
      .get('/api/monte-ore/academic-years')
      .set('Authorization', teacher.authHeader)
      .expect(200);
    expect(target.body.items[0]).toMatchObject({
      academicYear: '2030/2031',
      status: 'published',
      submissionOpen: false,
    });
  });

  it('removing an old override does not deactivate the newly selected year', async () => {
    for (const year of ['2030/2031', '2031/2032']) {
      await post('academic-years', { academicYear: year, publish: true }).expect(201);
      await post(`academic-years/${encodeURIComponent(year)}/activate-for-teachers`, {}).expect(
        200,
      );
    }
    await post('academic-years/2030%2F2031/activate-for-teachers', { active: false }).expect(200);
    expect(
      (await MonteOreSettings.findOne({ where: { academicYear: '2031/2032' } }))
        .isActiveForTeachers,
    ).toBe(true);
  });

  it('copies rules and calendar across multiple years and clamps leap day', async () => {
    await bootstrapAcademicYear({ academicYear: '2023/2024', instituteId });
    await MonteOreSettings.update(
      { minRequiredHours: 160, maxHoursPerDay: 8, dailyBreakAfterHours: 6, dailyBreakMinutes: 30 },
      { where: { academicYear: '2023/2024' } },
    );
    await MonteOreSuspension.create({
      instituteId,
      academicYear: '2023/2024',
      name: 'Sessione',
      category: 'exam_session',
      kind: 'partial',
      dateFrom: '2024-02-29',
      dateTo: '2024-03-02',
    });
    const options = {
      academicYear: '2026/2027',
      instituteId,
      mode: 'from_previous',
      previousYear: '2023/2024',
    };
    const preview = await previewAcademicYear(options);
    expect(preview.settings).toMatchObject({
      minRequiredHours: 160,
      dailyBreakMinutes: 30,
      maxHoursPerDay: 8,
    });
    expect(preview.suspensions.find((s) => s.name === 'Sessione')).toMatchObject({
      dateFrom: '2027-02-28',
      dateTo: '2027-03-02',
    });
    await bootstrapAcademicYear(options);
    await bootstrapAcademicYear({ ...options, overwrite: true });
    await bootstrapAcademicYear({ ...options, overwrite: true });
    expect(await MonteOreSuspension.count({ where: { academicYear: '2026/2027' } })).toBe(7);
    const standard = await previewAcademicYear({
      ...options,
      copyRules: false,
      copyCalendar: false,
      copyExamSessions: false,
    });
    expect(standard.settings.minRequiredHours).toBe(324);
    expect(standard.suspensions).toHaveLength(6);
  });

  it('keeps distinct custom suspensions with the same name on repeated copies', async () => {
    await bootstrapAcademicYear({ academicYear: '2023/2024', instituteId });
    for (const month of ['02', '06'])
      await MonteOreSuspension.create({
        instituteId,
        academicYear: '2023/2024',
        name: 'Esami',
        category: 'custom',
        kind: 'partial',
        dateFrom: `2024-${month}-01`,
        dateTo: `2024-${month}-03`,
      });
    const options = {
      academicYear: '2026/2027',
      instituteId,
      mode: 'from_previous',
      previousYear: '2023/2024',
    };
    await bootstrapAcademicYear(options);
    await bootstrapAcademicYear({ ...options, overwrite: true });
    expect(
      await MonteOreSuspension.count({ where: { academicYear: '2026/2027', name: 'Esami' } }),
    ).toBe(2);
  });

  it.skipIf(sequelize.getDialect() !== 'postgres')(
    'serializes concurrent bootstrap across workers',
    async () => {
      await Promise.all([
        bootstrapAcademicYear({ academicYear: '2026/2027', instituteId }),
        bootstrapAcademicYear({ academicYear: '2026/2027', instituteId }),
      ]);
      expect(await MonteOreSettings.count()).toBe(1);
      expect(await MonteOreSuspension.count()).toBe(6);
    },
  );

  it('restarts preserve removed and rescheduled holidays', async () => {
    await ensureBootstrapForActiveYears({ today: new Date('2026-10-11T12:00:00Z') });
    await MonteOreSuspension.destroy({ where: { academicYear: '2026/2027', name: 'Immacolata' } });
    await MonteOreSuspension.update(
      { dateFrom: '2026-12-23' },
      { where: { academicYear: '2026/2027', name: 'Vacanze di Natale' } },
    );
    await ensureBootstrapForActiveYears({ today: new Date('2026-10-11T12:00:00Z') });
    expect(await MonteOreSuspension.count({ where: { academicYear: '2026/2027' } })).toBe(5);
    expect(
      (
        await MonteOreSuspension.findOne({
          where: { academicYear: '2026/2027', name: 'Vacanze di Natale' },
        })
      ).dateFrom,
    ).toBe('2026-12-23');
  });

  it('rejects invalid source, dates and numeric rules without partial writes', async () => {
    for (const body of [
      { academicYear: '2026/2028' },
      { academicYear: '2026/2027', mode: 'from_previous' },
      { academicYear: '2026/2027', mode: 'from_previous', previousYear: '2026/2027' },
      { academicYear: '2026/2027', settings: { lessonsStartDate: '2027-02-30' } },
      { academicYear: '2026/2027', settings: { lessonsEndDate: '2026-01-01' } },
      { academicYear: '2026/2027', settings: { minRequiredHours: -1 } },
    ])
      await post('academic-years', body).expect(400);
    expect(await MonteOreSettings.count()).toBe(0);
  });

  it('PUT settings initializes via the same service and rolls back invalid changes', async () => {
    const send = (body) =>
      request(app).put('/api/admin/monte-ore/settings').set('Authorization', authHeader).send(body);
    await send({ academicYear: '2026/2027', lessonsStartDate: '2027-02-30' }).expect(400);
    expect(await MonteOreSettings.count()).toBe(0);
    const result = await send({ academicYear: '2026/2027', minRequiredHours: 200 }).expect(200);
    expect(result.body.settings).toMatchObject({
      lessonsStartDate: '2026-11-02',
      status: 'draft',
      minRequiredHours: 200,
    });
    expect(await MonteOreSuspension.count()).toBe(6);
  });

  it('only completed years can be archived; archived calendars cannot mutate', async () => {
    await post('academic-years', { academicYear: '2020/2021', publish: true }).expect(201);
    await post('academic-years/2020%2F2021/status', { status: 'archived' }).expect(200);
    await request(app)
      .put('/api/admin/monte-ore/settings')
      .set('Authorization', authHeader)
      .send({ academicYear: '2020/2021', minRequiredHours: 1 })
      .expect(409);
    await post('academic-years/2020%2F2021/status', { status: 'published' }).expect(200);
    await post('academic-years', { academicYear: '2090/2091' }).expect(201);
    await post('academic-years/2090%2F2091/status', { status: 'archived' }).expect(409);
  });

  it('migration preserves existing years as published and is repeatable', async () => {
    // A legacy table without the new column, isolated from application tables.
    const qi = sequelize.getQueryInterface();
    await MonteOreSettings.create({
      instituteId,
      academicYear: '2020/2021',
      ...defaultSettingsFor('2020/2021'),
    });
    await qi.removeColumn('monte_ore_settings', 'status');
    const migration = require('../../lib/academicYearMigration');
    await migration.up(qi);
    await migration.up(qi);
    expect((await MonteOreSettings.findOne()).status).toBe('published');
  });
});
