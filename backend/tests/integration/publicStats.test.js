'use strict';

/**
 * GET /api/public/stats su dati reali: bookingsByHour usa la semantica
 * «fascia occupata» (fine a ora piena esclusiva) in ora istituzionale.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const institutionTime = require('../../lib/institutionTime');
const { createBooking, createRoom, createUser } = require('../factories');
const { Announcement } = require('../../models');

const app = buildApp({ serveFrontend: false });

describe('GET /api/public/stats', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    institutionTime.setClock(new Date('2026-05-13T10:00:00Z')); // 12:00 Roma
  });
  afterEach(() => institutionTime.resetClock());

  it('09:00-10:00 occupa solo la fascia 9; 09:30-10:30 le fasce 9 e 10', async () => {
    const user = await createUser();
    const room = await createRoom();
    await createBooking({
      user,
      room,
      startTime: institutionTime.atLocal('2026-05-13', '09:00'),
      endTime: institutionTime.atLocal('2026-05-13', '10:00'),
    });
    await createBooking({
      user,
      room: await createRoom(),
      startTime: institutionTime.atLocal('2026-05-13', '09:30'),
      endTime: institutionTime.atLocal('2026-05-13', '10:30'),
    });

    const res = await request(app).get('/api/public/stats');
    expect(res.status).toBe(200);
    const h = Object.fromEntries(res.body.bookingsByHour.map((b) => [b.hour, b.count]));
    expect([h[8], h[9], h[10], h[11]]).toEqual([0, 2, 1, 0]);
    expect(res.body.today.bookings).toBe(2);
    expect(res.body.today.hours).toBe(2);
  });
});

describe('GET /api/public/announcements — audience malformata', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('audience malformata nel DB è trattata come "all" (come il feed utente)', async () => {
    await Announcement.create({ title: 'Malformata', body: 'x', audience: { kind: 'inventato' } });
    await Announcement.create({
      title: 'Ruolo',
      body: 'x',
      audience: { kind: 'role', value: 'docente' },
    });
    const res = await request(app).get('/api/public/announcements');
    expect(res.status).toBe(200);
    expect(res.body.announcements.map((a) => a.title)).toEqual(['Malformata']);
  });
});
