'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { sequelize, Instrument, InstrumentLoan, User } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// =========================================================
// Upload foto strumento (multer in memoria + sharp resize 16:9 1200x675 webp)
// Stessa pipeline di /api/structure/rooms/:id/photo per coerenza visiva.
// =========================================================
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_PHOTO_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
const PHOTO_W = 1200;
const PHOTO_H = 675;
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_PHOTO_MIME.includes(file.mimetype)) {
      return cb(new Error('Formato non supportato (usa PNG, JPG, WEBP o HEIC)'));
    }
    cb(null, true);
  },
});

function tryDeleteOldPhoto(photoUrl) {
  if (!photoUrl || !photoUrl.startsWith('/storage/')) return;
  const file = path.basename(photoUrl);
  fs.unlink(path.join(UPLOADS_DIR, file), () => {});
}

function tryDeletePhotos(rows) {
  if (!rows?.length) return;
  for (const r of rows) tryDeleteOldPhoto(r.photoUrl);
}

// =========================================================
// Helpers di stato prestito
// =========================================================
function isOverdue(loan, now = dayjs()) {
  return loan.status === 'active' && now.isAfter(dayjs(loan.toDate).endOf('day'));
}

// Status "calcolato" da restituire al client: se lo stato in DB è "active" ma
// la data è passata, lo serializziamo come "overdue" (anche se lo scheduler
// non ha ancora marcato in modo persistente).
function annotateStatus(loan) {
  const obj = loan.toJSON ? loan.toJSON() : loan;
  if (obj.status === 'active' && isOverdue(loan)) obj.status = 'overdue';
  return obj;
}

const userPublicAttributes = ['id', 'firstName', 'lastName', 'email', 'matricola', 'role'];

// =========================================================
// INVENTARIO (lista, dettaglio, CRUD admin, foto)
// =========================================================

// GET /api/instruments — lista (autenticati)
//   Filtri: family, search (q), loanable (true|false)
router.get('/', authenticate, async (req, res) => {
  const where = {};
  if (req.query.family) where.family = req.query.family;
  if (req.query.loanable === 'true') where.isLoanable = true;
  if (req.query.loanable === 'false') where.isLoanable = false;
  if (req.query.q) {
    const q = `%${req.query.q.trim()}%`;
    where[Op.or] = [
      { name: { [Op.like]: q } },
      { code: { [Op.like]: q } },
      { brand: { [Op.like]: q } },
      { model: { [Op.like]: q } },
    ];
  }

  const instruments = await Instrument.findAll({
    where,
    order: [
      ['family', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  // Aggiungo info "in prestito ora" per il client (utile per disabilitare il bottone)
  const ids = instruments.map((i) => i.id);
  let activeByInstrument = new Map();
  if (ids.length) {
    const active = await InstrumentLoan.findAll({
      where: { instrumentId: { [Op.in]: ids }, status: { [Op.in]: ['active', 'requested'] } },
      attributes: ['instrumentId', 'status', 'toDate'],
    });
    activeByInstrument = new Map(active.map((l) => [l.instrumentId, l]));
  }

  // Pre-calcolo dell'abilitazione PER STRUMENTO in base a Instrument.allowedCourseIds.
  // Convenzione: array vuoto = permissivo (chiunque non admin con corso/profilo).
  const userIsAdmin = req.user.role === 'admin';
  const userCourseId = req.user.courseId ?? null;
  const isAllowedFor = (allowedCourseIds) => {
    if (userIsAdmin) return true;
    const allowed = Array.isArray(allowedCourseIds) ? allowedCourseIds : [];
    if (allowed.length === 0) return true; // permissivo di default
    return userCourseId != null && allowed.includes(userCourseId);
  };

  const out = instruments.map((i) => {
    const obj = i.toJSON();
    const active = activeByInstrument.get(i.id);
    obj.currentLoanStatus = active ? active.status : null;
    obj.currentLoanUntil = active ? active.toDate : null;
    // Esposto al client: consente alla card di disabilitare/spiegare il pulsante
    // senza dover tentare la richiesta e gestire un 403. Manteniamo il nome
    // legacy `userAllowedForFamily` per non rompere il frontend esistente,
    // anche se ora il dato è per-instrument.
    obj.userAllowedForFamily = isAllowedFor(i.allowedCourseIds);
    return obj;
  });
  res.json({ instruments: out });
});

// =========================================================
// CSV import / export inventario (admin)
// Registrati PRIMA di /:id per non venire intercettati dalla rotta dinamica.
// =========================================================
const { importInstruments, exportInstruments } = require('../services/instrumentImporter');

// GET /api/instruments/export → text/csv (Excel-compatibile)
router.get('/export', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const csv = await exportInstruments();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="instruments-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// POST /api/instruments/import — body { csv: string } → idempotente
router.post('/import', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    const result = await importInstruments({ csv });
    res.json({ result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: err.message,
        ...(err.code && { code: err.code }),
      });
    }
    next(err);
  }
});

// =====================================================
// Bulk operations admin (registrate PRIMA di /:id per vincere il match).
// =====================================================

// POST /api/instruments/bulk-delete — admin. Body: { ids[] }.
// Cancella anche le foto su disco e i prestiti associati (cascade via paranoid).
router.post('/bulk-delete', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
    const snap = await Instrument.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'photoUrl'],
    });
    const result = await sequelize.transaction(async (t) => {
      const removedLoans = await InstrumentLoan.destroy({
        where: { instrumentId: { [Op.in]: ids } },
        transaction: t,
      });
      const deleted = await Instrument.destroy({
        where: { id: { [Op.in]: ids } },
        transaction: t,
      });
      return { deleted, removedLoans };
    });
    tryDeletePhotos(snap);
    res.json(result);
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({ error: 'Eliminazione bloccata da vincoli di integrità.' });
    }
    next(err);
  }
});

// POST /api/instruments/bulk-toggle-loanable — admin. Body: { ids[], isLoanable: bool }.
router.post('/bulk-toggle-loanable', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
    if (typeof req.body?.isLoanable !== 'boolean') {
      return res.status(400).json({ error: 'isLoanable richiesto', code: 'VALIDATION_FAILED' });
    }
    const [changed] = await Instrument.update(
      { isLoanable: req.body.isLoanable },
      { where: { id: { [Op.in]: ids } } },
    );
    res.json({ changed });
  } catch (err) {
    next(err);
  }
});

// GET /api/instruments/:id — dettaglio + storico prestiti
router.get('/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  const instrument = await Instrument.findByPk(id, {
    include: [
      {
        model: InstrumentLoan,
        as: 'loans',
        include: [{ model: User, as: 'user', attributes: userPublicAttributes }],
        order: [['fromDate', 'DESC']],
        limit: 20,
      },
    ],
  });
  if (!instrument)
    return res.status(404).json({ error: 'Strumento non trovato', code: 'NOT_FOUND' });
  const obj = instrument.toJSON();
  obj.loans = (obj.loans || []).map((l) => annotateStatus(l));
  res.json({ instrument: obj });
});

// POST /api/instruments — crea (admin)
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('name').notEmpty().trim(),
    body('family')
      .optional()
      .isIn([
        'archi',
        'fiati_legni',
        'fiati_ottoni',
        'tastiere',
        'percussioni',
        'corde',
        'voce',
        'elettronica',
        'altro',
      ]),
    body('code').optional({ nullable: true }).trim(),
    body('isLoanable').optional().isBoolean(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res
        .status(400)
        .json({ error: 'Validazione fallita', details: errs.array(), code: 'VALIDATION_FAILED' });
    try {
      if (req.body.code) {
        const existing = await Instrument.findOne({ where: { code: req.body.code } });
        if (existing)
          return res
            .status(409)
            .json({ error: 'Codice strumento già usato', code: 'INSTRUMENT_CODE_DUPLICATE' });
      }
      const instrument = await Instrument.create({
        ...req.body,
        family: req.body.family || 'altro',
      });
      res.status(201).json({ instrument });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res
          .status(409)
          .json({ error: 'Codice strumento già usato', code: 'INSTRUMENT_CODE_DUPLICATE' });
      }
      throw err;
    }
  },
);

// PUT /api/instruments/:id — aggiorna (admin)
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const instrument = await Instrument.findByPk(req.params.id);
  if (!instrument)
    return res.status(404).json({ error: 'Strumento non trovato', code: 'NOT_FOUND' });
  const allowed = [
    'code',
    'name',
    'family',
    'brand',
    'model',
    'serialNumber',
    'condition',
    'isLoanable',
    'allowedCourseIds',
    'notes',
  ];
  const updates = {};
  for (const k of allowed) {
    if (!(k in req.body)) continue;
    if (k === 'allowedCourseIds') {
      // Sanitize: array di interi positivi unici.
      const arr = Array.isArray(req.body[k]) ? req.body[k] : [];
      updates[k] = [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    } else {
      updates[k] = req.body[k];
    }
  }
  try {
    await instrument.update(updates);
    res.json({ instrument });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res
        .status(409)
        .json({ error: 'Codice strumento già usato', code: 'INSTRUMENT_CODE_DUPLICATE' });
    }
    throw err;
  }
});

// DELETE /api/instruments/:id — elimina (admin) — cascade su prestiti
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const instrument = await Instrument.findByPk(req.params.id);
    if (!instrument)
      return res.status(404).json({ error: 'Strumento non trovato', code: 'NOT_FOUND' });
    const photoUrl = instrument.photoUrl;
    await instrument.destroy();
    tryDeleteOldPhoto(photoUrl);
    res.json({ message: 'Strumento eliminato' });
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res
        .status(409)
        .json({ error: 'Eliminazione bloccata da vincoli di integrità.', code: 'FK_CONSTRAINT' });
    }
    next(err);
  }
});

// POST /api/instruments/:id/photo — upload foto (admin) → 1200x675 webp
router.post(
  '/:id/photo',
  authenticate,
  requireRole('admin'),
  photoUpload.single('file'),
  async (req, res, next) => {
    try {
      const instrument = await Instrument.findByPk(req.params.id);
      if (!instrument)
        return res.status(404).json({ error: 'Strumento non trovato', code: 'NOT_FOUND' });
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'Nessun file caricato', code: 'VALIDATION_FAILED' });
      }
      const processed = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: PHOTO_W, height: PHOTO_H, fit: 'cover', position: 'attention' })
        .webp({ quality: 82 })
        .toBuffer();
      const filename = `instrument-${instrument.id}-${Date.now()}.webp`;
      await fs.promises.writeFile(path.join(UPLOADS_DIR, filename), processed);
      tryDeleteOldPhoto(instrument.photoUrl);
      const newUrl = `/storage/${filename}`;
      await instrument.update({ photoUrl: newUrl });
      res.json({ instrument, photoUrl: newUrl });
    } catch (err) {
      if (err && err.message && /sharp|input|unsupported/i.test(err.message)) {
        return res.status(400).json({
          error: 'Immagine non valida o formato non supportato',
          code: 'FILE_FORMAT_UNSUPPORTED',
        });
      }
      next(err);
    }
  },
);

// DELETE /api/instruments/:id/photo
router.delete('/:id/photo', authenticate, requireRole('admin'), async (req, res) => {
  const instrument = await Instrument.findByPk(req.params.id);
  if (!instrument)
    return res.status(404).json({ error: 'Strumento non trovato', code: 'NOT_FOUND' });
  tryDeleteOldPhoto(instrument.photoUrl);
  await instrument.update({ photoUrl: null });
  res.json({ instrument });
});

module.exports = router;
module.exports.utils = { tryDeleteOldPhoto, tryDeletePhotos, annotateStatus, isOverdue };
