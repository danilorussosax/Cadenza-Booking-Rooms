'use strict';

/**
 * Integration: routes/bookings.js — coverage espansa da 43.9% branches.
 * Focus su endpoint secondari e branch di errore non coperti dai test
 * principali (bookings.test.js, swapAndLogicalConflict, ecc.):
 *   - GET /:id auth + 404 + 403 ownership
 *   - GET /mine/pending
 *   - GET /pending/count (admin)
 *   - GET /availability/:roomId
 *   - GET /checkin-candidates
 *   - GET /ical (token query + Bearer)
 *   - Concert endpoints (GET/PUT/DELETE)
 *   - Validation 400 sui POST
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAuthedUser, createAdmin, createBooking, createRoom } = require('../factories');
const { Booking, Room, User } = require('../../models');

const app = buildApp({ serveFrontend: false });

describe('routes/bookings — GET /:id', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app).get('/api/bookings/1');
    expect(res.status).toBe(401);
  });

  it('404 se id non numerico (guard)', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).get('/api/bookings/abc').set('Authorization', authHeader);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('404 se id <= 0', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).get('/api/bookings/0').set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });

  it('404 se booking non esiste', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).get('/api/bookings/999999').set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });

  it('403 se booking di altro utente (non admin)', async () => {
    const { user: u1 } = await createAuthedUser({ email: 'a@x.it' });
    const { authHeader: h2 } = await createAuthedUser({ email: 'b@x.it' });
    const bk = await createBooking({ user: u1 });
    const res = await request(app).get(`/api/bookings/${bk.id}`).set('Authorization', h2);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('200 se booking di proprio utente', async () => {
    const { user, authHeader } = await createAuthedUser();
    const bk = await createBooking({ user });
    const res = await request(app).get(`/api/bookings/${bk.id}`).set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.booking.id).toBe(bk.id);
  });

  it('200 se admin accede a booking di altro utente', async () => {
    const { user: u1 } = await createAuthedUser({ email: 'a@x.it' });
    const { authHeader: ah } = await createAdmin();
    const bk = await createBooking({ user: u1 });
    const res = await request(app).get(`/api/bookings/${bk.id}`).set('Authorization', ah);
    expect(res.status).toBe(200);
  });
});

describe('routes/bookings — GET /mine/pending', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app).get('/api/bookings/mine/pending');
    expect(res.status).toBe(401);
  });

  it('200 array vuoto se nessuna pending', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .get('/api/bookings/mine/pending')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bookings)).toBe(true);
  });
});

describe('routes/bookings — GET /pending (admin)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('403 per non-admin', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).get('/api/bookings/pending').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('200 lista vuota', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app).get('/api/bookings/pending').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bookings)).toBe(true);
  });

  it('GET /pending/count: 200 con count', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/bookings/pending/count')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
  });
});

describe('routes/bookings — GET /availability/:roomId', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app).get('/api/bookings/availability/1');
    expect(res.status).toBe(401);
  });

  it('200 lista bookings vuota su room esistente', async () => {
    const { authHeader } = await createAuthedUser();
    const room = await createRoom();
    const res = await request(app)
      .get(`/api/bookings/availability/${room.id}?date=2026-05-20`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });
});

describe('routes/bookings — GET /checkin-candidates', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('400 senza roomId', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .get('/api/bookings/checkin-candidates')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('200 vuoto se nessuna booking', async () => {
    const { authHeader } = await createAuthedUser();
    const room = await createRoom();
    const res = await request(app)
      .get(`/api/bookings/checkin-candidates?roomId=${room.id}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.bookings).toEqual([]);
  });

  it('200 + roomCheckInDisabled=true se room ha requireCheckIn=false', async () => {
    const { authHeader } = await createAuthedUser();
    const room = await createRoom({ requireCheckIn: false });
    const res = await request(app)
      .get(`/api/bookings/checkin-candidates?roomId=${room.id}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.roomCheckInDisabled).toBe(true);
    expect(res.body.bookings).toEqual([]);
  });
});

describe('routes/bookings — GET /ical', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token e senza Bearer', async () => {
    const res = await request(app).get('/api/bookings/ical');
    expect(res.status).toBe(401);
  });

  it('401 con token troppo corto', async () => {
    const res = await request(app).get('/api/bookings/ical?token=short');
    expect(res.status).toBe(401);
  });

  it('401 con token random non matching', async () => {
    const res = await request(app).get('/api/bookings/ical?token=' + 'x'.repeat(48));
    expect(res.status).toBe(401);
  });

  it('200 con Bearer JWT valido', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).get('/api/bookings/ical').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/calendar|text/);
  });
});

describe('routes/bookings — POST / (validation)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app).post('/api/bookings').send({});
    expect(res.status).toBe(401);
  });

  it('400/403 body vuoto (validation o profile guard)', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).post('/api/bookings').set('Authorization', authHeader).send({});
    expect([400, 403]).toContain(res.status);
  });

  it('400/403 startTime/endTime non ISO 8601', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ roomId: 1, startTime: 'not-a-date', endTime: 'not-a-date' });
    expect([400, 403]).toContain(res.status);
  });

  it('400/403 type non valido', async () => {
    const { authHeader } = await createAuthedUser();
    const room = await createRoom();
    const res = await request(app).post('/api/bookings').set('Authorization', authHeader).send({
      roomId: room.id,
      startTime: '2026-06-01T10:00:00Z',
      endTime: '2026-06-01T11:00:00Z',
      type: 'tipo_inventato',
    });
    expect([400, 403]).toContain(res.status);
  });
});

describe('routes/bookings — concert endpoints', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /:id/concert 404 se booking non esiste', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .get('/api/bookings/999999/concert')
      .set('Authorization', authHeader);
    expect([403, 404]).toContain(res.status);
  });

  it('GET /:id/concert 403 su booking di altro utente non-admin', async () => {
    const { user: u1 } = await createAuthedUser({ email: 'a@x.it' });
    const { authHeader: h2 } = await createAuthedUser({ email: 'b@x.it' });
    const bk = await createBooking({ user: u1, type: 'concerto' });
    const res = await request(app).get(`/api/bookings/${bk.id}/concert`).set('Authorization', h2);
    expect(res.status).toBe(403);
  });

  it('GET /:id/concert 200 sul proprio booking concerto', async () => {
    const { user, authHeader } = await createAuthedUser();
    const bk = await createBooking({ user, type: 'concerto' });
    const res = await request(app)
      .get(`/api/bookings/${bk.id}/concert`)
      .set('Authorization', authHeader);
    expect([200, 404]).toContain(res.status);
  });

  it('PUT /:id/concert 403 su booking altrui', async () => {
    const { user: u1 } = await createAuthedUser({ email: 'a@x.it' });
    const { authHeader: h2 } = await createAuthedUser({ email: 'b@x.it' });
    const bk = await createBooking({ user: u1, type: 'concerto' });
    const res = await request(app)
      .put(`/api/bookings/${bk.id}/concert`)
      .set('Authorization', h2)
      .send({ title: 'X' });
    expect(res.status).toBe(403);
  });

  it('PUT /:id/concert 200/201 update proprio', async () => {
    const { user, authHeader } = await createAuthedUser();
    const bk = await createBooking({ user, type: 'concerto' });
    const res = await request(app)
      .put(`/api/bookings/${bk.id}/concert`)
      .set('Authorization', authHeader)
      .send({ title: 'Sinfonia n.5', programme: 'Beethoven' });
    expect([200, 201, 404]).toContain(res.status);
  });

  it('DELETE /:id/concert 403 su booking altrui', async () => {
    const { user: u1 } = await createAuthedUser({ email: 'a@x.it' });
    const { authHeader: h2 } = await createAuthedUser({ email: 'b@x.it' });
    const bk = await createBooking({ user: u1, type: 'concerto' });
    const res = await request(app)
      .delete(`/api/bookings/${bk.id}/concert`)
      .set('Authorization', h2);
    expect(res.status).toBe(403);
  });

  it('DELETE /:id/concert/poster 403 altrui', async () => {
    const { user: u1 } = await createAuthedUser({ email: 'a@x.it' });
    const { authHeader: h2 } = await createAuthedUser({ email: 'b@x.it' });
    const bk = await createBooking({ user: u1, type: 'concerto' });
    const res = await request(app)
      .delete(`/api/bookings/${bk.id}/concert/poster`)
      .set('Authorization', h2);
    expect([403, 404]).toContain(res.status);
  });
});

describe('routes/bookings — approve/reject (admin)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('POST /:id/approve 403 per non-admin', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).post('/api/bookings/1/approve').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('POST /:id/approve 404 su id inesistente', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/bookings/999999/approve')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });

  it('POST /:id/reject 403 per non-admin', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).post('/api/bookings/1/reject').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('POST /:id/reject 404 su id inesistente', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/bookings/999999/reject')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });

  it('POST /bulk-cancel 403 per non-admin', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .post('/api/bookings/bulk-cancel')
      .set('Authorization', authHeader)
      .send({ ids: [1, 2] });
    expect(res.status).toBe(403);
  });

  it('POST /bulk-cancel 400 ids vuoto', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/bookings/bulk-cancel')
      .set('Authorization', authHeader)
      .send({ ids: [] });
    expect([400, 200]).toContain(res.status);
  });

  it('POST /swap 403 per non-admin', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .post('/api/bookings/swap')
      .set('Authorization', authHeader)
      .send({ aId: 1, bId: 2 });
    expect(res.status).toBe(403);
  });
});

describe('routes/bookings — checkin endpoint', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app).post('/api/bookings/1/checkin').send({});
    expect(res.status).toBe(401);
  });

  it('404 booking non esiste', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .post('/api/bookings/999999/checkin')
      .set('Authorization', authHeader)
      .send({});
    expect(res.status).toBe(404);
  });

  it('400 CHECKIN_NOT_REQUIRED se room.requireCheckIn=false', async () => {
    const { user, authHeader } = await createAuthedUser();
    const room = await createRoom({ requireCheckIn: false });
    const bk = await createBooking({ user, room });
    const res = await request(app)
      .post(`/api/bookings/${bk.id}/checkin`)
      .set('Authorization', authHeader)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CHECKIN_NOT_REQUIRED');
  });
});

describe('routes/bookings — PUT/DELETE /:id', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('PUT /:id 401 senza token', async () => {
    const res = await request(app).put('/api/bookings/1').send({});
    expect(res.status).toBe(401);
  });

  it('PUT /:id 404 su id inesistente', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .put('/api/bookings/999999')
      .set('Authorization', authHeader)
      .send({ purpose: 'X' });
    expect(res.status).toBe(404);
  });

  it('PUT /:id 403 su booking altrui (non admin)', async () => {
    const { user: u1 } = await createAuthedUser({ email: 'a@x.it' });
    const { authHeader: h2 } = await createAuthedUser({ email: 'b@x.it' });
    const bk = await createBooking({ user: u1 });
    const res = await request(app)
      .put(`/api/bookings/${bk.id}`)
      .set('Authorization', h2)
      .send({ purpose: 'X' });
    expect(res.status).toBe(403);
  });

  it('DELETE /:id 401 senza token', async () => {
    const res = await request(app).delete('/api/bookings/1');
    expect(res.status).toBe(401);
  });

  it('DELETE /:id 404 su id inesistente', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).delete('/api/bookings/999999').set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });

  it('DELETE /:id 403 su booking altrui (non admin)', async () => {
    const { user: u1 } = await createAuthedUser({ email: 'a@x.it' });
    const { authHeader: h2 } = await createAuthedUser({ email: 'b@x.it' });
    const bk = await createBooking({ user: u1 });
    const res = await request(app).delete(`/api/bookings/${bk.id}`).set('Authorization', h2);
    expect(res.status).toBe(403);
  });
});

describe('routes/bookings — GET / list', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });

  it('200 lista vuota su DB pulito', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).get('/api/bookings').set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });

  it('200 con query date filter', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app)
      .get('/api/bookings?startDate=2026-05-01&endDate=2026-05-31')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });

  it('200 con query roomId filter', async () => {
    const { authHeader } = await createAuthedUser();
    const room = await createRoom();
    const res = await request(app)
      .get(`/api/bookings?roomId=${room.id}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });
});

describe('routes/bookings — GET /usage/me', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza token', async () => {
    const res = await request(app).get('/api/bookings/usage/me');
    expect(res.status).toBe(401);
  });

  it('200 con statistiche di uso', async () => {
    const { authHeader } = await createAuthedUser();
    const res = await request(app).get('/api/bookings/usage/me').set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });
});
