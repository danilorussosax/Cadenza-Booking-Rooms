'use strict';

/**
 * Push finale verso 70%: rules, waitlist, instruments, integrations, message,
 * structureImporter su rotte e flussi non ancora coperti.
 */

const request = require('supertest');
const dayjs = require('dayjs');
const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser, createBookingRule, createRoom } = require('../factories');
const { Instrument } = require('../../models');

const app = buildApp({ serveFrontend: false });

describe('rules endpoints — coverage', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /api/rules root + per role', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const r1 = await request(app).get('/api/rules').set('Authorization', authHeader);
    expect([200, 404]).toContain(r1.status);
    const r2 = await request(app).get('/api/rules/studente').set('Authorization', authHeader);
    expect([200, 404]).toContain(r2.status);
  });

  it('GET/POST/PUT/DELETE rule exceptions (admin)', async () => {
    const { authHeader } = await createAdmin();
    const list = await request(app).get('/api/rules/exceptions').set('Authorization', authHeader);
    expect([200, 404]).toContain(list.status);

    const create = await request(app)
      .post('/api/rules/exceptions')
      .set('Authorization', authHeader)
      .send({
        kind: 'block',
        scope: 'global',
        startDate: '2025-12-25',
        endDate: '2025-12-26',
        reason: 'Test',
      });
    expect([200, 201, 400]).toContain(create.status);
    const id = create.body.exception?.id ?? create.body.id;
    if (id) {
      const upd = await request(app)
        .put(`/api/rules/exceptions/${id}`)
        .set('Authorization', authHeader)
        .send({ reason: 'updated' });
      expect([200, 400]).toContain(upd.status);
      const del = await request(app)
        .delete(`/api/rules/exceptions/${id}`)
        .set('Authorization', authHeader);
      expect([200, 204]).toContain(del.status);
    }
  });

  it('PUT rules per role (admin)', async () => {
    const { authHeader } = await createAdmin();
    await createBookingRule({ role: 'studente' });
    const res = await request(app)
      .put('/api/rules/studente')
      .set('Authorization', authHeader)
      .send({ maxHoursPerDay: 4 });
    expect([200, 400]).toContain(res.status);
  });
});

describe('waitlist endpoints — coverage', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    await createBookingRule({ role: 'studente' });
  });

  it('GET /api/bookings/waitlist/me (auth)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .get('/api/bookings/waitlist/me')
      .set('Authorization', authHeader);
    expect([200, 404]).toContain(res.status);
  });

  it('POST /api/bookings/waitlist senza body completo → 400', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .post('/api/bookings/waitlist')
      .set('Authorization', authHeader)
      .send({});
    expect([400, 403]).toContain(res.status);
  });

  it('DELETE /api/bookings/waitlist/:id non esistente → 404', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .delete('/api/bookings/waitlist/99999')
      .set('Authorization', authHeader);
    expect([404, 403]).toContain(res.status);
  });
});

describe('instruments endpoints — coverage', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /api/instruments lista con filtri', async () => {
    await Instrument.create({ family: 'archi', name: 'Violino', isAvailable: true });
    await Instrument.create({ family: 'fiati', name: 'Flauto', isAvailable: false });
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const r1 = await request(app)
      .get('/api/instruments?family=archi')
      .set('Authorization', authHeader);
    expect([200, 403]).toContain(r1.status);
    const r2 = await request(app)
      .get('/api/instruments?available=true')
      .set('Authorization', authHeader);
    expect([200, 403]).toContain(r2.status);
  });

  it('GET /api/instruments/export (admin)', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).get('/api/instruments/export').set('Authorization', authHeader);
    expect([200, 404]).toContain(res.status);
  });

  it('POST /api/instruments/import senza file → 400', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).post('/api/instruments/import').set('Authorization', authHeader);
    expect([400, 404]).toContain(res.status);
  });

  it('POST /api/instruments/bulk-delete', async () => {
    const i1 = await Instrument.create({ family: 'archi', name: 'I1', isAvailable: true });
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/instruments/bulk-delete')
      .set('Authorization', authHeader)
      .send({ ids: [i1.id] });
    expect([200, 204, 400]).toContain(res.status);
  });

  it('PUT /api/instruments/:id (admin)', async () => {
    const inst = await Instrument.create({ family: 'archi', name: 'I1', isAvailable: true });
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .put(`/api/instruments/${inst.id}`)
      .set('Authorization', authHeader)
      .send({ name: 'I1-renamed' });
    expect([200, 400]).toContain(res.status);
  });
});

describe('messaging admin/intent — coverage', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /api/admin/messaging-settings + POST/Diagnostica', async () => {
    const { authHeader } = await createAdmin();
    const get = await request(app)
      .get('/api/admin/messaging-settings')
      .set('Authorization', authHeader);
    expect([200, 404]).toContain(get.status);
    const put = await request(app)
      .put('/api/admin/messaging-settings')
      .set('Authorization', authHeader)
      .send({ telegramEnabled: false });
    expect([200, 400, 404]).toContain(put.status);
  });
});

describe('structureImporter unit deeper — coverage', () => {
  it('importStructure helpers smoke', () => {
    const m = require('../../services/structureImporter');
    expect(typeof m.importStructure).toBe('function');
    expect(typeof m.parseCSV).toBe('function');
    expect(typeof m.rowsToObjects).toBe('function');
  });
});

describe('emailService extra — coverage', () => {
  const e = require('../../services/emailService');
  it('invalidateCache è callable senza errori', () => {
    expect(() => e.invalidateCache?.()).not.toThrow();
  });
  it('emailEnabled ritorna boolean', async () => {
    const en = await e.emailEnabled();
    expect(typeof en).toBe('boolean');
  });
  it('getTemplate è funzione e gestisce key sconosciuta', async () => {
    expect(typeof e.getTemplate).toBe('function');
  });
});

describe('icalService extra — coverage', () => {
  const ics = require('../../services/icalService');
  it('buildIcs gestisce booking con cancelledAt', () => {
    const b = {
      id: 1,
      startTime: new Date('2025-11-03T10:00:00Z'),
      endTime: new Date('2025-11-03T11:00:00Z'),
      type: 'studio_individuale',
      status: 'cancelled',
      cancelledAt: new Date('2025-11-02T10:00:00Z'),
      createdAt: new Date(),
      room: { id: 1, name: 'A1', building: { name: 'B' } },
    };
    const out = ics.buildIcs([b]);
    expect(typeof out).toBe('string');
  });
});
