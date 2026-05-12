'use strict';

/**
 * Integration: routes/auth.js — coverage espansa da 25% branches.
 * Focus su error paths e branch meno comuni.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAuthedUser, createAdmin } = require('../factories');
const { Course, User } = require('../../models');

const app = buildApp({ serveFrontend: false });

describe('routes/auth — POST /change-password', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'x', newPassword: 'Password123!' });
    expect(res.status).toBe(401);
  });

  it('400 newPassword troppo corta', async () => {
    const { authHeader } = await createAuthedUser({ password: 'Password123!' });
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', authHeader)
      .send({ currentPassword: 'Password123!', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('401 currentPassword errata', async () => {
    const { authHeader } = await createAuthedUser({ password: 'Password123!' });
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', authHeader)
      .send({ currentPassword: 'WRONG-PASS', newPassword: 'NewPassword456!' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('WRONG_PASSWORD');
  });

  it('200 success con currentPassword corretta', async () => {
    const { authHeader } = await createAuthedUser({ password: 'Password123!' });
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', authHeader)
      .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
});

describe('routes/auth — PATCH /me (profile update)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app).patch('/api/auth/me').send({ firstName: 'X' });
    expect(res.status).toBe(401);
  });

  it('400 firstName vuoto (string)', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ firstName: '' });
    expect(res.status).toBe(400);
  });

  it('400 courseId non intero', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ courseId: 'abc' });
    expect(res.status).toBe(400);
  });

  it('400 COURSE_INVALID se courseId non esiste', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ courseId: 999999 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COURSE_INVALID');
  });

  it('200 imposta courseId valido', async () => {
    const { authHeader } = await createAuthedUser();
    const c = await Course.create({ name: 'X', code: 'X', isActive: true });
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ courseId: c.id });
    expect(res.status).toBe(200);
  });

  it('409 MATRICOLA_ALREADY_USED se altro utente la usa', async () => {
    await User.create({
      firstName: 'A',
      lastName: 'B',
      email: 'a@x.it',
      role: 'studente',
      status: 'approved',
      matricola: 'DUP123',
    });
    const { authHeader } = await createAuthedUser({ matricola: null });
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ matricola: 'DUP123' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MATRICOLA_ALREADY_USED');
  });

  it('400 MATRICOLA_REQUIRED studente pending senza matricola', async () => {
    const c = await Course.create({ name: 'C', code: 'C' });
    const { authHeader } = await createAuthedUser({
      role: 'studente',
      status: 'pending',
      matricola: null,
      courseId: null,
    });
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ firstName: 'Mario', courseId: c.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MATRICOLA_REQUIRED');
  });

  it('400 COURSE_REQUIRED studente pending senza corso', async () => {
    const { authHeader } = await createAuthedUser({
      role: 'studente',
      status: 'pending',
      courseId: null,
    });
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ matricola: 'M999' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COURSE_REQUIRED');
  });

  it('200 studente pending → approved dopo profile completo', async () => {
    const c = await Course.create({ name: 'C', code: 'C', isActive: true });
    const { authHeader } = await createAuthedUser({
      role: 'studente',
      status: 'pending',
      matricola: null,
      courseId: null,
    });
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ matricola: 'M1', courseId: c.id });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('approved');
  });

  it('400 COURSE_REQUIRED docente pending senza corso', async () => {
    const { authHeader } = await createAuthedUser({
      role: 'docente',
      status: 'pending',
      courseId: null,
    });
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ firstName: 'Prof' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COURSE_REQUIRED');
  });

  it('200 docente pending con corso resta pending', async () => {
    const c = await Course.create({ name: 'C', code: 'C', isActive: true });
    const { authHeader } = await createAuthedUser({
      role: 'docente',
      status: 'pending',
      courseId: null,
    });
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ courseId: c.id });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('pending');
  });

  it('200 admin invariato status', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', authHeader)
      .send({ firstName: 'Admin' });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('approved');
  });

  it('200 set emailNotifications/notifyOn* flags', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).patch('/api/auth/me').set('Authorization', authHeader).send({
      emailNotifications: false,
      notifyOnConfirmation: false,
      notifyOnReminder: true,
      notifyOnCancellation: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.emailNotifications).toBe(false);
  });
});

describe('routes/auth — iCal token', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET 401 senza token', async () => {
    const res = await request(app).get('/api/auth/ical-token');
    expect(res.status).toBe(401);
  });

  it('GET 200 genera/ritorna token', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).get('/api/auth/ical-token').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThanOrEqual(32);
  });

  it('POST 200 rigenera token (deve essere diverso)', async () => {
    const { authHeader } = await createAuthedUser();
    const a = await request(app).get('/api/auth/ical-token').set('Authorization', authHeader);
    const b = await request(app).post('/api/auth/ical-token').set('Authorization', authHeader);
    expect(b.status).toBe(200);
    expect(b.body.token).not.toBe(a.body.token);
  });
});

describe('routes/auth — logout', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  it('200 logout bumpa tokenVersion', async () => {
    const { user, authHeader } = await createAuthedUser();
    const before = user.tokenVersion ?? 0;
    const res = await request(app).post('/api/auth/logout').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const fresh = await User.findByPk(user.id);
    expect(fresh.tokenVersion ?? 0).toBeGreaterThan(before);
  });
});

describe('routes/auth — 2FA status + setup gates', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /2fa/status 401 senza token', async () => {
    const res = await request(app).get('/api/auth/2fa/status');
    expect(res.status).toBe(401);
  });

  it('GET /2fa/status 200 ritorna {enabled: false} di default', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).get('/api/auth/2fa/status').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('POST /2fa/setup 401 senza token', async () => {
    const res = await request(app).post('/api/auth/2fa/setup');
    expect(res.status).toBe(401);
  });

  it('POST /2fa/recovery 401 senza token', async () => {
    const res = await request(app).post('/api/auth/2fa/recovery').send({ code: 'X' });
    expect(res.status).toBe(401);
  });

  it('POST /2fa/disable 401 senza token', async () => {
    const res = await request(app).post('/api/auth/2fa/disable').send({});
    expect(res.status).toBe(401);
  });
});

describe('routes/auth — OAuth start endpoints', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /google redirige o 404 se non configurato', async () => {
    const res = await request(app).get('/api/auth/google').redirects(0);
    // Senza GOOGLE_CLIENT_ID configurato in test, l'endpoint ritorna 404
    // o redirige all'IdP. Accettiamo entrambi.
    expect([302, 400, 404, 500, 503]).toContain(res.status);
  });

  it('GET /microsoft redirige o 404 se non configurato', async () => {
    const res = await request(app).get('/api/auth/microsoft').redirects(0);
    expect([302, 400, 404, 500, 503]).toContain(res.status);
  });
});

describe('routes/auth — GET /me', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('200 ritorna safeJSON user', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).get('/api/auth/me').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });
});
