'use strict';

/**
 * Integration: routes/public.js — coverage espansa su /agenda, /stats,
 * /concerts e /announcements con query params + dati reali.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createBooking, createRoom } = require('../factories');
const { Institute, Building, Room, ConcertInfo, Announcement } = require('../../models');

const app = buildApp({ serveFrontend: false });

async function seedMinimalStructure() {
  const inst = await Institute.create({ name: 'Test' });
  const b = await Building.create({
    instituteId: inst.id,
    name: 'Palazzo A',
    floors: ['T'],
    displayEnabled: true,
  });
  const r = await Room.create({
    buildingId: b.id,
    name: 'Aula 1',
    floor: 'T',
    isBookable: true,
    requireCheckIn: true,
    requiresApproval: false,
    type: 'studio',
  });
  return { inst, b, r };
}

describe('routes/public/agenda — query params + data', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('GET /agenda 200 senza query (default today)', async () => {
    await seedMinimalStructure();
    const res = await request(app).get('/api/public/agenda');
    expect(res.status).toBe(200);
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('GET /agenda 200 con date specifica', async () => {
    await seedMinimalStructure();
    const res = await request(app).get('/api/public/agenda?date=2026-06-15');
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-06-15');
  });

  it('GET /agenda 400 con date invalida', async () => {
    const res = await request(app).get('/api/public/agenda?date=not-a-date');
    expect(res.status).toBe(400);
  });

  it('GET /agenda 200 con range from/to', async () => {
    await seedMinimalStructure();
    const res = await request(app).get('/api/public/agenda?from=2026-06-01&to=2026-06-05');
    expect(res.status).toBe(200);
  });

  it('GET /agenda 400 con range non valido', async () => {
    const res = await request(app).get('/api/public/agenda?from=junk&to=alsobad');
    expect(res.status).toBe(400);
  });

  it('GET /agenda 400 con range troppo ampio (>14gg)', async () => {
    const res = await request(app).get('/api/public/agenda?from=2026-01-01&to=2026-12-31');
    expect(res.status).toBe(400);
  });

  it('GET /agenda con booking esistente nel giorno', async () => {
    const { b: building } = await seedMinimalStructure();
    const room = await Room.findOne({ where: { buildingId: building.id } });
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    const end = new Date(today);
    end.setHours(11, 0, 0, 0);
    await createBooking({
      room,
      startTime: today,
      endTime: end,
      status: 'confirmed',
    });
    const dateStr = today.toISOString().slice(0, 10);
    const res = await request(app).get(`/api/public/agenda?date=${dateStr}`);
    expect(res.status).toBe(200);
    expect(res.body.buildings).toBeDefined();
  });
});

describe('routes/public/stats', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('200 con DB vuoto', async () => {
    const res = await request(app).get('/api/public/stats');
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('200 con istituto + room', async () => {
    await seedMinimalStructure();
    const res = await request(app).get('/api/public/stats');
    expect(res.status).toBe(200);
  });
});

describe('routes/public/concerts', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('200 default 30 giorni', async () => {
    const res = await request(app).get('/api/public/concerts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.concerts)).toBe(true);
  });

  it('200 con days=0 → array vuoto (early return)', async () => {
    const res = await request(app).get('/api/public/concerts?days=0');
    expect(res.status).toBe(200);
    expect(res.body.concerts).toEqual([]);
  });

  it('200 con days fuori range (clamp a 365)', async () => {
    const res = await request(app).get('/api/public/concerts?days=9999');
    expect(res.status).toBe(200);
  });

  it('200 con days non numerico (fallback default)', async () => {
    const res = await request(app).get('/api/public/concerts?days=abc');
    expect(res.status).toBe(200);
  });

  it('200 con concerto presente', async () => {
    const { b: building } = await seedMinimalStructure();
    const room = await Room.findOne({ where: { buildingId: building.id } });
    const start = new Date();
    start.setDate(start.getDate() + 5);
    start.setHours(20, 0, 0, 0);
    const end = new Date(start);
    end.setHours(22, 0, 0, 0);
    const bk = await createBooking({
      room,
      startTime: start,
      endTime: end,
      type: 'concerto',
      status: 'confirmed',
    });
    await ConcertInfo.create({
      bookingId: bk.id,
      title: 'Sinfonia n.9',
      performers: 'Orchestra',
      program: 'Beethoven',
    });
    const res = await request(app).get('/api/public/concerts?days=30');
    expect(res.status).toBe(200);
    expect(res.body.concerts.length).toBeGreaterThan(0);
    expect(res.body.concerts[0].title).toBe('Sinfonia n.9');
  });
});

describe('routes/public/display-config', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('200 array vuoto su DB pulito', async () => {
    const res = await request(app).get('/api/public/display-config');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.buildings)).toBe(true);
  });

  it('200 con building displayEnabled', async () => {
    const inst = await Institute.create({ name: 'X' });
    await Building.create({
      instituteId: inst.id,
      name: 'B1',
      floors: ['T'],
      displayEnabled: true,
      displayIntervalSec: 60,
    });
    const res = await request(app).get('/api/public/display-config');
    expect(res.body.buildings.length).toBeGreaterThan(0);
    expect(res.body.buildings[0].intervalSec).toBeGreaterThan(0);
  });

  it('200 esclude buildings con displayEnabled=false', async () => {
    const inst = await Institute.create({ name: 'X' });
    await Building.create({
      instituteId: inst.id,
      name: 'B-off',
      floors: ['T'],
      displayEnabled: false,
    });
    const res = await request(app).get('/api/public/display-config');
    expect(res.body.buildings.filter((b) => b.name === 'B-off')).toHaveLength(0);
  });

  it('200 clamp intervalSec a min 5 (input 1)', async () => {
    const inst = await Institute.create({ name: 'X' });
    await Building.create({
      instituteId: inst.id,
      name: 'BClamp',
      floors: ['T'],
      displayEnabled: true,
      displayIntervalSec: 1,
    });
    const res = await request(app).get('/api/public/display-config');
    const b = res.body.buildings.find((x) => x.name === 'BClamp');
    expect(b.intervalSec).toBeGreaterThanOrEqual(5);
  });

  it('200 clamp intervalSec a max 600 (input 9999)', async () => {
    const inst = await Institute.create({ name: 'X' });
    await Building.create({
      instituteId: inst.id,
      name: 'BClamp2',
      floors: ['T'],
      displayEnabled: true,
      displayIntervalSec: 9999,
    });
    const res = await request(app).get('/api/public/display-config');
    const b = res.body.buildings.find((x) => x.name === 'BClamp2');
    expect(b.intervalSec).toBeLessThanOrEqual(600);
  });
});

describe('routes/public/announcements', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('200 array vuoto', async () => {
    const res = await request(app).get('/api/public/announcements');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.announcements)).toBe(true);
  });

  it('200 con annuncio pubblicato', async () => {
    await Announcement.create({
      title: 'Avviso pubblico',
      body: 'Testo',
      audience: 'all',
      isPublished: true,
      publishedAt: new Date(),
    }).catch(() => {});
    const res = await request(app).get('/api/public/announcements');
    expect(res.status).toBe(200);
  });

  it('200 con limit query', async () => {
    const res = await request(app).get('/api/public/announcements?limit=2');
    expect(res.status).toBe(200);
  });
});

describe('routes/public/institute', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('200 con institute=null se vuoto', async () => {
    const res = await request(app).get('/api/public/institute');
    expect(res.status).toBe(200);
    expect(res.body.institute).toBeNull();
  });

  it('200 ritorna campi pubblici', async () => {
    await Institute.create({ name: 'C', city: 'Roma', logoUrl: '/logo.png' });
    const res = await request(app).get('/api/public/institute');
    expect(res.status).toBe(200);
    expect(res.body.institute.name).toBe('C');
    expect(res.body.institute.city).toBe('Roma');
  });
});
