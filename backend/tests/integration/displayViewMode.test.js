'use strict';

/**
 * Test per Building.displayViewMode (vista kiosk per edificio).
 *
 * Copertura:
 *   - default 'weekly' alla creazione
 *   - admin può aggiornare a 'daily' via PUT /api/structure/buildings/:id
 *   - PUT respinge valori fuori enum
 *   - /api/public/agenda espone code + displayViewMode su ogni building
 *   - /api/public/display-config espone code + viewMode
 */

const request = require('supertest');

const { buildApp } = require('../../app');
const { createAdmin, createBuilding, createRoom } = require('../factories');
const { Building } = require('../../models');

const app = buildApp({ serveFrontend: false });

beforeEach(async () => {
  await resetDatabase();
});

describe('Building.displayViewMode', () => {
  it('default è "weekly" per nuovi building', async () => {
    const b = await createBuilding();
    const fresh = await Building.findByPk(b.id);
    expect(fresh.displayViewMode).toBe('weekly');
  });

  it('PUT /structure/buildings/:id aggiorna displayViewMode a "daily"', async () => {
    const b = await createBuilding();
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .put(`/api/structure/buildings/${b.id}`)
      .set('Authorization', authHeader)
      .send({ displayViewMode: 'daily' });
    expect(res.status).toBe(200);
    const refreshed = await Building.findByPk(b.id);
    expect(refreshed.displayViewMode).toBe('daily');
  });

  it('PUT rifiuta valori fuori enum', async () => {
    const b = await createBuilding();
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .put(`/api/structure/buildings/${b.id}`)
      .set('Authorization', authHeader)
      .send({ displayViewMode: 'yearly' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('GET /api/public/agenda espone code + displayViewMode per building', async () => {
    const b = await createBuilding({ name: 'Sede Centrale', code: 'CENT' });
    await b.update({ displayViewMode: 'daily' });
    await createRoom({ building: b });

    const res = await request(app).get('/api/public/agenda');
    expect(res.status).toBe(200);
    const found = res.body.buildings.find((x) => x.id === b.id);
    expect(found).toBeTruthy();
    expect(found.code).toBe('CENT');
    expect(found.displayViewMode).toBe('daily');
  });

  it('GET /api/public/display-config espone code + viewMode', async () => {
    const b = await createBuilding({ name: 'Sede Radar', code: 'RADAR' });
    await b.update({ displayViewMode: 'daily', displayEnabled: true });

    const res = await request(app).get('/api/public/display-config');
    expect(res.status).toBe(200);
    const found = res.body.buildings.find((x) => x.id === b.id);
    expect(found).toBeTruthy();
    expect(found.code).toBe('RADAR');
    expect(found.viewMode).toBe('daily');
  });
});
