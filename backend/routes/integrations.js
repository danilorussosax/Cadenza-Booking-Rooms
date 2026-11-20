'use strict';

const express = require('express');
const multer = require('multer');
const { Op } = require('sequelize');

const { User, IntegrationSyncRun } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const csvImporter = require('../services/integrations/isidata/csvImporter');
const importWorkflow = require('../services/integrations/importWorkflow');
const { domainError } = require('../lib/domainError');
const { parseLimit } = require('../lib/pagination');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: csvImporter.MAX_BYTES },
  fileFilter(req, file, cb) {
    const okMime = /(spreadsheetml|excel|csv|text\/plain|octet-stream)/i.test(file.mimetype || '');
    const okExt = /\.(xlsx|xls|csv|tsv|txt)$/i.test(file.originalname || '');
    if (!okMime && !okExt) {
      return cb(new Error('Tipo file non supportato (atteso .xlsx o .csv)'));
    }
    cb(null, true);
  },
});

// =====================================================
// Adapter HTTP sottili sul servizio importWorkflow (parametrici sul `source`:
// Isidata, ESSE3 e futuri provider). Logica di import, token/hash e
// transazione vivono nel servizio; qui solo parsing richiesta e risposta.
// =====================================================
function makePreviewHandler(source) {
  return async (req, res, next) => {
    try {
      const body = await importWorkflow.preview(
        source,
        {
          buffer: req.file?.buffer,
          originalName: req.file?.originalname,
          mimetype: req.file?.mimetype,
          mappingOverrides: req.body?.mappingOverrides,
        },
        req.user,
      );
      res.json(body);
    } catch (err) {
      if (err && /multer/i.test(err.name || '')) {
        return next(domainError('UPLOAD_FAILED', err.message));
      }
      next(err);
    }
  };
}

function makeApplyHandler(source) {
  return async (req, res, next) => {
    try {
      const body = await importWorkflow.apply(source, req.body || {}, req.user);
      res.status(201).json(body);
    } catch (err) {
      next(err);
    }
  };
}

// Registrazione delle due route per ciascun profilo (Isidata + ESSE3 + future).
// Lo stesso handler factory copre tutti i source: differenze (externalSource,
// provider, etichette log) vengono iniettate via closure.
router.post(
  '/isidata-csv/preview',
  authenticate,
  requireRole('admin'),
  upload.single('file'),
  makePreviewHandler('isidata'),
);
router.post('/isidata-csv/apply', authenticate, requireRole('admin'), makeApplyHandler('isidata'));
router.post(
  '/esse3-csv/preview',
  authenticate,
  requireRole('admin'),
  upload.single('file'),
  makePreviewHandler('esse3'),
);
router.post('/esse3-csv/apply', authenticate, requireRole('admin'), makeApplyHandler('esse3'));

// =====================================================
// GET /api/admin/integrations/runs?provider=isidata&limit=50
// =====================================================
router.get('/runs', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.provider) {
      const ALLOWED_PROVIDERS = ['isidata', 'esse3'];
      if (!ALLOWED_PROVIDERS.includes(String(req.query.provider))) {
        throw domainError('VALIDATION_FAILED', 'provider non valido');
      }
      where.provider = String(req.query.provider);
    }
    if (req.query.configId) where.configId = Number(req.query.configId);
    const limit = parseLimit(req.query.limit, { def: 50, max: 200 });
    const runs = await IntegrationSyncRun.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      include: [{ model: User, as: 'actor', attributes: ['id', 'firstName', 'lastName', 'email'] }],
    });
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// Helper: estrae l'array di matricole da una sezione del diffSnapshot
// (toCreate / toUpdate / toDeactivate). Lo snapshot è "leggero" (vedi
// route /apply): può contenere record con shape diverse a seconda della
// versione di Cadenza che l'ha scritta. Strategia robusta:
//   1. cerca `record.matricola`;
//   2. fallback `record.externalId`;
//   3. per toUpdate guarda anche dentro `record.external?.matricola/externalId`;
//   4. filtra null/undefined/duplicati.
//
// Restituisce un Set (per intersection/difference) — il caller fa Array.from.
// =====================================================
function extractMatricoleSet(records) {
  const out = new Set();
  if (!Array.isArray(records)) return out;
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    const candidates = [
      r.matricola,
      r.externalId,
      r.external?.matricola,
      r.external?.externalId,
      r.existing?.matricola,
      r.existing?.externalId,
    ];
    for (const c of candidates) {
      if (c == null) continue;
      const s = String(c).trim();
      if (s) {
        out.add(s);
        break; // primo non-null vince per record
      }
    }
  }
  return out;
}

// Lo snapshot legacy ha la chiave `toOrphan` (vedi /apply: usa `toOrphan`),
// non `toDeactivate`. Accettiamo entrambe le forme per resilienza.
function getDeactivateSection(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  return snapshot.toDeactivate ?? snapshot.toOrphan ?? [];
}

// =====================================================
// GET /api/admin/integrations/runs/:id/compare-previous
// Confronta il run corrente con il precedente run "success" dello stesso
// provider, evidenziando matricole "veramente nuove" rispetto all'apply
// passato — utile per audit di sorpassi/rientri.
// =====================================================
router.get(
  '/runs/:id/compare-previous',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw domainError('VALIDATION_FAILED', 'id non valido');
      }
      const current = await IntegrationSyncRun.findByPk(id);
      if (!current) {
        throw domainError('NOT_FOUND', 'Run non trovato', { status: 404 });
      }
      // Cerca il run precedente "success" dello stesso provider con id < current.id.
      // Ordinamento per startedAt DESC: il run più recente prima del corrente.
      const previous = await IntegrationSyncRun.findOne({
        where: {
          provider: current.provider,
          status: 'success',
          id: { [Op.lt]: current.id },
        },
        order: [['startedAt', 'DESC']],
      });

      if (!previous) {
        return res.json({
          previous: null,
          current: serializeRunSummary(current),
          hasPrevious: false,
          changes: null,
        });
      }

      const currentSnap = current.diffSnapshot || {};
      const previousSnap = previous.diffSnapshot || {};

      const currentCreate = extractMatricoleSet(currentSnap.toCreate);
      const previousCreate = extractMatricoleSet(previousSnap.toCreate);
      const currentUpdate = extractMatricoleSet(currentSnap.toUpdate);
      const previousUpdate = extractMatricoleSet(previousSnap.toUpdate);
      const currentDeact = extractMatricoleSet(getDeactivateSection(currentSnap));
      const previousDeact = extractMatricoleSet(getDeactivateSection(previousSnap));

      // Set operations: helper inline per leggibilità.
      const diffSet = (a, b) => Array.from(a).filter((x) => !b.has(x));
      const intersect = (a, b) => Array.from(a).filter((x) => b.has(x));
      const unionFromTwo = (a, b) => {
        const u = new Set(a);
        for (const x of b) u.add(x);
        return u;
      };

      const newlyCreatedMatricole = diffSet(currentCreate, previousCreate);
      const newlyDeactivatedMatricole = diffSet(currentDeact, previousDeact);
      const repeatUpdatesMatricole = intersect(currentUpdate, previousUpdate);
      // Recovered: in previous era nella deactivate-list, ora è in toCreate o
      // toUpdate del run corrente (l'utente è tornato).
      const currentCreateOrUpdate = unionFromTwo(currentCreate, currentUpdate);
      const recoveredMatricole = Array.from(previousDeact).filter((x) =>
        currentCreateOrUpdate.has(x),
      );

      res.json({
        previous: serializeRunSummary(previous),
        current: serializeRunSummary(current),
        hasPrevious: true,
        changes: {
          delta: {
            create: (current.created ?? 0) - (previous.created ?? 0),
            update: (current.updated ?? 0) - (previous.updated ?? 0),
            deactivate: (current.orphaned ?? 0) - (previous.orphaned ?? 0),
          },
          newlyCreatedMatricole,
          newlyDeactivatedMatricole,
          repeatUpdatesMatricole,
          recoveredMatricole,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// Proiezione compatta per la response di compare-previous.
function serializeRunSummary(run) {
  return {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    createdCount: run.created ?? 0,
    updatedCount: run.updated ?? 0,
    deactivatedCount: run.orphaned ?? 0,
  };
}

// Esposto come property non-enumerable per non interferire con eventuali
// itera-over su `module.exports`. Usato da `services/retentionScheduler.js`
// per chiamare la pulizia tmp dentro il tick giornaliero.
module.exports = router;
module.exports.cleanupExpiredTmpFiles = importWorkflow.cleanupExpiredTmpFiles;
