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

  it('401 per utente disabilitato (codice generico anti-enumeration)', async () => {
    await createUser({
      email: 'disabled@test.invalid',
      password: 'Password123!',
      isActive: false,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'disabled@test.invalid', password: 'Password123!' });

    expect(res.status).toBe(401);
    // Anti user-enumeration: stesso code di password sbagliata o email
    // sconosciuta. Un attaccante non può distinguere account esistenti.
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('login: stesso code per email inesistente vs password errata (anti-enumeration)', async () => {
    await createUser({ email: 'real@test.invalid', password: 'Password123!' });
    const r1 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'real@test.invalid', password: 'Wrong!' });
    const r2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.invalid', password: 'Wrong!' });
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r1.body.code).toBe(r2.body.code);
    expect(r1.body.error).toBe(r2.body.error);
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

describe('iCal token: hash at rest', () => {
  const crypto = require('crypto');
  const { User } = require('../../models');
  const { createAuthedUser } = require('../factories');

  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /ical-token genera plain + hash; lookup avviene per hash', async () => {
    const { authHeader, user } = await createAuthedUser({ role: 'docente' });
    const r1 = await request(app).get('/api/auth/ical-token').set('Authorization', authHeader);
    expect(r1.status).toBe(200);
    const plain = r1.body.token;
    expect(typeof plain).toBe('string');
    expect(plain.length).toBeGreaterThanOrEqual(32);

    // DB: l'hash deve combaciare con sha256(plain), il plain è ancora salvato.
    const reloaded = await User.findByPk(user.id);
    const expectedHash = crypto.createHash('sha256').update(plain).digest('hex');
    expect(reloaded.icalTokenHash).toBe(expectedHash);
    expect(reloaded.icalToken).toBe(plain);

    // Endpoint /api/bookings/ical accetta il token (lookup via hash).
    const ok = await request(app).get(`/api/bookings/ical?token=${plain}`);
    expect(ok.status).toBe(200);

    // Token random invalido → 401
    const bad = await request(app).get(`/api/bookings/ical?token=${'a'.repeat(64)}`);
    expect(bad.status).toBe(401);
  });

  it('POST /ical-token rigenera token (vecchio non più valido)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const r1 = await request(app).get('/api/auth/ical-token').set('Authorization', authHeader);
    const oldToken = r1.body.token;

    const r2 = await request(app).post('/api/auth/ical-token').set('Authorization', authHeader);
    const newToken = r2.body.token;
    expect(newToken).not.toBe(oldToken);

    const oldRes = await request(app).get(`/api/bookings/ical?token=${oldToken}`);
    expect(oldRes.status).toBe(401);
    const newRes = await request(app).get(`/api/bookings/ical?token=${newToken}`);
    expect(newRes.status).toBe(200);
  });
});
