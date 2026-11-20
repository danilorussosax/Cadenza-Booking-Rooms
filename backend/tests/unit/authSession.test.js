'use strict';

/**
 * Unit: services/authSession — lockout, startSession, needsProfile, esito login.
 * Nessun HTTP: solo modulo + DB in-memory.
 */

const jwt = require('jsonwebtoken');
const { User } = require('../../models');
const { createUser, createCourse } = require('../factories');
const authSession = require('../../services/authSession');
const authSecurity = require('../../services/authSecurity');
const twoFa = require('../../services/twoFa');

const reload = (id) => User.findByPk(id);

describe('authSession — lockout', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('blocca alla soglia e checkLockout riporta i minuti residui', async () => {
    const u = await createUser({ passwordHash: 'x', failedLoginAttempts: 0 });
    for (let i = 1; i < authSession.LOCKOUT_MAX_FAILED; i++) {
      await authSession.recordFailedAttempt(u.email);
    }
    expect((await reload(u.id)).lockedUntil).toBeNull();
    expect(await authSession.checkLockout(u.email)).toBeNull();

    const last = await authSession.recordFailedAttempt(u.email);
    expect(last.attempts).toBe(authSession.LOCKOUT_MAX_FAILED);
    const locked = await authSession.checkLockout(u.email);
    expect(locked.outcome).toBe('locked');
    expect(locked.retryAfterMinutes).toBe(authSession.LOCKOUT_DURATION_MIN);
  });

  it('nessun incremento per email inesistente o senza password locale', async () => {
    const oauth = await createUser();
    await User.update({ passwordHash: null }, { where: { id: oauth.id } });
    expect((await authSession.recordFailedAttempt('nobody@test.invalid')).recorded).toBe(false);
    expect((await authSession.recordFailedAttempt(oauth.email)).recorded).toBe(false);
    expect((await authSession.recordFailedAttempt(null)).recorded).toBe(false);
    expect((await reload(oauth.id)).failedLoginAttempts).toBe(0);
    expect(await authSession.checkLockout('nobody@test.invalid')).toBeNull();
  });

  it('azzera contatori e lockedUntil al successo', async () => {
    const u = await createUser({
      passwordHash: 'x',
      failedLoginAttempts: 4,
      lockedUntil: new Date(Date.now() - 1000),
    });
    const res = await authSession.resolveLogin({ email: u.email, user: await reload(u.id) });
    expect(res.outcome).toBe('session');
    const after = await reload(u.id);
    expect(after.failedLoginAttempts).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });
});

describe('authSession — resolveLogin', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('invalid: codice generico, oppure PASSWORD_NOT_SET/OAUTH_ONLY propagati', async () => {
    expect(await authSession.resolveLogin({ email: 'a@test.invalid', user: false })).toEqual({
      outcome: 'invalid',
      code: 'INVALID_CREDENTIALS',
      message: 'Email o password non validi',
    });
    const r = await authSession.resolveLogin({
      email: null,
      user: false,
      info: { code: 'OAUTH_ONLY', message: 'Usa Google' },
    });
    expect(r).toEqual({ outcome: 'invalid', code: 'OAUTH_ONLY', message: 'Usa Google' });
    const r2 = await authSession.resolveLogin({
      email: null,
      user: false,
      info: { code: 'PASSWORD_NOT_SET' },
    });
    expect(r2.message).toBe('Email o password non validi');
  });

  it('needs2fa: non aggiorna lastLogin né emette token', async () => {
    const u = await createUser({ passwordHash: 'x', twoFaEnabled: true });
    const r = await authSession.resolveLogin({ email: u.email, user: u });
    expect(r.outcome).toBe('needs2fa');
    expect(r.token).toBeUndefined();
    expect((await reload(u.id)).lastLogin).toBeNull();
  });

  it('session: lastLogin aggiornato e token valido', async () => {
    const u = await createUser({ passwordHash: 'x' });
    const r = await authSession.resolveLogin({ email: u.email, user: u });
    expect(r.outcome).toBe('session');
    expect(jwt.decode(r.token).id).toBe(u.id);
    expect((await reload(u.id)).lastLogin).toBeInstanceOf(Date);
  });
});

describe('authSession — startSession / needsProfile', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('needsProfile per le combinazioni', async () => {
    const course = await createCourse();
    const ok = await createUser({ courseId: course.id, matricola: 'M1' });
    expect(authSession.needsProfile(ok)).toBe(false);
    expect(authSession.needsProfile({ ...ok.get(), status: 'pending' })).toBe(true);
    expect(authSession.needsProfile({ ...ok.get(), courseId: null })).toBe(true);
    expect(authSession.needsProfile({ ...ok.get(), role: 'studente', matricola: null })).toBe(true);
    // un docente senza matricola ma con corso e approvato non richiede profilo
    expect(authSession.needsProfile({ ...ok.get(), role: 'docente', matricola: null })).toBe(false);
  });

  it.each(['password', 'google', 'microsoft'])('aggiorna lastLogin via %s', async (via) => {
    const u = await createUser({ status: 'pending', courseId: null });
    const { token, needsProfile } = await authSession.startSession(u, { via });
    expect(needsProfile).toBe(true);
    expect(jwt.decode(token).email).toBe(u.email);
    expect((await reload(u.id)).lastLogin).toBeInstanceOf(Date);
  });

  it('aggiorna lastLogin nel percorso verifica 2FA (transazione)', async () => {
    const u = await createUser({ passwordHash: 'x' });
    const { code, record } = await twoFa.createChallenge('login');
    u.twoFaEnabled = true;
    u.twoFaChallenge = record;
    await u.save();
    const payload = { id: u.id, tokenVersion: u.tokenVersion };
    const res = await authSecurity.verifyLogin(payload, { code });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect((await reload(u.id)).lastLogin).toBeInstanceOf(Date);
  });
});
