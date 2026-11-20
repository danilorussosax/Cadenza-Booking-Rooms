'use strict';

const express = require('express');
// Edifici.

const { body, validationResult } = require('express-validator');
const { Institute, Building, Room, Equipment } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const removal = require('../../services/removal');
const { pickAllowed } = require('../../lib/sanitize');

const { domainError, httpError } = require('../../lib/domainError');

const router = express.Router();
// Whitelist dei campi assegnabili da admin via REST (anti mass-assignment).
// Esclude esplicitamente: id, deletedAt, createdAt, updatedAt, qrToken (gestito
// solo da endpoint dedicati /qr/regenerate).
const BUILDING_ALLOWED = {
  instituteId: { type: 'integer', min: 1 },
  name: { type: 'string', maxLength: 100 },
  code: { type: 'string', maxLength: 50, nullable: true },
  address: { type: 'string', maxLength: 255, nullable: true },
  floors: 'json', // array di stringhe; validazione di forma a livello model
  description: { type: 'string', nullable: true },
  displayEnabled: 'boolean',
  displayIntervalSec: { type: 'integer', min: 5, max: 600 },
  displayConcertsDays: { type: 'integer', min: 0, max: 365 },
  displayConcertsEnabled: 'boolean',
  displayConcertsCount: { type: 'integer', min: 0, max: 100 },
  displayConcertsIntervalSec: { type: 'integer', min: 1, max: 600 },
  displayBookingsEnabled: 'boolean',
  displayAnnouncementsEnabled: 'boolean',
  displayAnnouncementsCount: { type: 'integer', min: 0, max: 100 },
  displayAnnouncementsIntervalSec: { type: 'integer', min: 1, max: 600 },
  displayAnnouncementsPinnedOnly: 'boolean',
  displayViewMode: { type: 'enum', values: ['weekly', 'daily'] },
  // Toggle "check-in per edificio" (impostazione generale).
  checkInDefault: 'boolean',
};

// =========================================================
// EDIFICI
// =========================================================

router.get('/buildings', authenticate, async (req, res) => {
  const where = {};
  if (req.query.instituteId) where.instituteId = req.query.instituteId;
  const buildings = await Building.findAll({
    where,
    include: [
      { model: Institute, as: 'institute' },
      { model: Room, as: 'rooms' },
    ],
    order: [['name', 'ASC']],
  });
  res.json({ buildings });
});

// =========================================================
// Toggle check-in per edificio (impostazione generale)
// =========================================================
//   GET   /buildings/checkin-defaults            lista + statistiche override
//   PATCH /buildings/:id/checkin-default         on/off generale per edificio
//
// Registrate PRIMA di /buildings/:id (GET) per evitare il match dinamico:
// :id="checkin-defaults" farebbe esplodere findByPk con un cast intero.
router.get(
  '/buildings/checkin-defaults',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const buildings = await Building.findAll({
        attributes: ['id', 'name', 'code', 'checkInDefault'],
        order: [['name', 'ASC']],
      });
      // Conteggio per-edificio in un'unica query: si bucketizza in JS
      // invece di fare 2 Room.count per ogni building (era 2N+1 round-trip).
      const rooms = await Room.findAll({
        attributes: ['buildingId', 'requireCheckIn'],
        where: { buildingId: buildings.map((b) => b.id) },
        raw: true,
      });
      const counts = new Map();
      for (const r of rooms) {
        const entry = counts.get(r.buildingId) || { total: 0, overrides: 0 };
        entry.total += 1;
        if (r.requireCheckIn !== null) entry.overrides += 1;
        counts.set(r.buildingId, entry);
      }
      const items = buildings.map((b) => {
        const c = counts.get(b.id) || { total: 0, overrides: 0 };
        return {
          id: b.id,
          name: b.name,
          code: b.code,
          checkInDefault: b.checkInDefault,
          roomsTotal: c.total,
          roomsWithOverride: c.overrides,
        };
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/buildings/:id/checkin-default',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const b = await Building.findByPk(req.params.id);
      if (!b) throw domainError('NOT_FOUND', 'Edificio non trovato', { status: 404 });
      const raw = req.body?.enabled;
      if (typeof raw !== 'boolean') {
        throw domainError('VALIDATION_FAILED', 'Campo "enabled" deve essere boolean');
      }
      await b.update({ checkInDefault: raw });
      const rooms = await Room.findAll({
        attributes: ['requireCheckIn'],
        where: { buildingId: b.id },
        raw: true,
      });
      const roomsTotal = rooms.length;
      const roomsWithOverride = rooms.filter((r) => r.requireCheckIn !== null).length;
      res.json({
        building: {
          id: b.id,
          name: b.name,
          code: b.code,
          checkInDefault: b.checkInDefault,
          roomsTotal,
          roomsWithOverride,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/buildings/:id', authenticate, async (req, res) => {
  const building = await Building.findByPk(req.params.id, {
    include: [
      { model: Institute, as: 'institute' },
      { model: Room, as: 'rooms', include: [{ model: Equipment, as: 'equipment' }] },
    ],
  });
  if (!building) throw httpError(404, 'Edificio non trovato');
  res.json({ building });
});

router.post(
  '/buildings',
  authenticate,
  requireRole('admin'),
  [
    body('instituteId').isInt(),
    body('name').notEmpty().trim(),
    body('floors').optional().isArray(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) throw httpError(400, 'Validazione fallita', { details: errs.array() });
    const building = await Building.create(pickAllowed(req.body, BUILDING_ALLOWED));
    res.status(201).json({ building });
  },
);

// Bulk delete edifici (admin) — REGISTRATO PRIMA di /:id per vincere il route match.
router.post('/buildings/bulk-delete', authenticate, requireRole('admin'), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (ids.length === 0) throw httpError(400, 'Nessun id fornito');
  const { deleted, removedRooms, removedBookings } = await removal.removeBuildings(ids, {
    bookings: 'purge',
  });
  res.json({ deleted, removedRooms, removedBookings });
});

router.put('/buildings/:id', authenticate, requireRole('admin'), async (req, res) => {
  const b = await Building.findByPk(req.params.id);
  if (!b) throw httpError(404, 'Edificio non trovato');
  await b.update(pickAllowed(req.body, BUILDING_ALLOWED));
  res.json({ building: b });
});

router.delete('/buildings/:id', authenticate, requireRole('admin'), async (req, res) => {
  const b = await Building.findByPk(req.params.id);
  if (!b) throw httpError(404, 'Edificio non trovato');
  const { removedBookings } = await removal.removeBuildings([b.id], { bookings: 'purge' });
  res.json({ message: 'Edificio eliminato', removedBookings });
});

module.exports = router;
