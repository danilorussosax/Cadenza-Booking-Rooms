'use strict';

const express = require('express');
// Template attrezzature.

const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { EquipmentTemplate } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');

const { httpError } = require('../../lib/domainError');

const { stringify: csvStringify } = require('csv-stringify/sync');

const router = express.Router();
// =========================================================
// CATALOGO DOTAZIONI (EquipmentTemplate)
// Lista riusabile di nomi di dotazioni che pre-compilano il
// modulo Equipment quando si configura una stanza.
// =========================================================

// Lista (autenticati: tutti)
router.get('/equipment-templates', authenticate, async (req, res) => {
  const items = await EquipmentTemplate.findAll({ order: [['name', 'ASC']] });
  res.json({ templates: items });
});

// Bulk delete (admin) — registrato PRIMA di /:id
router.post(
  '/equipment-templates/bulk-delete',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
      if (ids.length === 0) throw httpError(400, 'Nessun id fornito');
      const deleted = await EquipmentTemplate.destroy({ where: { id: { [Op.in]: ids } } });
      res.json({ deleted });
    } catch (err) {
      if (err.name === 'SequelizeForeignKeyConstraintError') {
        throw httpError(409, 'Eliminazione bloccata da vincoli di integrità.');
      }
      next(err);
    }
  },
);

// Export CSV (admin) — singola colonna "Dotazione" — round-trip safe con import.
router.get(
  '/equipment-templates/export.csv',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const templates = await EquipmentTemplate.findAll({ order: [['name', 'ASC']] });
      const rows = [['Dotazione'], ...templates.map((t) => [t.name])];
      const csv = csvStringify(rows, { delimiter: ';', quoted_string: true });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="dotazioni-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send('﻿' + csv);
    } catch (err) {
      next(err);
    }
  },
);

// Import CSV (admin) — singola colonna "Dotazione" (o "Nome"); ogni riga = un nome.
router.post('/equipment-templates/import', authenticate, requireRole('admin'), async (req, res) => {
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv.trim()) throw httpError(400, 'Body "csv" mancante');

  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Salta header se assomiglia a una intestazione
  let startIdx = 0;
  if (lines.length > 0) {
    const first = lines[0].toLowerCase().replace(/^"|"$/g, '');
    if (['dotazione', 'dotazioni', 'nome', 'name', 'attrezzatura'].includes(first)) {
      startIdx = 1;
    }
  }

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i];
    const name = raw.replace(/^"|"$/g, '').trim();
    if (!name) {
      errors.push({ row: i + 1, message: 'Riga vuota' });
      continue;
    }
    try {
      const existing = await EquipmentTemplate.findOne({ where: { name } });
      if (existing) {
        skipped += 1;
      } else {
        await EquipmentTemplate.create({ name });
        created += 1;
      }
    } catch (err) {
      errors.push({ row: i + 1, message: err.message || 'Errore' });
    }
  }

  res.json({
    result: {
      rowsTotal: lines.length - startIdx,
      created,
      skipped,
      errors,
    },
  });
});

router.post(
  '/equipment-templates',
  authenticate,
  requireRole('admin'),
  [body('name').notEmpty().trim()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) throw httpError(400, 'Validazione fallita', { details: errs.array() });
    try {
      const tpl = await EquipmentTemplate.create({
        name: req.body.name.trim(),
        type: req.body.type || 'altro',
      });
      res.status(201).json({ template: tpl });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        throw httpError(409, 'Dotazione già esistente');
      }
      res.status(500).json({ error: 'Errore creazione dotazione' });
    }
  },
);

router.put('/equipment-templates/:id', authenticate, requireRole('admin'), async (req, res) => {
  const tpl = await EquipmentTemplate.findByPk(req.params.id);
  if (!tpl) throw httpError(404, 'Dotazione non trovata');
  await tpl.update({
    name: typeof req.body.name === 'string' ? req.body.name.trim() : tpl.name,
    type: req.body.type || tpl.type,
  });
  res.json({ template: tpl });
});

router.delete('/equipment-templates/:id', authenticate, requireRole('admin'), async (req, res) => {
  const tpl = await EquipmentTemplate.findByPk(req.params.id);
  if (!tpl) throw httpError(404, 'Dotazione non trovata');
  await tpl.destroy();
  res.json({ message: 'Dotazione eliminata' });
});

module.exports = router;
