'use strict';

/**
 * Fotografa il body storico `{ error, code, field }` della ValidationError di
 * `pickAllowed` sugli endpoint che la propagano al gestore centrale, più il
 * comportamento del POST edifici con errori Sequelize (FK).
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin } = require('../factories');
const { Institute, Building, Room, Equipment } = require('../../models');

const app = buildApp({ serveFrontend: false });

async function setup() {
  const { authHeader } = await createAdmin();
  const inst = await Institute.create({ name: 'Cons' });
  const building = await Building.create({ instituteId: inst.id, name: 'A', floors: ['T'] });
  const room = await Room.create({ buildingId: building.id, name: 'R1', floor: 'T' });
  const eq = await Equipment.create({ roomId: room.id, name: 'Piano' });
  return { authHeader, inst, building, room, eq };
}

const typeBody = (field) => ({
  error: `Campo "${field}" deve essere stringa`,
  code: 'INVALID_TYPE',
  field,
});

describe('ValidationError di pickAllowed: body {error, code, field}', () => {
  it('POST /buildings', async () => {
    const { authHeader, inst } = await setup();
    const res = await request(app)
      .post('/api/structure/buildings')
      .set('Authorization', authHeader)
      .send({ instituteId: inst.id, name: 'X', code: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(typeBody('code'));
    expect(Object.keys(res.body)).toEqual(['error', 'code', 'field']);
  });

  it('PUT /buildings/:id', async () => {
    const { authHeader, building } = await setup();
    const res = await request(app)
      .put(`/api/structure/buildings/${building.id}`)
      .set('Authorization', authHeader)
      .send({ code: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(typeBody('code'));
    expect(Object.keys(res.body)).toEqual(['error', 'code', 'field']);
  });

  it('POST /rooms', async () => {
    const { authHeader, building } = await setup();
    const res = await request(app)
      .post('/api/structure/rooms')
      .set('Authorization', authHeader)
      .send({ buildingId: building.id, name: 'X', floor: 'T', code: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(typeBody('code'));
    expect(Object.keys(res.body)).toEqual(['error', 'code', 'field']);
  });

  it('PUT /rooms/:id', async () => {
    const { authHeader, room } = await setup();
    const res = await request(app)
      .put(`/api/structure/rooms/${room.id}`)
      .set('Authorization', authHeader)
      .send({ code: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(typeBody('code'));
    expect(Object.keys(res.body)).toEqual(['error', 'code', 'field']);
  });

  it('POST /equipment', async () => {
    const { authHeader, room } = await setup();
    const res = await request(app)
      .post('/api/structure/equipment')
      .set('Authorization', authHeader)
      .send({ roomId: room.id, name: 'X', brand: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(typeBody('brand'));
    expect(Object.keys(res.body)).toEqual(['error', 'code', 'field']);
  });

  it('PUT /equipment/:id', async () => {
    const { authHeader, eq } = await setup();
    const res = await request(app)
      .put(`/api/structure/equipment/${eq.id}`)
      .set('Authorization', authHeader)
      .send({ brand: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(typeBody('brand'));
    expect(Object.keys(res.body)).toEqual(['error', 'code', 'field']);
  });

  it('PUT /api/admin/booking-types/:code', async () => {
    const { authHeader } = await setup();
    await require('../../seeders/initial')();
    const res = await request(app)
      .put('/api/admin/booking-types/lezione')
      .set('Authorization', authHeader)
      .send({ sortOrder: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_TYPE');
    expect(res.body.field).toBe('sortOrder');
    expect(Object.keys(res.body)).toEqual(['error', 'code', 'field']);
  });
});

describe('POST /buildings con errore Sequelize', () => {
  it('istituto inesistente (FK): 409 FK_VIOLATION invece di 500', async () => {
    const { authHeader } = await setup();
    const res = await request(app)
      .post('/api/structure/buildings')
      .set('Authorization', authHeader)
      .send({ instituteId: 999999, name: 'Orfano' });
    // Prima del refactor: 500 con details.message del driver; ora il gestore centrale lo mappa.
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FK_VIOLATION');
  });
});
