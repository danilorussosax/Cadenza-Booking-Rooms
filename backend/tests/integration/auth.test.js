'use strict';

/**
 * Integrazione: /api/auth/register, /api/auth/login, /api/auth/change-password.
 *
 * Cosa NON copriamo qui:
 *   - OAuth (Google/Microsoft) — richiederebbe mock dei provider remoti.
 *   - Reset password via email — l'app non espone /forgot-password con
 *     token: il "reset" passa da change-password (utente autenticato).
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createUser, createCourse } = require('../factories');

const app = buildApp({ serveFrontend: false });

describe('POST /api/auth/register', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('crea un nuovo utente e ritorna token + profilo', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'mario.rossi@test.invalid',
      password: 'Password123!',
      firstName: 'Mario',
      lastName: 'Rossi',
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('mario.rossi@test.invalid');
    // passwordHash non deve mai uscire al client
    expect(res.body.user.passwordHash).toBeUndefined();
    // Studente senza matricola+corso → status='pending'
    expect(res.body.user.status).toBe('pending');
  });

  it('approva subito uno studente con matricola e corso validi', async () => {
    const course = await createCourse();
    const res = await request(app).post('/api/auth/register').send({
      email: 'studente@test.invalid',
      password: 'Password123!',
      firstName: 'Stud',
      lastName: 'Ente',
      matricola: 'STU001',
      courseId: course.id,
      role: 'studente',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.status).toBe('approved');
    expect(res.body.user.matricola).toBe('STU001');
  });

  it('400 se la password è troppo corta', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'short@test.invalid',
      password: 'short',
      firstName: 'A',
      lastName: 'B',
    });
    expect(res.status).toBe(400);
  });

  it("409 se l'email è già registrata", async () => {
    await createUser({ email: 'dup@test.invalid' });
    const res = await request(app).post('/api/auth/register').send({
      email: 'dup@test.invalid',
      password: 'Password123!',
      firstName: 'A',
      lastName: 'B',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('login con credenziali corrette ritorna JWT', async () => {
    await createUser({ email: 'login@test.invalid', password: 'Password123!' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@test.invalid', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(res.body.user.email).toBe('login@test.invalid');
  });

  it('401 con password sbagliata', async () => {
    await createUser({ email: 'wrong@test.invalid', password: 'Password123!' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrong@test.invalid', password: 'NotThePassword!' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('401 per utente disabilitato', async () => {
    await createUser({
      email: 'disabled@test.invalid',
      password: 'Password123!',
      isActive: false,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'disabled@test.invalid', password: 'Password123!' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('rate limiting su register', () => {
  // Il registerLimiter è 3 tentativi / 30 min / IP (vedi rateLimit.js).
  // Nei test è disabilitato di default — riattiviamolo solo qui.
  beforeAll(() => {
    process.env.DISABLE_RATE_LIMIT = 'false';
  });
  afterAll(() => {
    process.env.DISABLE_RATE_LIMIT = 'true';
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('blocca con 429 dopo i tentativi consentiti', async () => {
    const send = (n) =>
      request(app)
        .post('/api/auth/register')
        .send({
          email: `rl${n}@test.invalid`,
          password: 'Password123!',
          firstName: 'R',
          lastName: 'L',
        });

    // I primi tre devono passare (anche con stato 201 o 400 va bene per il
    // limiter: il punto è che NON sia 429).
    const r1 = await send(1);
    const r2 = await send(2);
    const r3 = await send(3);
    expect([201, 400, 409]).toContain(r1.status);
    expect([201, 400, 409]).toContain(r2.status);
    expect([201, 400, 409]).toContain(r3.status);

    const blocked = await send(4);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('POST /api/auth/change-password', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('cambia la password con quella corrente corretta', async () => {
    const user = await createUser({
      email: 'cp@test.invalid',
      password: 'OldPassword1!',
    });
    // Login per ottenere il token (il signToken delle factories è un
    // shortcut; qui passiamo dal vero login per coerenza con la flow utente).
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'OldPassword1!' });
    const token = login.body.token;

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'OldPassword1!', newPassword: 'NewPassword1!' });
    expect(res.status).toBe(200);

    // Verifica che la nuova password funzioni
    const after = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'NewPassword1!' });
    expect(after.status).toBe(200);
  });

  it('401 se la password attuale è errata', async () => {
    const user = await createUser({
      email: 'cpw@test.invalid',
      password: 'OldPassword1!',
    });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'OldPassword1!' });
    const token = login.body.token;

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongCurrent!', newPassword: 'NewPassword1!' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('WRONG_PASSWORD');
  });
});
