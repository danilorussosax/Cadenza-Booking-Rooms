'use strict';

/**
 * Integrazione: magic-link "imposta password" per primo accesso.
 *
 * Verifica:
 *   - POST /users/:id/send-setup-link → 200 + token creato con purpose='initial_setup'
 *   - su utente già con passwordHash → 400 USER_HAS_PASSWORD
 *   - re-invio invalida i token precedenti (usedAt valorizzato)
 *   - bulk endpoint somma sent/skipped correttamente
 *   - bulk skippa gli utenti con password
 *   - rate-limit guard: userIds > 1000 → 400 TOO_MANY
 *   - rifiuto utenti non admin (auth guard)
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAuthedUser, createAdmin } = require('../factories');
const { PasswordResetToken, User } = require('../../models');

const app = buildApp({ serveFrontend: false });

describe('POST /api/users/:id/send-setup-link', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('utente senza password → 200 e token creato', async () => {
    const { authHeader } = await createAdmin();
    const target = await User.create({
      email: 'student@example.it',
      firstName: 'Alice',
      lastName: 'Studente',
      role: 'studente',
      matricola: 'S001',
      status: 'approved',
      isActive: true,
      // niente passwordHash → utente importato senza setup
    });

    const res = await request(app)
      .post(`/api/users/${target.id}/send-setup-link`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.expiresAt).toBeTruthy();

    const tokens = await PasswordResetToken.findAll({ where: { userId: target.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].purpose).toBe('initial_setup');
    expect(tokens[0].usedAt).toBeNull();
  });

  it('utente con password già impostata → 400 USER_HAS_PASSWORD', async () => {
    const { authHeader } = await createAdmin();
    const target = await User.create({
      email: 'docente@example.it',
      firstName: 'Bob',
      lastName: 'Docente',
      role: 'docente',
      status: 'approved',
      isActive: true,
      passwordHash: 'placeholder-hash-not-bcrypt',
    });

    const res = await request(app)
      .post(`/api/users/${target.id}/send-setup-link`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('USER_HAS_PASSWORD');
  });

  it('re-invio invalida i token precedenti', async () => {
    const { authHeader } = await createAdmin();
    const target = await User.create({
      email: 'recall@example.it',
      firstName: 'Carla',
      lastName: 'Studente',
      role: 'studente',
      matricola: 'S002',
      status: 'approved',
      isActive: true,
    });

    // Prima invio
    await request(app)
      .post(`/api/users/${target.id}/send-setup-link`)
      .set('Authorization', authHeader)
      .expect(200);

    // Secondo invio
    await request(app)
      .post(`/api/users/${target.id}/send-setup-link`)
      .set('Authorization', authHeader)
      .expect(200);

    const all = await PasswordResetToken.findAll({
      where: { userId: target.id },
      order: [['createdAt', 'ASC']],
    });
    expect(all).toHaveLength(2);
    // Il primo deve essere stato marcato come usato (invalidato)
    expect(all[0].usedAt).not.toBeNull();
    // Il secondo è ancora attivo
    expect(all[1].usedAt).toBeNull();
  });

  it('TTL fuori range 1-90 → 400 INVALID_TTL', async () => {
    const { authHeader } = await createAdmin();
    const target = await User.create({
      email: 'ttl@example.it',
      firstName: 'T',
      lastName: 'T',
      role: 'studente',
      matricola: 'S003',
      status: 'approved',
      isActive: true,
    });

    const res = await request(app)
      .post(`/api/users/${target.id}/send-setup-link`)
      .set('Authorization', authHeader)
      .send({ ttlDays: 999 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_TTL');
  });

  it('non admin → 403', async () => {
    const { user, authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app)
      .post(`/api/users/${user.id}/send-setup-link`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/users/send-setup-links-bulk', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('bulk OK: tutti gli utenti senza password ricevono il link', async () => {
    const { authHeader } = await createAdmin();
    const u1 = await User.create({
      email: 'b1@example.it',
      firstName: 'A',
      lastName: 'A',
      role: 'studente',
      matricola: 'B001',
      status: 'approved',
      isActive: true,
    });
    const u2 = await User.create({
      email: 'b2@example.it',
      firstName: 'B',
      lastName: 'B',
      role: 'studente',
      matricola: 'B002',
      status: 'approved',
      isActive: true,
    });

    const res = await request(app)
      .post('/api/users/send-setup-links-bulk')
      .set('Authorization', authHeader)
      .send({ userIds: [u1.id, u2.id] });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(2);
    expect(res.body.skipped).toBe(0);

    const t1 = await PasswordResetToken.findOne({ where: { userId: u1.id } });
    const t2 = await PasswordResetToken.findOne({ where: { userId: u2.id } });
    expect(t1?.purpose).toBe('initial_setup');
    expect(t2?.purpose).toBe('initial_setup');
  });

  it('skippa utenti con password già impostata', async () => {
    const { authHeader } = await createAdmin();
    const empty = await User.create({
      email: 'empty@example.it',
      firstName: 'E',
      lastName: 'E',
      role: 'studente',
      matricola: 'E001',
      status: 'approved',
      isActive: true,
    });
    const full = await User.create({
      email: 'full@example.it',
      firstName: 'F',
      lastName: 'F',
      role: 'docente',
      status: 'approved',
      isActive: true,
      passwordHash: 'hash',
    });

    const res = await request(app)
      .post('/api/users/send-setup-links-bulk')
      .set('Authorization', authHeader)
      .send({ userIds: [empty.id, full.id] });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.skippedReasons.USER_HAS_PASSWORD).toBe(1);
  });

  it('userIds vuoto → 400 EMPTY_LIST', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/users/send-setup-links-bulk')
      .set('Authorization', authHeader)
      .send({ userIds: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMPTY_LIST');
  });

  it('userIds > 1000 → 400 TOO_MANY', async () => {
    const { authHeader } = await createAdmin();
    const bigList = Array.from({ length: 1001 }, (_, i) => i + 1);
    const res = await request(app)
      .post('/api/users/send-setup-links-bulk')
      .set('Authorization', authHeader)
      .send({ userIds: bigList });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_MANY');
  });

  it('non admin → 403', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app)
      .post('/api/users/send-setup-links-bulk')
      .set('Authorization', authHeader)
      .send({ userIds: [1, 2] });
    expect(res.status).toBe(403);
  });
});
