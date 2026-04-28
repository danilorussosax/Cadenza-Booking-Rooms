'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { CourseLevel } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

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
    if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
    const deleted = await CourseLevel.destroy({ where: { id: { [Op.in]: ids } } });
    res.json({ deleted });
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({ error: 'Eliminazione bloccata da vincoli di integrità.' });
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
    if (!errs.isEmpty())
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });
    try {
      const lvl = await CourseLevel.create({
        code: String(req.body.code).trim().toLowerCase(),
        name: String(req.body.name).trim(),
        sortOrder: Number.isFinite(req.body.sortOrder) ? req.body.sortOrder : 0,
      });
      res.status(201).json({ level: lvl });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Codice livello già esistente' });
      }
      res.status(500).json({ error: 'Errore creazione livello' });
    }
  },
);

router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const lvl = await CourseLevel.findByPk(req.params.id);
  if (!lvl) return res.status(404).json({ error: 'Livello non trovato' });
  await lvl.update({
    code: req.body.code ? String(req.body.code).trim().toLowerCase() : lvl.code,
    name: req.body.name ? String(req.body.name).trim() : lvl.name,
    sortOrder: Number.isFinite(req.body.sortOrder) ? req.body.sortOrder : lvl.sortOrder,
  });
  res.json({ level: lvl });
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const lvl = await CourseLevel.findByPk(req.params.id);
  if (!lvl) return res.status(404).json({ error: 'Livello non trovato' });
  await lvl.destroy();
  res.json({ message: 'Livello eliminato' });
});

module.exports = router;
