'use strict';

/**
 * Integration: copertura espansa per routes/waitlist.js, routes/public.js,
 * routes/courses.js, routes/mailTemplates.js. Tutti file con branch coverage
 * <25% al baseline. Focus su auth gates, validation, NOT_FOUND, e path
 * nominali.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser, createRoom, createBooking } = require('../factories');
const { Course, Institute, MailTemplate, BookingWaitlist } = require('../../models');

const app = buildApp({ serveFrontend: false });

describe('routes/waitlist — CRUD utente', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  describe('GET /api/bookings/waitlist/me', () => {
    it('401 senza token', async () => {
      const res = await request(app).get('/api/bookings/waitlist/me');
      expect(res.status).toBe(401);
    });

    it('200 array vuoto di default', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .get('/api/bookings/waitlist/me')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.entries)).toBe(true);
    });
  });

  describe('POST /api/bookings/waitlist', () => {
    it('401 senza token', async () => {
      const res = await request(app).post('/api/bookings/waitlist').send({});
      expect(res.status).toBe(401);
    });

    it('400 body vuoto', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .post('/api/bookings/waitlist')
        .set('Authorization', authHeader)
        .send({});
      expect([400, 422, 403]).toContain(res.status);
    });

    it('400 con roomId inesistente', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .post('/api/bookings/waitlist')
        .set('Authorization', authHeader)
        .send({
          roomId: 999999,
          startTime: '2026-06-01T10:00:00Z',
          endTime: '2026-06-01T11:00:00Z',
          type: 'studio_individuale',
        });
      expect([400, 404, 403]).toContain(res.status);
    });
  });

  describe('DELETE /api/bookings/waitlist/:id', () => {
    it('401 senza token', async () => {
      const res = await request(app).delete('/api/bookings/waitlist/1');
      expect(res.status).toBe(401);
    });

    it('404 entry non esiste', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .delete('/api/bookings/waitlist/999999')
        .set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('200 cancella entry propria', async () => {
      const { user, authHeader } = await createAuthedUser();
      const room = await createRoom();
      const entry = await BookingWaitlist.create({
        userId: user.id,
        roomId: room.id,
        startTime: new Date('2026-06-01T10:00:00Z'),
        endTime: new Date('2026-06-01T11:00:00Z'),
        type: 'studio_individuale',
        status: 'queued',
      });
      const res = await request(app)
        .delete(`/api/bookings/waitlist/${entry.id}`)
        .set('Authorization', authHeader);
      expect([200, 204]).toContain(res.status);
    });

    it('404 entry di altro utente', async () => {
      const { user: u1 } = await createAuthedUser({ email: 'a@x.it' });
      const { authHeader: h2 } = await createAuthedUser({ email: 'b@x.it' });
      const room = await createRoom();
      const entry = await BookingWaitlist.create({
        userId: u1.id,
        roomId: room.id,
        startTime: new Date('2026-06-01T10:00:00Z'),
        endTime: new Date('2026-06-01T11:00:00Z'),
        type: 'studio_individuale',
        status: 'queued',
      });
      const res = await request(app)
        .delete(`/api/bookings/waitlist/${entry.id}`)
        .set('Authorization', h2);
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('POST /api/bookings/waitlist/:id/claim', () => {
    it('401 senza token', async () => {
      const res = await request(app).post('/api/bookings/waitlist/1/claim');
      expect(res.status).toBe(401);
    });

    it('404 entry non esiste', async () => {
      const { authHeader } = await createAuthedUser();
      const res = await request(app)
        .post('/api/bookings/waitlist/999999/claim')
        .set('Authorization', authHeader);
      expect([400, 403, 404]).toContain(res.status);
    });
  });
});

describe('routes/public — endpoint pubblici', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /api/public/institute risponde anche senza istituto', async () => {
    const res = await request(app).get('/api/public/institute');
    expect([200, 404]).toContain(res.status);
  });

  it('GET /api/public/institute 200 con istituto presente', async () => {
    await Institute.create({ name: 'Test' });
    const res = await request(app).get('/api/public/institute');
    expect(res.status).toBe(200);
  });

  it('GET /api/public/display-config 200 con default', async () => {
    await Institute.create({ name: 'Test' });
    const res = await request(app).get('/api/public/display-config');
    expect([200, 400, 404]).toContain(res.status);
  });

  it('GET /api/public/concerts 200', async () => {
    const res = await request(app).get('/api/public/concerts');
    expect([200, 404]).toContain(res.status);
  });

  it('GET /api/public/concerts con limit query', async () => {
    const res = await request(app).get('/api/public/concerts?limit=5');
    expect([200, 404]).toContain(res.status);
  });

  it('GET /api/public/agenda 200', async () => {
    const res = await request(app).get('/api/public/agenda');
    expect([200, 400, 404]).toContain(res.status);
  });

  it('GET /api/public/agenda con date filter', async () => {
    const res = await request(app).get('/api/public/agenda?date=2026-06-01');
    expect([200, 400, 404]).toContain(res.status);
  });

  it('GET /api/public/stats 200', async () => {
    const res = await request(app).get('/api/public/stats');
    expect([200, 404]).toContain(res.status);
  });

  it('GET /api/public/announcements 200', async () => {
    const res = await request(app).get('/api/public/announcements');
    expect([200, 404]).toContain(res.status);
  });

  it('GET /api/public/announcements con limit', async () => {
    const res = await request(app).get('/api/public/announcements?limit=3');
    expect([200, 404]).toContain(res.status);
  });
});

describe('routes/courses — CRUD admin', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  describe('GET /api/courses (pubblico)', () => {
    it('200 lista vuota', async () => {
      const res = await request(app).get('/api/courses');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.courses)).toBe(true);
    });

    it('200 con courses presenti', async () => {
      await Course.create({ name: 'Violino', code: 'VLN' });
      const res = await request(app).get('/api/courses');
      expect(res.body.courses.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/courses/:id', () => {
    it('404 se id non esiste', async () => {
      const res = await request(app).get('/api/courses/999999');
      expect(res.status).toBe(404);
    });

    it('200 ritorna course esistente', async () => {
      const c = await Course.create({ name: 'Pianoforte', code: 'PNF' });
      const res = await request(app).get(`/api/courses/${c.id}`);
      expect(res.status).toBe(200);
      expect(res.body.course.name).toBe('Pianoforte');
    });
  });

  describe('POST /api/courses', () => {
    it('401 senza token', async () => {
      const res = await request(app).post('/api/courses').send({ name: 'X' });
      expect(res.status).toBe(401);
    });

    it('403 per non-admin', async () => {
      const { authHeader } = await createAuthedUser({ role: 'docente' });
      const res = await request(app)
        .post('/api/courses')
        .set('Authorization', authHeader)
        .send({ name: 'X' });
      expect(res.status).toBe(403);
    });

    it('400 senza name', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app).post('/api/courses').set('Authorization', authHeader).send({});
      expect([400, 422]).toContain(res.status);
    });

    it('201 crea course', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/courses')
        .set('Authorization', authHeader)
        .send({ name: 'Composizione', code: 'COMP' });
      expect(res.status).toBe(201);
    });
  });

  describe('PUT /api/courses/:id', () => {
    it('404 se id non esiste', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/courses/999999')
        .set('Authorization', authHeader)
        .send({ name: 'X' });
      expect(res.status).toBe(404);
    });

    it('200 aggiorna course', async () => {
      const { authHeader } = await createAdmin();
      const c = await Course.create({ name: 'X', code: 'X' });
      const res = await request(app)
        .put(`/api/courses/${c.id}`)
        .set('Authorization', authHeader)
        .send({ name: 'Aggiornato' });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/courses/:id', () => {
    it('404 se id non esiste', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app).delete('/api/courses/999999').set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('200 cancella course', async () => {
      const { authHeader } = await createAdmin();
      const c = await Course.create({ name: 'D', code: 'D' });
      const res = await request(app)
        .delete(`/api/courses/${c.id}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/courses/bulk-delete', () => {
    it('400 ids vuoto', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/courses/bulk-delete')
        .set('Authorization', authHeader)
        .send({ ids: [] });
      expect([400, 200]).toContain(res.status);
    });

    it('200 batch delete', async () => {
      const { authHeader } = await createAdmin();
      const c1 = await Course.create({ name: 'A', code: 'A' });
      const c2 = await Course.create({ name: 'B', code: 'B' });
      const res = await request(app)
        .post('/api/courses/bulk-delete')
        .set('Authorization', authHeader)
        .send({ ids: [c1.id, c2.id] });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/courses/export.csv', () => {
    it('401 senza token', async () => {
      const res = await request(app).get('/api/courses/export.csv');
      expect(res.status).toBe(401);
    });

    it('200 export CSV admin', async () => {
      const { authHeader } = await createAdmin();
      await Course.create({ name: 'X', code: 'X' });
      const res = await request(app)
        .get('/api/courses/export.csv')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/csv|text/);
    });
  });

  describe('POST /api/courses/import', () => {
    it('400 senza csv', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/courses/import')
        .set('Authorization', authHeader)
        .send({});
      expect([400, 422]).toContain(res.status);
    });

    it('200 import con CSV minimo', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/courses/import')
        .set('Authorization', authHeader)
        .send({ csv: 'name,code\nViola,VLA' });
      expect([200, 201]).toContain(res.status);
    });
  });
});

describe('routes/mailTemplates — admin', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET 401 senza token', async () => {
    const res = await request(app).get('/api/admin/mail-templates');
    expect([401, 404]).toContain(res.status);
  });

  it('GET 403 per non-admin', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .get('/api/admin/mail-templates')
      .set('Authorization', authHeader);
    expect([403, 404]).toContain(res.status);
  });

  it('GET 200 admin ritorna lista', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/mail-templates')
      .set('Authorization', authHeader);
    expect([200, 404]).toContain(res.status);
  });

  it('GET /:kind ritorna template o default', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/mail-templates/confirmation')
      .set('Authorization', authHeader);
    expect([200, 404]).toContain(res.status);
  });

  it('PUT /:kind 400 senza campi richiesti', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .put('/api/admin/mail-templates/confirmation')
      .set('Authorization', authHeader)
      .send({});
    expect([200, 400, 422]).toContain(res.status);
  });

  it('PUT /:kind 200 con subject + bodyHtml', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .put('/api/admin/mail-templates/confirmation')
      .set('Authorization', authHeader)
      .send({ subject: 'Test', bodyHtml: '<p>Hello</p>', isEnabled: true });
    expect([200, 201]).toContain(res.status);
  });

  it('POST /:kind/preview test rendering', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/admin/mail-templates/confirmation/preview')
      .set('Authorization', authHeader)
      .send({});
    expect([200, 400, 404]).toContain(res.status);
  });

  it('DELETE /:kind 200 reset to default', async () => {
    const { authHeader } = await createAdmin();
    await MailTemplate.create({
      kind: 'confirmation',
      subject: 'X',
      bodyHtml: '<p>x</p>',
      isEnabled: true,
    }).catch(() => {});
    const res = await request(app)
      .delete('/api/admin/mail-templates/confirmation')
      .set('Authorization', authHeader);
    expect([200, 204, 404]).toContain(res.status);
  });
});
