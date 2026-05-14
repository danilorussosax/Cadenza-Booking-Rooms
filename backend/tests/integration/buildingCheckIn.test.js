'use strict';

/**
 * Test integration per il toggle "check-in per edificio" (impostazione
 * generale) — endpoint admin in routes/structure.js.
 *
 * Copre:
 *   - GET /api/structure/buildings/checkin-defaults
 *   - PATCH /api/structure/buildings/:id/checkin-default
 *   - cascata Room.requireCheckIn null → Building.checkInDefault
 *   - override Room.requireCheckIn !== null → vince sul Building
 */

const request = require('supertest');

const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser, createBuilding, createRoom } = require('../factories');
const { Building, Room } = require('../../models');
const { isCheckInRequired } = require('../../lib/checkInPolicy');

const app = buildApp({ serveFrontend: false });

beforeEach(async () => {
  await resetDatabase();
});

describe('Building.checkInDefault — endpoint admin', () => {
  describe('GET /api/structure/buildings/checkin-defaults', () => {
    it('200 lista edifici con statistiche override', async () => {
      const { authHeader } = await createAdmin();
      const b1 = await createBuilding({ name: 'Sede A', code: 'A' });
      const b2 = await createBuilding({ name: 'Sede B', code: 'B' });
      // 3 aule in Sede A: 1 con override true, 1 con override false, 1 ereditante (null)
      await createRoom({ building: b1, requireCheckIn: true });
      await createRoom({ building: b1, requireCheckIn: false });
      await createRoom({ building: b1, requireCheckIn: null });
      // Sede B: nessuna aula
      await b2.update({ checkInDefault: true });

      const res = await request(app)
        .get('/api/structure/buildings/checkin-defaults')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      const a = res.body.items.find((x) => x.id === b1.id);
      const bRow = res.body.items.find((x) => x.id === b2.id);
      expect(a).toMatchObject({
        name: 'Sede A',
        code: 'A',
        checkInDefault: false,
        roomsTotal: 3,
        roomsWithOverride: 2, // true e false sono override, null è ereditante
      });
      expect(bRow).toMatchObject({
        name: 'Sede B',
        code: 'B',
        checkInDefault: true,
        roomsTotal: 0,
        roomsWithOverride: 0,
      });
    });

    it('403 per utenti non admin', async () => {
      const { authHeader } = await createAuthedUser(); // studente
      const res = await request(app)
        .get('/api/structure/buildings/checkin-defaults')
        .set('Authorization', authHeader);
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/structure/buildings/:id/checkin-default', () => {
    it('200 aggiorna checkInDefault e ritorna il building con statistiche', async () => {
      const { authHeader } = await createAdmin();
      const b = await createBuilding({ name: 'Sede X' });
      await createRoom({ building: b, requireCheckIn: null });
      await createRoom({ building: b, requireCheckIn: true });

      const res = await request(app)
        .patch(`/api/structure/buildings/${b.id}/checkin-default`)
        .set('Authorization', authHeader)
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.building).toMatchObject({
        id: b.id,
        checkInDefault: true,
        roomsTotal: 2,
        roomsWithOverride: 1,
      });
      const fresh = await Building.findByPk(b.id);
      expect(fresh.checkInDefault).toBe(true);
    });

    it('400 se enabled non è boolean', async () => {
      const { authHeader } = await createAdmin();
      const b = await createBuilding();
      const res = await request(app)
        .patch(`/api/structure/buildings/${b.id}/checkin-default`)
        .set('Authorization', authHeader)
        .send({ enabled: 'yes' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('404 se building non esiste', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .patch('/api/structure/buildings/999999/checkin-default')
        .set('Authorization', authHeader)
        .send({ enabled: true });
      expect(res.status).toBe(404);
    });
  });

  describe('cascata Building.checkInDefault → Room.requireCheckIn', () => {
    it('cambiare Building.checkInDefault sposta effectiveCheckIn delle aule null', async () => {
      const { authHeader } = await createAdmin();
      const b = await createBuilding();
      const rNull = await createRoom({ building: b, requireCheckIn: null });
      const rTrue = await createRoom({ building: b, requireCheckIn: true });
      const rFalse = await createRoom({ building: b, requireCheckIn: false });

      // Building.checkInDefault=false (default): solo rTrue ha effective=true
      const r1 = await Room.findByPk(rNull.id, { include: [{ association: 'building' }] });
      const r2 = await Room.findByPk(rTrue.id, { include: [{ association: 'building' }] });
      const r3 = await Room.findByPk(rFalse.id, { include: [{ association: 'building' }] });
      expect(isCheckInRequired(r1)).toBe(false);
      expect(isCheckInRequired(r2)).toBe(true);
      expect(isCheckInRequired(r3)).toBe(false);

      // Patch building → checkInDefault=true. La rNull deve passare a true,
      // le altre devono mantenere il loro override.
      const res = await request(app)
        .patch(`/api/structure/buildings/${b.id}/checkin-default`)
        .set('Authorization', authHeader)
        .send({ enabled: true });
      expect(res.status).toBe(200);

      const r1b = await Room.findByPk(rNull.id, { include: [{ association: 'building' }] });
      const r2b = await Room.findByPk(rTrue.id, { include: [{ association: 'building' }] });
      const r3b = await Room.findByPk(rFalse.id, { include: [{ association: 'building' }] });
      expect(isCheckInRequired(r1b)).toBe(true); // ora eredita true
      expect(isCheckInRequired(r2b)).toBe(true); // override invariato
      expect(isCheckInRequired(r3b)).toBe(false); // override invariato
    });
  });
});
