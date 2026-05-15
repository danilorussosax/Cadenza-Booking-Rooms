'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { sequelize, Course, User } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// =====================================================
// CSV parser: auto-detect delimiter, expects columns "SAD" + "Denominazione"
// (extra columns ignored). Matching is case-insensitive on header.
// =====================================================
function parseCoursesCsv(csv) {
  // Strip UTF-8 BOM se presente (Excel salva CSV con BOM by default).
  if (csv.charCodeAt(0) === 0xfeff) csv = csv.slice(1);
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headerLine = lines[0];
  const delim = [';', ',', '\t']
    .map((d) => ({ d, n: headerLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  // \uFEFF = BOM, comune sui CSV Windows/Excel: lo strippiamo dal primo
  // header altrimenti il match `sad === 'sad'` fallisce silenziosamente.
  const headers = headerLine.split(delim).map((h) =>
    h
      .trim()
      .replace(/^\uFEFF/, '')
      .toLowerCase(),
  );
  const sadIdx = headers.findIndex((h) => h === 'sad' || h === 'codice' || h === 'code');
  const nameIdx = headers.findIndex((h) => h === 'denominazione' || h === 'nome' || h === 'name');
  if (sadIdx === -1 || nameIdx === -1) {
    return {
      headers,
      rows: [],
      error: 'Colonne richieste: SAD, Denominazione',
    };
  }

  const rows = lines.slice(1).map((l, idx) => {
    const cols = l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
    return {
      lineNumber: idx + 2,
      sad: (cols[sadIdx] || '').trim(),
      denominazione: (cols[nameIdx] || '').trim(),
    };
  });

  return { headers, rows };
}

// Lista corsi (pubblica al login - serve per registrazione)
router.get('/', async (req, res) => {
  const onlyActive = req.query.active !== 'false';
  const where = onlyActive ? { isActive: true } : {};
  const courses = await Course.findAll({ where, order: [['code', 'ASC']] });
  res.json({ courses });
});

// =====================================================
// Export CSV (admin) — round-trip safe con POST /import: SAD + Denominazione.
// =====================================================
const { stringify: csvStringify } = require('csv-stringify/sync');
router.get('/export.csv', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const courses = await Course.findAll({ order: [['code', 'ASC']] });
    const rows = [
      ['SAD', 'Denominazione', 'Attivo'],
      ...courses.map((c) => [c.code, c.name, c.isActive ? 'si' : 'no']),
    ];
    const csv = csvStringify(rows, { delimiter: ';', quoted_string: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="corsi-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send('\uFEFF' + csv);
  } catch (err) {
    next(err);
  }
});

// =====================================================
// Import CSV (admin)
// Body: { csv: string }
// CSV: due colonne SAD, Denominazione (separator auto: , ; tab).
// Idempotente: upsert per code (SAD).
// =====================================================
router.post('/import', authenticate, requireRole('admin'), async (req, res) => {
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv.trim()) return res.status(400).json({ error: 'Body "csv" mancante' });

  const parsed = parseCoursesCsv(csv);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let restored = 0;
  const errors = [];

  // Helper: estrae messaggio significativo da errori Sequelize.
  const formatSeqError = (err) => {
    if (
      err?.name === 'SequelizeValidationError' &&
      Array.isArray(err.errors) &&
      err.errors.length
    ) {
      return err.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    }
    if (err?.name === 'SequelizeUniqueConstraintError') {
      const fields = Array.isArray(err.errors)
        ? err.errors.map((e) => e.path).join(', ')
        : Object.keys(err.fields || {}).join(', ');
      return `Vincolo unique violato (${fields || '?'}). Probabile duplicato di un record soft-deleted.`;
    }
    return err?.message || 'Errore';
  };

  for (const row of parsed.rows) {
    if (!row.sad || !row.denominazione) {
      errors.push({ row: row.lineNumber, message: 'SAD o Denominazione mancante' });
      continue;
    }
    // Sanity: il modello limita code a STRING(20), name a STRING(250). Tronca
    // (non è bello ma evita un fail muto su CSV con stringhe lunghe).
    const code = String(row.sad).slice(0, 20);
    const name = String(row.denominazione).slice(0, 250);
    try {
      // paranoid:false → trova anche corsi soft-deleted con stesso code.
      const existing = await Course.findOne({ where: { code }, paranoid: false });
      if (existing) {
        if (existing.deletedAt) {
          await existing.restore();
          restored += 1;
          await existing.update({ name, isActive: true });
        } else {
          // Verifica se i dati sono effettivamente cambiati: se name e
          // isActive sono già quelli del CSV, è un no-op informativo.
          const isChanged = existing.name !== name || existing.isActive !== true;
          if (isChanged) {
            await existing.update({ name, isActive: true });
            updated += 1;
          } else {
            unchanged += 1;
          }
        }
      } else {
        await Course.create({ code, name, isActive: true, levels: [] });
        created += 1;
      }
    } catch (err) {
      errors.push({ row: row.lineNumber, message: formatSeqError(err) });
    }
  }

  res.json({
    result: {
      rowsTotal: parsed.rows.length,
      created,
      updated,
      unchanged,
      restored,
      errors,
    },
  });
});

// =====================================================
// Bulk delete (admin)
// Body: { ids: number[] }
// In transazione: prima svincoliamo gli utenti (courseId=NULL), poi rimuoviamo i corsi.
// =====================================================
router.post('/bulk-delete', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
    const result = await sequelize.transaction(async (t) => {
      const [detachedUsers] = await User.update(
        { courseId: null },
        { where: { courseId: { [Op.in]: ids } }, transaction: t },
      );
      const deleted = await Course.destroy({
        where: { id: { [Op.in]: ids } },
        transaction: t,
      });
      return { deleted, detachedUsers };
    });
    res.json(result);
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({
        error: 'Impossibile eliminare alcuni corsi: vincoli di integrità.',
      });
    }
    next(err);
  }
});

// Dettaglio singolo corso
router.get('/:id', async (req, res) => {
  const course = await Course.findByPk(req.params.id);
  if (!course) return res.status(404).json({ error: 'Corso non trovato' });
  res.json({ course });
});

// Creazione (solo admin)
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('code').notEmpty().trim(),
    body('name').notEmpty().trim(),
    body('levels').optional().isArray(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });
    try {
      const course = await Course.create(req.body);
      res.status(201).json({ course });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Codice corso già esistente' });
      }
      res.status(500).json({ error: 'Errore creazione corso' });
    }
  },
);

// Modifica
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const course = await Course.findByPk(req.params.id);
  if (!course) return res.status(404).json({ error: 'Corso non trovato' });
  await course.update(req.body);
  res.json({ course });
});

// Eliminazione (cascade applicativo: svincola gli utenti)
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: 'Corso non trovato' });
    const result = await sequelize.transaction(async (t) => {
      const [detachedUsers] = await User.update(
        { courseId: null },
        { where: { courseId: course.id }, transaction: t },
      );
      await course.destroy({ transaction: t });
      return detachedUsers;
    });
    res.json({ message: 'Corso eliminato', detachedUsers: result });
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({
        error: 'Impossibile eliminare il corso: vincoli di integrità.',
      });
    }
    next(err);
  }
});

module.exports = router;
