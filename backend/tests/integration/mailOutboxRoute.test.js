'use strict';

/**
 * Integrazione: route admin /api/admin/mail-outbox.
 *
 * Coperture:
 *   - 401 senza auth, 403 se non admin
 *   - GET / list paginata + filtri (status, kind, to, q)
 *   - GET /counts
 *   - GET /health (smtp configured + verify + dead count)
 *   - POST /:id/retry: dead → pending; non-dead → 400; not found → 404
 *   - DELETE /:id: rimozione idempotente
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { MailOutbox } = require('../../models');
const emailService = require('../../services/emailService');
const { createAuthedUser, createAdmin } = require('../factories');

async function seedRow(overrides = {}) {
  return MailOutbox.create({
    kind: 'confirmation',
    to: 'a@example.com',
    subject: 'Test',
    bodyHtml: '<p>x</p>',
    status: 'pending',
    ...overrides,
  });
}

describe('/api/admin/mail-outbox auth', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza auth su GET /', async () => {
    const res = await request(app).get('/api/admin/mail-outbox');
    expect(res.status).toBe(401);
  });

  it('403 se non admin', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/admin/mail-outbox').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/mail-outbox (list)', () => {
  let app;
  let authHeader;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
    ({ authHeader } = await createAdmin());
  });

  it('lista paginata con campi safe (no bodyHtml)', async () => {
    await seedRow({ to: 'r1@example.com' });
    await seedRow({ to: 'r2@example.com' });
    const res = await request(app).get('/api/admin/mail-outbox').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].bodyHtml).toBeUndefined();
    expect(res.body.items[0].id).toBeDefined();
    expect(res.body.items[0].to).toMatch(/r[12]@example\.com/);
  });

  it('filtra per status', async () => {
    await seedRow({ status: 'pending', to: 'p@example.com' });
    await seedRow({ status: 'dead', to: 'd@example.com', attempts: 5 });
    const res = await request(app)
      .get('/api/admin/mail-outbox?status=dead')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].to).toBe('d@example.com');
  });

  it('filtra per substring q (su to/subject)', async () => {
    await seedRow({ to: 'alice@example.com', subject: 'Booking #1' });
    await seedRow({ to: 'bob@example.com', subject: 'Reminder' });
    const res = await request(app)
      .get('/api/admin/mail-outbox?q=alice')
      .set('Authorization', authHeader);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].to).toBe('alice@example.com');
  });
});

describe('GET /api/admin/mail-outbox/counts', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('ritorna i counts per status', async () => {
    await seedRow({ status: 'pending' });
    await seedRow({ status: 'pending' });
    await seedRow({ status: 'sent', sentAt: new Date() });
    await seedRow({ status: 'dead', attempts: 5 });
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/mail-outbox/counts')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: 2, sent: 1, dead: 1, total: 4 });
  });
});

describe('GET /api/admin/mail-outbox/health', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('SMTP configurato + verify ok + dead=0 → healthy=true', async () => {
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue({
      transporter: { verify: vi.fn().mockResolvedValue(true) },
      from: 'x',
      replyTo: null,
    });
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/mail-outbox/health')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.smtpConfigured).toBe(true);
    expect(res.body.verifyOk).toBe(true);
    expect(res.body.dead).toBe(0);
    expect(res.body.healthy).toBe(true);
  });

  it('SMTP non configurato → healthy=false', async () => {
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue({
      transporter: null,
      from: null,
    });
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/mail-outbox/health')
      .set('Authorization', authHeader);
    expect(res.body.smtpConfigured).toBe(false);
    expect(res.body.healthy).toBe(false);
  });
});

describe('POST /api/admin/mail-outbox/:id/retry', () => {
  let app;
  let authHeader;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
    ({ authHeader } = await createAdmin());
  });

  it('dead → pending, attempts=0, lastError=null', async () => {
    const row = await seedRow({
      status: 'dead',
      attempts: 5,
      lastError: 'forever down',
      nextAttemptAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const res = await request(app)
      .post(`/api/admin/mail-outbox/${row.id}/retry`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('pending');
    expect(res.body.item.attempts).toBe(0);
    expect(res.body.item.lastError).toBeNull();
  });

  it('su pending → 400', async () => {
    const row = await seedRow({ status: 'pending' });
    const res = await request(app)
      .post(`/api/admin/mail-outbox/${row.id}/retry`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dead/i);
  });

  it('id inesistente → 404', async () => {
    const res = await request(app)
      .post('/api/admin/mail-outbox/00000000-0000-4000-8000-000000000000/retry')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });

  it('id non valido (non UUID) → 400', async () => {
    const res = await request(app)
      .post('/api/admin/mail-outbox/not-a-uuid/retry')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/admin/mail-outbox/:id', () => {
  let app;
  let authHeader;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
    ({ authHeader } = await createAdmin());
  });

  it('rimuove la riga', async () => {
    const row = await seedRow({ status: 'dead', attempts: 5 });
    const res = await request(app)
      .delete(`/api/admin/mail-outbox/${row.id}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(await MailOutbox.count()).toBe(0);
  });

  it('id inesistente → 404', async () => {
    const res = await request(app)
      .delete('/api/admin/mail-outbox/00000000-0000-4000-8000-000000000000')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});
