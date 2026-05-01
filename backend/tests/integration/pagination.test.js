'use strict';

/**
 * P1-2 — Pagination uniforme su list-routes admin.
 *
 * Verifica:
 *   - Default limit=100, offset=0 quando non specificati
 *   - Header X-Total-Count, X-Limit, X-Offset esposti correttamente
 *   - limit=0 / negativo → fallback a default
 *   - limit > 500 → clamped a 500
 *   - offset > MAX_OFFSET → clamped a 100k
 *   - Filtri funzionano combinati con paginazione
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { User, Booking } = require('../../models');
const { createAuthedUser, createAdmin, createBooking, createRoom } = require('../factories');
const { parsePagination } = require('../../lib/pagination');

describe('parsePagination (unit)', () => {
  it('default: limit=100, offset=0', () => {
    expect(parsePagination({})).toEqual({ limit: 100, offset: 0 });
  });
  it('custom: limit=10, offset=20', () => {
    expect(parsePagination({ limit: '10', offset: '20' })).toEqual({ limit: 10, offset: 20 });
  });
  it('clamp: limit=999 → 500 (max)', () => {
    expect(parsePagination({ limit: '999' })).toEqual({ limit: 500, offset: 0 });
  });
  it('clamp: limit negativo o zero → default', () => {
    expect(parsePagination({ limit: '-5' }).limit).toBe(100);
    expect(parsePagination({ limit: '0' }).limit).toBe(100);
  });
  it('clamp: offset negativo → 0', () => {
    expect(parsePagination({ offset: '-10' }).offset).toBe(0);
  });
  it('clamp: offset enorme → MAX_OFFSET', () => {
    expect(parsePagination({ offset: '999999999' }).offset).toBe(100_000);
  });
  it('valori non parseable → default', () => {
    expect(parsePagination({ limit: 'abc', offset: 'xyz' })).toEqual({ limit: 100, offset: 0 });
  });
  it('opts.defaultLimit/maxLimit override', () => {
    expect(parsePagination({}, { defaultLimit: 25 })).toEqual({ limit: 25, offset: 0 });
    expect(parsePagination({ limit: '999' }, { maxLimit: 50 })).toEqual({
      limit: 50,
      offset: 0,
    });
  });
});

describe('GET /api/users — paginated', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function seedUsers(n) {
    const { authHeader } = await createAdmin();
    // Suffisso random per evitare collision matricola con createAdmin (che
    // usa la stessa numerazione `M${seq}`). UUID-style local è eccessivo,
    // bastano 6 hex chars.
    const suf = Math.random().toString(16).slice(2, 8);
    for (let i = 0; i < n; i++) {
      await User.create({
        email: `u-${suf}-${String(i).padStart(3, '0')}@t.it`,
        passwordHash: 'Password123!',
        firstName: `F${i}`,
        lastName: `L${String(i).padStart(3, '0')}`,
        role: 'studente',
        status: 'approved',
        isActive: true,
        matricola: `M-${suf}-${i}`,
      });
    }
    return authHeader;
  }

  it('header X-Total-Count + default limit=100', async () => {
    const auth = await seedUsers(5); // 5 studenti + 1 admin = 6
    const res = await request(app).get('/api/users').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.headers['x-total-count']).toBe('6');
    expect(res.headers['x-limit']).toBe('100');
    expect(res.headers['x-offset']).toBe('0');
    expect(res.body.users).toHaveLength(6);
  });

  it('paginazione esplicita: limit=2, offset=2 → 2 utenti', async () => {
    const auth = await seedUsers(10);
    const res = await request(app).get('/api/users?limit=2&offset=2').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.headers['x-total-count']).toBe('11');
    expect(res.headers['x-limit']).toBe('2');
    expect(res.headers['x-offset']).toBe('2');
    expect(res.body.users).toHaveLength(2);
  });

  it('clamp: limit=9999 → 500 (max)', async () => {
    const auth = await seedUsers(3);
    const res = await request(app).get('/api/users?limit=9999').set('Authorization', auth);
    expect(res.headers['x-limit']).toBe('500');
  });

  it('combinato con filtro role=studente', async () => {
    const auth = await seedUsers(7);
    const res = await request(app)
      .get('/api/users?role=studente&limit=3')
      .set('Authorization', auth);
    expect(res.headers['x-total-count']).toBe('7'); // solo gli studenti seedati
    expect(res.body.users).toHaveLength(3);
    expect(res.body.users.every((u) => u.role === 'studente')).toBe(true);
  });

  it('Access-Control-Expose-Headers contiene X-Total-Count', async () => {
    const auth = await seedUsers(1);
    const res = await request(app).get('/api/users').set('Authorization', auth);
    expect(res.headers['access-control-expose-headers']).toMatch(/X-Total-Count/i);
  });
});

describe('GET /api/bookings — paginated', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('header X-Total-Count e limit=2 funziona', async () => {
    const room = await createRoom();
    const { user, authHeader } = await createAuthedUser({ role: 'docente' });
    for (let i = 0; i < 5; i++) {
      await createBooking({
        user,
        room,
        startTime: new Date(Date.now() + (i + 1) * 3600 * 1000),
        endTime: new Date(Date.now() + (i + 2) * 3600 * 1000),
      });
    }
    const res = await request(app)
      .get('/api/bookings?mine=true&limit=2')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.headers['x-total-count']).toBe('5');
    expect(res.body.bookings).toHaveLength(2);
  });
});
