'use strict';

/**
 * Integrazione: bootstrap AA via REST.
 *
 *   POST /api/admin/monte-ore/academic-years        (admin)
 *   GET  /api/monte-ore/academic-years              (auth)
 *   GET/POST/PATCH/DELETE /api/admin/monte-ore/exam-sessions (admin)
 *   GET  /api/admin/monte-ore/import-template.xlsx  (admin)
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { MonteOreSuspension, MonteOreSettings, Institute } = require('../../models');
const { createAuthedUser, createAdmin } = require('../factories');

describe('Academic Year Bootstrap — endpoint REST', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
    // `resolveDefaultInstituteId()` / `bootstrapAcademicYear` richiedono
    // almeno un Institute in DB.
    await Institute.create({
      name: 'Conservatorio Test',
      code: 'TEST',
      city: 'Roma',
      country: 'Italia',
    });
  });

  it('POST /academic-years (admin) — crea settings + 8 festività', async () => {
    const { authHeader } = await createAdmin();
    const r = await request(app)
      .post('/api/admin/monte-ore/academic-years')
      .set('Authorization', authHeader)
      .send({ academicYear: '2026/2027' });
    expect(r.status).toBe(201);
    expect(r.body.suspensionsCreated).toBe(8);
    expect(r.body.suspensionsSkipped).toBe(0);
    expect(r.body.settings.academicYear).toBe('2026/2027');
    expect(r.body.settings.lessonsStartDate).toBe('2026-11-02');

    const susCount = await MonteOreSuspension.count({
      where: { academicYear: '2026/2027', category: 'holiday' },
    });
    expect(susCount).toBe(8);
  });

  it('POST /academic-years — idempotente su re-run', async () => {
    const { authHeader } = await createAdmin();
    await request(app)
      .post('/api/admin/monte-ore/academic-years')
      .set('Authorization', authHeader)
      .send({ academicYear: '2026/2027' })
      .expect(201);
    const r2 = await request(app)
      .post('/api/admin/monte-ore/academic-years')
      .set('Authorization', authHeader)
      .send({ academicYear: '2026/2027' });
    expect(r2.status).toBe(201);
    expect(r2.body.suspensionsCreated).toBe(0);
    expect(r2.body.suspensionsSkipped).toBe(8);
  });

  it('POST /academic-years — rifiuta formato invalido (400)', async () => {
    const { authHeader } = await createAdmin();
    const r = await request(app)
      .post('/api/admin/monte-ore/academic-years')
      .set('Authorization', authHeader)
      .send({ academicYear: '2026-2027' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION_FAILED');
  });

  it('POST /academic-years — rifiuta non-admin (403)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const r = await request(app)
      .post('/api/admin/monte-ore/academic-years')
      .set('Authorization', authHeader)
      .send({ academicYear: '2026/2027' });
    expect([401, 403]).toContain(r.status);
  });

  it('GET /api/monte-ore/academic-years (docente) — ritorna 1 elemento (AA corrente)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const r = await request(app)
      .get('/api/monte-ore/academic-years')
      .set('Authorization', authHeader);
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.default).toBeTruthy();
  });

  it('GET /api/monte-ore/academic-years (admin) — include current+next anche senza settings', async () => {
    const { authHeader } = await createAdmin();
    const r = await request(app)
      .get('/api/monte-ore/academic-years')
      .set('Authorization', authHeader);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThanOrEqual(2);
    const labels = r.body.items.map((i) => i.academicYear);
    // Almeno corrente e prossimo presenti
    expect(new Set(labels).size).toBeGreaterThanOrEqual(2);
  });

  it('Exam sessions — CRUD completo', async () => {
    const { authHeader } = await createAdmin();
    // Setup AA
    await request(app)
      .post('/api/admin/monte-ore/academic-years')
      .set('Authorization', authHeader)
      .send({ academicYear: '2026/2027' })
      .expect(201);

    // CREATE
    const c = await request(app)
      .post('/api/admin/monte-ore/exam-sessions')
      .set('Authorization', authHeader)
      .send({
        academicYear: '2026/2027',
        name: 'Sessione estiva',
        dateFrom: '2027-06-15',
        dateTo: '2027-07-15',
      });
    expect(c.status).toBe(201);
    expect(c.body.examSession.category).toBe('exam_session');
    expect(c.body.examSession.kind).toBe('partial');
    const id = c.body.examSession.id;

    // LIST
    const l = await request(app)
      .get('/api/admin/monte-ore/exam-sessions?academicYear=2026/2027')
      .set('Authorization', authHeader);
    expect(l.status).toBe(200);
    expect(l.body.examSessions).toHaveLength(1);

    // PATCH
    const p = await request(app)
      .patch(`/api/admin/monte-ore/exam-sessions/${id}`)
      .set('Authorization', authHeader)
      .send({ name: 'Sessione estiva (rinominata)' });
    expect(p.status).toBe(200);
    expect(p.body.examSession.name).toBe('Sessione estiva (rinominata)');

    // DELETE
    const d = await request(app)
      .delete(`/api/admin/monte-ore/exam-sessions/${id}`)
      .set('Authorization', authHeader);
    expect(d.status).toBe(200);

    const after = await MonteOreSuspension.findByPk(id);
    expect(after).toBeNull();
  });

  it('GET /import-template.xlsx — ritorna xlsx scaricabile', async () => {
    const { authHeader } = await createAdmin();
    await request(app)
      .post('/api/admin/monte-ore/academic-years')
      .set('Authorization', authHeader)
      .send({ academicYear: '2026/2027' })
      .expect(201);

    const r = await request(app)
      .get('/api/admin/monte-ore/import-template.xlsx?academicYear=2026/2027')
      .set('Authorization', authHeader)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    expect(r.headers['content-disposition']).toMatch(/monteore-template-2026-2027\.xlsx/);
    // Magic bytes XLSX (zip): PK\x03\x04
    expect(r.body[0]).toBe(0x50);
    expect(r.body[1]).toBe(0x4b);
  });

  it('Bootstrap usa MonteOreSettings esistenti se overwrite=false', async () => {
    const { authHeader } = await createAdmin();
    // Prima creazione: settings con lessonsStartDate "anomalo"
    // Non possiamo crearli direttamente senza un istituto: piazziamo prima
    // un bootstrap, poi modifichiamo manualmente, poi ribootstrap senza overwrite.
    await request(app)
      .post('/api/admin/monte-ore/academic-years')
      .set('Authorization', authHeader)
      .send({ academicYear: '2026/2027' })
      .expect(201);
    const s = await MonteOreSettings.findOne({ where: { academicYear: '2026/2027' } });
    await s.update({ lessonsStartDate: '2026-11-09' });

    const r = await request(app)
      .post('/api/admin/monte-ore/academic-years')
      .set('Authorization', authHeader)
      .send({ academicYear: '2026/2027' });
    expect(r.status).toBe(201);
    await s.reload();
    expect(s.lessonsStartDate).toBe('2026-11-09');
  });
});
