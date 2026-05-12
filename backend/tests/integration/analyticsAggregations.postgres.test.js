'use strict';

/**
 * Integration: routes/analytics.js — aggregazioni reali (Postgres-only).
 *
 * I test in tests/integration/analytics.test.js coprono solo i guard
 * (auth/range/CSV export con Sequelize standard). Le aggregazioni vere
 * (heatmap 7×24, top10 rooms/users, no-show rate, trend 8w) usano
 * SQL Postgres-only (`EXTRACT(DOW|HOUR|EPOCH FROM ...)`, `date_trunc`,
 * cast `::int`) che SQLite in-memory NON supporta.
 *
 * Questo file gira SOLO se DB_DIALECT=postgres ed e' eseguito dal job CI
 * dedicato `backend-postgres` (vedi .github/workflows/ci.yml).
 *
 * Per eseguirlo in locale:
 *   DB_DIALECT=postgres \
 *   DB_HOST=localhost DB_PORT=5432 \
 *   DB_NAME=cadenza_test DB_USER=cadenza DB_PASSWORD=... \
 *   DB_SSL=false \
 *   npx vitest run tests/integration/analyticsAggregations.postgres.test.js
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { sequelize } = require('../../models');
const { createAdmin, createBooking, createRoom } = require('../factories');

const isPostgres = sequelize.getDialect() === 'postgres';

(isPostgres ? describe : describe.skip)('analytics aggregations (Postgres only)', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  // Helper: timestamp `lunedi della settimana corrente alle 10:00` per
  // posizionare le booking in una fascia deterministica della heatmap.
  // `EXTRACT(DOW)` Postgres = 0 (domenica) ... 6 (sabato), il route
  // converte a 0=lunedi ... 6=domenica.
  function mondayAt(hour) {
    const d = new Date();
    const day = d.getDay() || 7; // 1..7 con lunedi=1
    d.setDate(d.getDate() - (day - 1)); // sposta a lunedi
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  describe('GET /api/admin/analytics', () => {
    it('200 con shape completa anche su DB vuoto', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app).get('/api/admin/analytics').set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('range');
      expect(res.body).toHaveProperty('summary');
      expect(res.body.summary).toMatchObject({
        confirmedBookings: 0,
        ghostedBookings: 0,
        totalCreated: 0,
        noShowRatePct: 0,
      });
      expect(res.body.heatmap).toHaveLength(7);
      expect(res.body.heatmap[0]).toHaveLength(24);
      expect(res.body.topRooms).toEqual([]);
      expect(res.body.topUsers).toEqual([]);
      expect(Array.isArray(res.body.trend)).toBe(true);
    });

    it('aggrega 1 booking confermata in heatmap[Lun][10] e nei top', async () => {
      const { authHeader, user: admin } = await createAdmin();
      const room = await createRoom({ name: 'Aula Test' });
      const start = mondayAt(10);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2h
      await createBooking({ user: admin, room, startTime: start, endTime: end });

      const res = await request(app).get('/api/admin/analytics').set('Authorization', authHeader);
      expect(res.status).toBe(200);

      // heatmap[0] = lunedi locale, heatmap[0][10] = ora 10
      expect(res.body.heatmap[0][10]).toMatchObject({ count: 1 });
      expect(res.body.heatmap[0][10].hours).toBeCloseTo(2, 1);

      expect(res.body.topRooms).toHaveLength(1);
      expect(res.body.topRooms[0]).toMatchObject({
        roomId: room.id,
        name: 'Aula Test',
        count: 1,
      });
      expect(res.body.topRooms[0].hours).toBeCloseTo(2, 1);

      expect(res.body.topUsers).toHaveLength(1);
      expect(res.body.topUsers[0]).toMatchObject({ userId: admin.id, count: 1 });

      expect(res.body.summary.confirmedBookings).toBe(1);
      expect(res.body.summary.totalCreated).toBe(1);
      expect(res.body.summary.noShowRatePct).toBe(0);
    });

    it('no-show rate = ghosted / totalCreated × 100, arrotondato a 1 decimale', async () => {
      const { authHeader, user: admin } = await createAdmin();
      const room = await createRoom();
      const start = mondayAt(11);
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      // 1 booking confermata + 1 auto-cancellata (ghost)
      await createBooking({ user: admin, room, startTime: start, endTime: end });
      const start2 = mondayAt(12);
      const end2 = new Date(start2.getTime() + 60 * 60 * 1000);
      await createBooking({
        user: admin,
        room,
        startTime: start2,
        endTime: end2,
        status: 'cancelled',
        autoCancelledAt: new Date(),
      });

      const res = await request(app).get('/api/admin/analytics').set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.summary.confirmedBookings).toBe(1);
      expect(res.body.summary.ghostedBookings).toBe(1);
      expect(res.body.summary.totalCreated).toBe(2);
      // 1/2 = 50.0%
      expect(res.body.summary.noShowRatePct).toBe(50);
    });

    it('topRooms ordinato DESC per ore totali', async () => {
      const { authHeader, user: admin } = await createAdmin();
      const r1 = await createRoom({ name: 'R1' });
      const r2 = await createRoom({ name: 'R2' });

      // R1: 1 ora; R2: 3 ore
      await createBooking({
        user: admin,
        room: r1,
        startTime: mondayAt(9),
        endTime: new Date(mondayAt(9).getTime() + 60 * 60 * 1000),
      });
      const start2 = mondayAt(14);
      await createBooking({
        user: admin,
        room: r2,
        startTime: start2,
        endTime: new Date(start2.getTime() + 3 * 60 * 60 * 1000),
      });

      const res = await request(app).get('/api/admin/analytics').set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.topRooms.map((r) => r.name)).toEqual(['R2', 'R1']);
      expect(res.body.topRooms[0].hours).toBeCloseTo(3, 1);
      expect(res.body.topRooms[1].hours).toBeCloseTo(1, 1);
    });

    it('rispetta dateFrom/dateTo nel range (esclude booking fuori range)', async () => {
      const { authHeader, user: admin } = await createAdmin();
      const room = await createRoom();
      const today = new Date();
      const oldStart = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000); // 60gg fa
      await createBooking({
        user: admin,
        room,
        startTime: oldStart,
        endTime: new Date(oldStart.getTime() + 60 * 60 * 1000),
      });

      // dateFrom ultima settimana → la booking di 60gg fa NON e' inclusa
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const res = await request(app)
        .get(`/api/admin/analytics?dateFrom=${weekAgo}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.summary.confirmedBookings).toBe(0);
      expect(res.body.summary.totalCreated).toBe(0);
    });
  });

  describe('GET /api/admin/analytics/export.pdf', () => {
    it('200 con Content-Type application/pdf su DB vuoto', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/admin/analytics/export.pdf')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse((res2, callback) => {
          const chunks = [];
          res2.on('data', (c) => chunks.push(c));
          res2.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      // PDF magic header `%PDF`
      expect(res.body.slice(0, 4).toString()).toBe('%PDF');
    });

    it('200 con dati non-vuoti', async () => {
      const { authHeader, user: admin } = await createAdmin();
      const room = await createRoom();
      const start = mondayAt(10);
      await createBooking({
        user: admin,
        room,
        startTime: start,
        endTime: new Date(start.getTime() + 60 * 60 * 1000),
      });

      const res = await request(app)
        .get('/api/admin/analytics/export.pdf')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse((res2, callback) => {
          const chunks = [];
          res2.on('data', (c) => chunks.push(c));
          res2.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      // Un PDF non triviale dovrebbe pesare almeno qualche centinaio di byte
      expect(res.body.length).toBeGreaterThan(500);
    });
  });
});
