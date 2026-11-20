'use strict';

const express = require('express');
// Attrezzature.

const { body, validationResult } = require('express-validator');
const { Room, Equipment } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const { pickAllowed } = require('../../lib/sanitize');

const { httpError } = require('../../lib/domainError');

const router = express.Router();
const EQUIPMENT_ALLOWED = {
  roomId: { type: 'integer', min: 1, nullable: true },
  name: { type: 'string', maxLength: 100 },
  type: { type: 'string', maxLength: 50, nullable: true },
  brand: { type: 'string', maxLength: 100, nullable: true },
  model: { type: 'string', maxLength: 100, nullable: true },
  quantity: { type: 'integer', min: 0, max: 10000, nullable: true },
  serialNumber: { type: 'string', maxLength: 100, nullable: true },
  notes: { type: 'string', nullable: true },
  isWorking: 'boolean',
};

// =========================================================
// ATTREZZATURE
// =========================================================

router.get('/equipment', authenticate, async (req, res) => {
  const where = {};
  if (req.query.roomId) where.roomId = req.query.roomId;
  const equipment = await Equipment.findAll({
    where,
    include: [{ model: Room, as: 'room' }],
    order: [['name', 'ASC']],
  });
  res.json({ equipment });
});

router.post(
  '/equipment',
  authenticate,
  requireRole('admin'),
  [body('roomId').isInt(), body('name').notEmpty().trim()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) throw httpError(400, 'Validazione fallita', { details: errs.array() });
    const eq = await Equipment.create(pickAllowed(req.body, EQUIPMENT_ALLOWED));
    res.status(201).json({ equipment: eq });
  },
);

router.put('/equipment/:id', authenticate, requireRole('admin'), async (req, res) => {
  const e = await Equipment.findByPk(req.params.id);
  if (!e) throw httpError(404, 'Attrezzatura non trovata');
  await e.update(pickAllowed(req.body, EQUIPMENT_ALLOWED));
  res.json({ equipment: e });
});

router.delete('/equipment/:id', authenticate, requireRole('admin'), async (req, res) => {
  const e = await Equipment.findByPk(req.params.id);
  if (!e) throw httpError(404, 'Attrezzatura non trovata');
  await e.destroy();
  res.json({ message: 'Attrezzatura eliminata' });
});

module.exports = router;
