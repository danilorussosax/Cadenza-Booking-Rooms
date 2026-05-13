'use strict';

/**
 * Test integration per il flusso password reset self-service.
 *
 * Copertura:
 *   - POST /auth/forgot-password: anti-enumeration, rate-limit per-user,
 *     creazione token in DB, idempotenza su email malformata
 *   - GET /auth/reset-password/:token/validate
 *   - POST /auth/reset-password: token valido, scaduto, già usato, non
 *     trovato, password debole. Verifica side-effects: hash cambiato,
 *     tokenVersion incrementato, lockout sbloccato, token segnato usedAt
 */

const request = require('supertest');
const crypto = require('crypto');
const dayjs = require('dayjs');

const { buildApp } = require('../../app');
const { createUser } = require('../factories');
const { PasswordResetToken, User } = require('../../models');

const app = buildApp({ serveFrontend: false });

function hashToken(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

async function requestForgot(email) {
  return request(app).post('/api/auth/forgot-password').send({ email });
}

async function getLatestTokenForUser(userId) {
  return PasswordResetToken.findOne({
    where: { userId },
    order: [['createdAt', 'DESC']],
  });
}

beforeEach(async () => {
  await resetDatabase();
});

// =====================================================
// POST /forgot-password
// =====================================================
describe('POST /auth/forgot-password', () => {
  it('ritorna 200 generico anche se email non esiste (anti-enumeration)', async () => {
    const res = await requestForgot('inesistente@test.invalid');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Nessun token creato per nessun utente
    const count = await PasswordResetToken.count();
    expect(count).toBe(0);
  });

  it('ritorna 200 generico se email è malformata', async () => {
    const res = await requestForgot('not-an-email');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('crea token in DB per utente esistente + risposta 200', async () => {
    const user = await createUser({ email: 'reset@test.invalid' });
    const res = await requestForgot('reset@test.invalid');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const tok = await getLatestTokenForUser(user.id);
    expect(tok).not.toBeNull();
    expect(tok.tokenHash).toHaveLength(64); // SHA-256 hex
    expect(tok.usedAt).toBeNull();
    // Scadenza: ~1h da ora (margine ±10 min)
    const minutes = dayjs(tok.expiresAt).diff(dayjs(), 'minute');
    expect(minutes).toBeGreaterThanOrEqual(50);
    expect(minutes).toBeLessThanOrEqual(70);
  });

  it("NON crea altri token oltre il 3° nell'ultima ora (per-user gate)", async () => {
    const user = await createUser({ email: 'limit@test.invalid' });
    // Crea già 3 token "recenti" a mano
    for (let i = 0; i < 3; i++) {
      await PasswordResetToken.create({
        userId: user.id,
        tokenHash: hashToken(`fake-${i}-${Date.now()}`),
        expiresAt: dayjs().add(1, 'hour').toDate(),
      });
    }
    // 4° richiesta deve essere droppata silenziosamente
    const res = await requestForgot('limit@test.invalid');
    expect(res.status).toBe(200);
    const total = await PasswordResetToken.count({ where: { userId: user.id } });
    expect(total).toBe(3); // nessun nuovo token aggiunto
  });

  it('salva IP e user agent per audit trail', async () => {
    const user = await createUser({ email: 'audit@test.invalid' });
    await request(app)
      .post('/api/auth/forgot-password')
      .set('User-Agent', 'TestUA/1.0')
      .send({ email: 'audit@test.invalid' });
    const tok = await getLatestTokenForUser(user.id);
    expect(tok.requestIp).toBeTruthy();
    expect(tok.requestUserAgent).toBe('TestUA/1.0');
  });
});

// =====================================================
// GET /reset-password/:token/validate
// =====================================================
describe('GET /auth/reset-password/:token/validate', () => {
  it('valid:true per token attivo non scaduto', async () => {
    const user = await createUser({ email: 'v@test.invalid' });
    const tokenPlain = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({
      userId: user.id,
      tokenHash: hashToken(tokenPlain),
      expiresAt: dayjs().add(1, 'hour').toDate(),
    });
    const res = await request(app).get(`/api/auth/reset-password/${tokenPlain}/validate`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.expiresAt).toBeTruthy();
  });

  it('valid:false + 404 per token inesistente', async () => {
    const bogus = 'a'.repeat(64);
    const res = await request(app).get(`/api/auth/reset-password/${bogus}/validate`);
    expect(res.status).toBe(404);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe('not_found');
  });

  it('valid:false + 400 per token in formato errato', async () => {
    const res = await request(app).get('/api/auth/reset-password/abc/validate');
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('format');
  });

  it('valid:false + 400 per token scaduto', async () => {
    const user = await createUser({ email: 'exp@test.invalid' });
    const tokenPlain = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({
      userId: user.id,
      tokenHash: hashToken(tokenPlain),
      expiresAt: dayjs().subtract(1, 'minute').toDate(),
    });
    const res = await request(app).get(`/api/auth/reset-password/${tokenPlain}/validate`);
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('expired');
  });

  it('valid:false + 400 per token già usato', async () => {
    const user = await createUser({ email: 'used@test.invalid' });
    const tokenPlain = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({
      userId: user.id,
      tokenHash: hashToken(tokenPlain),
      expiresAt: dayjs().add(1, 'hour').toDate(),
      usedAt: new Date(),
    });
    const res = await request(app).get(`/api/auth/reset-password/${tokenPlain}/validate`);
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('used');
  });
});

// =====================================================
// POST /reset-password
// =====================================================
describe('POST /auth/reset-password', () => {
  it('cambia password + marca usedAt + invalida sessioni (tokenVersion++)', async () => {
    const user = await createUser({ email: 'change@test.invalid', password: 'OldPassword123!' });
    const initialTV = user.tokenVersion || 0;
    const tokenPlain = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({
      userId: user.id,
      tokenHash: hashToken(tokenPlain),
      expiresAt: dayjs().add(1, 'hour').toDate(),
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: tokenPlain, newPassword: 'NuovaPwd99!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verifica side-effects
    const refreshed = await User.findByPk(user.id);
    expect(await refreshed.verifyPassword('NuovaPwd99!')).toBe(true);
    expect(await refreshed.verifyPassword('OldPassword123!')).toBe(false);
    expect(refreshed.tokenVersion).toBe(initialTV + 1);

    const tok = await getLatestTokenForUser(user.id);
    expect(tok.usedAt).not.toBeNull();
  });

  it('rifiuta token in formato errato (400)', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'abc', newPassword: 'NuovaPwd99!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it('rifiuta token inesistente (400)', async () => {
    const bogus = 'b'.repeat(64);
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: bogus, newPassword: 'NuovaPwd99!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non valido|scaduto/i);
  });

  it('rifiuta token già usato (400)', async () => {
    const user = await createUser({ email: 'used2@test.invalid' });
    const tokenPlain = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({
      userId: user.id,
      tokenHash: hashToken(tokenPlain),
      expiresAt: dayjs().add(1, 'hour').toDate(),
      usedAt: new Date(),
    });
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: tokenPlain, newPassword: 'NuovaPwd99!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/già utilizzato/i);
  });

  it('rifiuta token scaduto (400)', async () => {
    const user = await createUser({ email: 'exp2@test.invalid' });
    const tokenPlain = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({
      userId: user.id,
      tokenHash: hashToken(tokenPlain),
      expiresAt: dayjs().subtract(1, 'minute').toDate(),
    });
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: tokenPlain, newPassword: 'NuovaPwd99!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scaduto/i);
  });

  it('rifiuta password debole (no maiuscola)', async () => {
    const user = await createUser({ email: 'weak@test.invalid' });
    const tokenPlain = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({
      userId: user.id,
      tokenHash: hashToken(tokenPlain),
      expiresAt: dayjs().add(1, 'hour').toDate(),
    });
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: tokenPlain, newPassword: 'tuttominuscolo99' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maiuscola/i);
  });

  it('sblocca account in lockout dopo reset riuscito', async () => {
    const user = await createUser({
      email: 'locked@test.invalid',
      failedLoginAttempts: 10,
      lockedUntil: dayjs().add(30, 'minute').toDate(),
    });
    const tokenPlain = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({
      userId: user.id,
      tokenHash: hashToken(tokenPlain),
      expiresAt: dayjs().add(1, 'hour').toDate(),
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: tokenPlain, newPassword: 'NuovaPwd99!' });
    expect(res.status).toBe(200);

    const refreshed = await User.findByPk(user.id);
    expect(refreshed.failedLoginAttempts).toBe(0);
    expect(refreshed.lockedUntil).toBeNull();
  });
});
