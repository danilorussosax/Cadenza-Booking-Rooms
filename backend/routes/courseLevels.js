'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { CourseLevel } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../lib/domainError');

const router = express.Router();

// Lista (pubblica: serve nei form di registrazione e nei filtri)
router.get('/', async (req, res) => {
  const items = await CourseLevel.findAll({
    order: [
      ['sortOrder', 'ASC'],
      ['name', 'ASC'],
    ],
  });
  res.json({ levels: items });
});

// Bulk delete (admin) — registrato PRIMA di /:id
router.post('/bulk-delete', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) throw httpError(400, 'Nessun id fornito');
    const deleted = await CourseLevel.destroy({ where: { id: { [Op.in]: ids } } });
    res.json({ deleted });
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      throw httpError(409, 'Eliminazione bloccata da vincoli di integrità.');
    }
    next(err);
  }
});

router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [body('code').notEmpty().trim(), body('name').notEmpty().trim()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) throw httpError(400, 'Validazione fallita', { details: errs.array() });
    try {
      const lvl = await CourseLevel.create({
        code: String(req.body.code).trim().toLowerCase(),
        name: String(req.body.name).trim(),
        sortOrder: Number.isFinite(req.body.sortOrder) ? req.body.sortOrder : 0,
      });
      res.status(201).json({ level: lvl });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        throw httpError(409, 'Codice livello già esistente');
      }
      res.status(500).json({ error: 'Errore creazione livello' });
    }
  },
);

router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const lvl = await CourseLevel.findByPk(req.params.id);
  if (!lvl) throw httpError(404, 'Livello non trovato');
  await lvl.update({
    code: req.body.code ? String(req.body.code).trim().toLowerCase() : lvl.code,
    name: req.body.name ? String(req.body.name).trim() : lvl.name,
    sortOrder: Number.isFinite(req.body.sortOrder) ? req.body.sortOrder : lvl.sortOrder,
  });
  res.json({ level: lvl });
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const lvl = await CourseLevel.findByPk(req.params.id);
  if (!lvl) throw httpError(404, 'Livello non trovato');
  await lvl.destroy();
  res.json({ message: 'Livello eliminato' });
});

module.exports = router;
