'use strict';

/**
 * Integration: account lockout dopo N login falliti su /api/auth/login.
 *
 * Difesa contro brute force distribuito: il rate-limit per IP (loginLimiter)
 * ferma il singolo IP, ma una botnet può distribuire i tentativi su molti
 * IP contro lo stesso account. Questo test verifica la contromisura.
 *
 * Configurazione test: LOCKOUT_MAX_FAILED=3, LOCKOUT_DURATION_MIN=1 (env).
 */

const request = require('supertest');
const { User } = require('../../models');

let app;
let originalMax, originalDur;

// Soglia bassa nei test per evitare di iterare 10 volte.
beforeAll(() => {
  originalMax = process.env.LOCKOUT_MAX_FAILED;
  originalDur = process.env.LOCKOUT_DURATION_MIN;
  process.env.LOCKOUT_MAX_FAILED = '3';
  process.env.LOCKOUT_DURATION_MIN = '1';
  // Re-require app dopo aver settato l'env (le costanti sono lette al import)
  delete require.cache[require.resolve('../../routes/auth')];
  delete require.cache[require.resolve('../../app')];
  const { buildApp } = require('../../app');
  app = buildApp({ serveFrontend: false });
});

afterAll(() => {
  if (originalMax === undefined) delete process.env.LOCKOUT_MAX_FAILED;
  else process.env.LOCKOUT_MAX_FAILED = originalMax;
  if (originalDur === undefined) delete process.env.LOCKOUT_DURATION_MIN;
  else process.env.LOCKOUT_DURATION_MIN = originalDur;
});

async function createUserWithPassword(email, password) {
  return User.create({
    email,
    firstName: 'Test',
    lastName: 'User',
    role: 'studente',
    status: 'approved',
    passwordHash: password, // hook beforeCreate fa bcrypt
    matricola: `M-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  });
}

describe('Account lockout — flow base', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('login OK con password corretta non incrementa il contatore', async () => {
    const user = await createUserWithPassword('ok@test.it', 'Password123!');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ok@test.it', password: 'Password123!' });
    expect(res.status).toBe(200);
    const fresh = await User.findByPk(user.id);
    expect(fresh.failedLoginAttempts).toBe(0);
    expect(fresh.lockedUntil).toBeNull();
  });

  it('login KO incrementa failedLoginAttempts', async () => {
    const user = await createUserWithPassword('ko@test.it', 'Password123!');
    await request(app).post('/api/auth/login').send({ email: 'ko@test.it', password: 'sbagliata' });
    const fresh = await User.findByPk(user.id);
    expect(fresh.failedLoginAttempts).toBe(1);
    expect(fresh.lockedUntil).toBeNull();
  });

  it('dopo N tentativi falliti consecutivi → ACCOUNT_LOCKED', async () => {
    const user = await createUserWithPassword('lock@test.it', 'Password123!');
    // 3 tentativi sbagliati (soglia = 3 nel test)
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/auth/login').send({ email: 'lock@test.it', password: 'wrong' });
    }
    const fresh = await User.findByPk(user.id);
    expect(fresh.failedLoginAttempts).toBe(3);
    expect(fresh.lockedUntil).not.toBeNull();
    expect(fresh.lockedUntil.getTime()).toBeGreaterThan(Date.now());

    // Anche con la password corretta, l'account è bloccato
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'lock@test.it', password: 'Password123!' });
    expect(res.status).toBe(423);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
    expect(res.body.retryAfterMinutes).toBeGreaterThan(0);
  });

  it('login OK dopo lockout scaduto → reset contatori', async () => {
    const user = await createUserWithPassword('expire@test.it', 'Password123!');
    // Simula lockout scaduto: settando lockedUntil nel passato
    await User.update(
      {
        failedLoginAttempts: 3,
        lockedUntil: new Date(Date.now() - 60_000),
      },
      { where: { id: user.id } },
    );
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'expire@test.it', password: 'Password123!' });
    expect(res.status).toBe(200);
    const fresh = await User.findByPk(user.id);
    expect(fresh.failedLoginAttempts).toBe(0);
    expect(fresh.lockedUntil).toBeNull();
  });

  it('email non registrata: NON crea contatori (no spam DB)', async () => {
    const before = await User.count();
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@test.it', password: 'whatever' });
    const after = await User.count();
    expect(after).toBe(before);
  });

  it('email registrata SENZA passwordHash (OAuth-only) non viene mai lockata', async () => {
    const oauthUser = await User.create({
      email: 'oauth-only@test.it',
      firstName: 'O',
      lastName: 'A',
      role: 'studente',
      status: 'approved',
      // niente passwordHash → account OAuth-only
    });
    // Tentativo di login con password qualsiasi: deve rimanere INVALID_CREDENTIALS
    // ma NON deve incrementare failedLoginAttempts (lockare account OAuth è inutile)
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'oauth-only@test.it', password: 'qualsiasi' });
    }
    const fresh = await User.findByPk(oauthUser.id);
    expect(fresh.failedLoginAttempts).toBe(0);
    expect(fresh.lockedUntil).toBeNull();
  });

  it('case-insensitive su email (lookup normalizzato)', async () => {
    const user = await createUserWithPassword('caps@test.it', 'Password123!');
    await request(app).post('/api/auth/login').send({ email: 'CAPS@TEST.IT', password: 'wrong' });
    const fresh = await User.findByPk(user.id);
    expect(fresh.failedLoginAttempts).toBe(1);
  });

  it('login con email mancante non causa errori', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('contatore aumenta progressivamente fino al lockout', async () => {
    const user = await createUserWithPassword('progressive@test.it', 'Password123!');
    for (let i = 1; i <= 3; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'progressive@test.it', password: 'wrong' });
      const fresh = await User.findByPk(user.id);
      expect(fresh.failedLoginAttempts).toBe(i);
      if (i < 3) {
        expect(fresh.lockedUntil).toBeNull();
      } else {
        expect(fresh.lockedUntil).not.toBeNull();
      }
    }
  });
});
