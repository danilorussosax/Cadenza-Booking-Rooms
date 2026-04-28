'use strict';

/**
 * Integrazione: middleware/audit.js.
 *
 * Verifica che le scritture su rotte "audit-coperte" creino una riga in
 * AuditLog. Si testano:
 *   - POST /api/courses (creazione)
 *   - DELETE /api/courses/:id
 *   - skip su 4xx (errori non vengono auditati)
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { AuditLog } = require('../../models');
const { createAdmin, createUser } = require('../factories');

const app = buildApp({ serveFrontend: false });

describe('audit middleware', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('crea una entry per POST /api/courses (admin)', async () => {
    const { user, authHeader } = await createAdmin();

    const res = await request(app)
      .post('/api/courses')
      .set('Authorization', authHeader)
      .send({ code: 'AUDIT01', name: 'Corso audit' });

    expect(res.status).toBe(201);
    const courseId = res.body.course.id;

    const entries = await AuditLog.findAll({ where: { actorId: user.id } });
    expect(entries.length).toBe(1);
    const entry = entries[0];
    expect(entry.action).toBe('POST');
    expect(entry.targetType).toBe('course');
    expect(entry.statusCode).toBe(201);
    // payload viene sanitizzato: il body con `code` è preservato
    expect(entry.payload).toMatchObject({ code: 'AUDIT01' });
    // response summary: entityId catturato
    expect(entry.response).toMatchObject({ entityKey: 'course', entityId: courseId });
  });

  it('crea una entry per DELETE /api/courses/:id', async () => {
    const { user, authHeader } = await createAdmin();
    // Creo un corso dapprima (la creazione genera già una entry).
    const created = await request(app)
      .post('/api/courses')
      .set('Authorization', authHeader)
      .send({ code: 'AUDIT02', name: 'Da cancellare' });
    expect(created.status).toBe(201);
    const courseId = created.body.course.id;

    const del = await request(app)
      .delete(`/api/courses/${courseId}`)
      .set('Authorization', authHeader);
    expect(del.status).toBeLessThan(400);

    const entries = await AuditLog.findAll({
      where: { actorId: user.id, action: 'DELETE' },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].targetType).toBe('course');
    expect(entries[0].targetId).toBe(courseId);
  });

  it('NON crea una entry quando la richiesta fallisce (4xx)', async () => {
    const { authHeader } = await createAdmin();
    // Body vuoto → 400 dal validatore
    const res = await request(app).post('/api/courses').set('Authorization', authHeader).send({});
    expect(res.status).toBe(400);

    const entries = await AuditLog.findAll();
    expect(entries.length).toBe(0);
  });

  it('redacta password / token nel payload', async () => {
    const { authHeader } = await createAdmin();
    // PUT /api/users/:id è coperto dal pattern audit (targetType='user').
    const target = await createUser({ email: 'redact@test.invalid' });

    const res = await request(app)
      .put(`/api/users/${target.id}`)
      .set('Authorization', authHeader)
      .send({
        firstName: 'NuovoNome',
        newPassword: 'NewPlaintextPwd1!',
      });
    expect(res.status).toBeLessThan(400);

    const entry = await AuditLog.findOne({
      where: { targetType: 'user', action: 'PUT', targetId: target.id },
    });
    expect(entry).toBeTruthy();
    expect(entry.payload.newPassword).toBe('[REDACTED]');
    expect(entry.payload.firstName).toBe('NuovoNome');
  });
});
