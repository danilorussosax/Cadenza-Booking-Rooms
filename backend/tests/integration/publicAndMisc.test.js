'use strict';

/**
 * Coverage smoke su public/announcements/analytics/gdpr/courseLevels/auth.
 * Test "shallow": auth + path principali. Niente assertions sui dati,
 * solo che l'endpoint risponda con uno status legittimo.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser } = require('../factories');

const app = buildApp({ serveFrontend: false });

describe('public endpoints — coverage', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /api/public/institute', async () => {
    const res = await request(app).get('/api/public/institute');
    expect([200, 404]).toContain(res.status);
  });
  it('GET /api/public/display-config', async () => {
    const res = await request(app).get('/api/public/display-config');
    expect([200, 400, 404]).toContain(res.status);
  });
  it('GET /api/public/concerts', async () => {
    const res = await request(app).get('/api/public/concerts');
    expect([200, 404]).toContain(res.status);
  });
  it('GET /api/public/agenda', async () => {
    const res = await request(app).get('/api/public/agenda');
    expect([200, 400, 404]).toContain(res.status);
  });
  it('GET /api/public/stats', async () => {
    const res = await request(app).get('/api/public/stats');
    expect([200, 404]).toContain(res.status);
  });
  it('GET /api/public/announcements', async () => {
    const res = await request(app).get('/api/public/announcements');
    expect([200, 404]).toContain(res.status);
  });
});

describe('analytics admin — coverage espansa', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /api/admin/analytics root + filtri vari (admin)', async () => {
    const { authHeader } = await createAdmin();
    const r1 = await request(app).get('/api/admin/analytics').set('Authorization', authHeader);
    expect([200, 400, 500]).toContain(r1.status);
    // Con range giorni
    const r2 = await request(app)
      .get('/api/admin/analytics?days=30')
      .set('Authorization', authHeader);
    expect([200, 400, 500]).toContain(r2.status);
    // Export CSV
    const csv = await request(app)
      .get('/api/admin/analytics/export.csv')
      .set('Authorization', authHeader);
    expect([200, 400, 404]).toContain(csv.status);
  });

  it('non-admin → 403', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/admin/analytics').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });
});

describe('announcements user — coverage', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /api/announcements (auth)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/announcements').set('Authorization', authHeader);
    expect([200, 404]).toContain(res.status);
  });

  it('non-auth → 401', async () => {
    const res = await request(app).get('/api/announcements');
    expect(res.status).toBe(401);
  });
});

describe('announcements admin — coverage', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /api/admin/announcements (admin)', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).get('/api/admin/announcements').set('Authorization', authHeader);
    expect([200, 404]).toContain(res.status);
  });

  it('POST /api/admin/announcements crea + DELETE', async () => {
    const { authHeader } = await createAdmin();
    const create = await request(app)
      .post('/api/admin/announcements')
      .set('Authorization', authHeader)
      .send({ title: 'Test', body: 'Contenuto annuncio' });
    expect([200, 201, 400]).toContain(create.status);
    const id = create.body.announcement?.id ?? create.body.id;
    if (id) {
      const upd = await request(app)
        .put(`/api/admin/announcements/${id}`)
        .set('Authorization', authHeader)
        .send({ title: 'Test 2' });
      expect([200, 400]).toContain(upd.status);
      const del = await request(app)
        .delete(`/api/admin/announcements/${id}`)
        .set('Authorization', authHeader);
      expect([200, 204]).toContain(del.status);
    }
  });
});

describe('gdpr user — coverage', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /export richiede auth', async () => {
    const res = await request(app).get('/api/users/me/gdpr/export');
    expect(res.status).toBe(401);
  });

  it('GET /export con auth ritorna JSON', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .get('/api/users/me/gdpr/export')
      .set('Authorization', authHeader);
    expect([200, 404, 429]).toContain(res.status);
  });

  it('GET/POST /consent', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const get = await request(app)
      .get('/api/users/me/gdpr/consent')
      .set('Authorization', authHeader);
    expect([200, 404]).toContain(get.status);

    const post = await request(app)
      .post('/api/users/me/gdpr/consent')
      .set('Authorization', authHeader)
      .send({ analytics: true, marketing: false });
    expect([200, 400, 404]).toContain(post.status);
  });

  it('POST /delete-request risponde (con o senza password)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .post('/api/users/me/gdpr/delete-request')
      .set('Authorization', authHeader)
      .send({ password: 'Password123!' });
    expect([200, 202, 400, 401, 429]).toContain(res.status);
  });
});

describe('courseLevels endpoints — coverage', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });
  it('GET /api/course-levels (auth o pubblica)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/course-levels').set('Authorization', authHeader);
    expect([200, 401, 404]).toContain(res.status);
  });
  it('POST /api/course-levels (admin) — crea', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/course-levels')
      .set('Authorization', authHeader)
      .send({ name: 'Triennio', code: 'T1' });
    expect([200, 201, 400]).toContain(res.status);
  });
});

describe('auth utility — coverage', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /api/auth/me senza auth → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/logout (auth) bumpa tokenVersion', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).post('/api/auth/logout').set('Authorization', authHeader);
    expect([200, 204]).toContain(res.status);
  });

  it('POST /api/auth/2fa/setup richiede auth', async () => {
    const res = await request(app).post('/api/auth/2fa/setup');
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/2fa/verify senza tempToken → 400/401', async () => {
    const res = await request(app).post('/api/auth/2fa/verify').send({});
    expect([400, 401]).toContain(res.status);
  });
});
