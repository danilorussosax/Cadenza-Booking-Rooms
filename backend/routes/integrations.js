'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Op, Transaction } = require('sequelize');

const {
  sequelize,
  User,
  Course,
  IntegrationConfig,
  IntegrationSyncRun,
  Institute,
} = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { logger } = require('../lib/logger');
const csvImporter = require('../services/integrations/isidata/csvImporter');
const { buildHeaderMap, applyMapping } = require('../services/integrations/isidata/fieldMapping');
const { computeDiff } = require('../services/integrations/diffEngine');

const router = express.Router();

// =====================================================
// Multer storage temporaneo: filesystem in os.tmpdir().
// Il file resta su disco tra preview e apply (TTL 10 minuti) così l'apply
// può ricomputare il diff sullo stesso payload e validare l'hash anti-TOCTOU.
// =====================================================
const TMP_DIR = path.join(os.tmpdir(), 'aulabook-imports');
const TMP_TTL_MS = 10 * 60 * 1000; // 10 minuti

function ensureTmpDir() {
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true, mode: 0o700 });
  } catch {
    /* noop */
  }
}

ensureTmpDir();

// Cleanup periodico dei file scaduti (best-effort, non bloccante).
function cleanupExpiredTmpFiles() {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(TMP_DIR)) {
      const full = path.join(TMP_DIR, name);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > TMP_TTL_MS * 2) fs.unlinkSync(full);
      } catch {
        /* noop */
      }
    }
  } catch {
    /* noop */
  }
}
setInterval(cleanupExpiredTmpFiles, 5 * 60 * 1000).unref?.();

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
// Helper: salva il file temporaneo per l'admin corrente e produce l'hash
// SHA-256 del contenuto. L'hash viene mostrato all'admin nella preview e
// rispedito dal client all'apply: se il file è stato sostituito (TOCTOU),
// il backend rifiuta.
// =====================================================
function persistTempFile(adminId, buffer, originalName) {
  ensureTmpDir();
  const id = crypto.randomBytes(8).toString('hex');
  const safeExt =
    path
      .extname(originalName || '')
      .replace(/[^.a-z0-9]/gi, '')
      .slice(0, 8) || '.bin';
  const filename = `${adminId}-${Date.now()}-${id}${safeExt}`;
  const full = path.join(TMP_DIR, filename);
  fs.writeFileSync(full, buffer, { mode: 0o600 });
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return { token: filename, hash };
}

function readTempFile(token) {
  const full = path.join(TMP_DIR, path.basename(token));
  if (!full.startsWith(TMP_DIR)) return null; // path traversal guard
  try {
    const st = fs.statSync(full);
    if (Date.now() - st.mtimeMs > TMP_TTL_MS) {
      // Scaduto: pulizia best-effort.
      try {
        fs.unlinkSync(full);
      } catch {
        /* noop */
      }
      return null;
    }
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}

// =====================================================
// Resolver corso: dato un courseCode/courseName, trova o crea il Course
// associato. Best-effort: niente reject se i dati sono ambigui — l'admin
// potrà rifinire dopo.
// =====================================================
async function resolveCourse({ code, name }, transaction) {
  if (!code && !name) return null;
  if (code) {
    const found = await Course.findOne({ where: { code }, transaction });
    if (found) return found;
  }
  if (name) {
    const found = await Course.findOne({ where: { name }, transaction });
    if (found) return found;
  }
  // Crea on-demand: code obbligatorio nel model, fallback al name slugificato.
  const slug = (code || name).toString().trim().slice(0, 32);
  return Course.create(
    {
      code: code || slug,
      name: name || code,
      levels: [],
      isActive: true,
    },
    { transaction },
  );
}

// =====================================================
// Costruisce gli ExternalUser dal buffer del file: parse + mapping.
// Restituisce {externals, headers, warnings} senza toccare il DB.
// =====================================================
function buildExternals(buffer, filename, mimetype, mappingOverrides) {
  const { rows, headers, warnings } = csvImporter.parse(buffer, filename, mimetype);
  const headerMap = buildHeaderMap(headers, mappingOverrides);

  const externals = [];
  const allWarnings = [...warnings];
  rows.forEach((row, idx) => {
    const r = applyMapping(row, headerMap);
    if (r.ok) externals.push(r.user);
    else allWarnings.push({ row: idx + 2 /* header è riga 1 */, msg: r.msg });
  });
  return { externals, headers, headerMap, warnings: allWarnings };
}

// =====================================================
// POST /api/admin/integrations/isidata-csv/preview
// multipart/form-data: 'file', body { instituteId?, mappingOverrides? }
// Risponde con il diff calcolato + token+hash da rimandare in /apply.
// NON modifica DB.
// =====================================================
router.post(
  '/isidata-csv/preview',
  authenticate,
  requireRole('admin'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: 'File mancante (campo "file")', code: 'FILE_REQUIRED' });
      }
      let mappingOverrides = null;
      if (req.body.mappingOverrides) {
        try {
          mappingOverrides =
            typeof req.body.mappingOverrides === 'string'
              ? JSON.parse(req.body.mappingOverrides)
              : req.body.mappingOverrides;
        } catch {
          return res
            .status(400)
            .json({ error: 'mappingOverrides JSON non valido', code: 'VALIDATION_FAILED' });
        }
      }

      // Parse + mapping → ExternalUser[]
      let parsed;
      try {
        parsed = buildExternals(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          mappingOverrides,
        );
      } catch (err) {
        if (err.code === 'FILE_TOO_LARGE' || err.code === 'PARSE_FAILED') {
          return res.status(400).json({ error: err.message, code: err.code });
        }
        throw err;
      }
      const { externals, headers, headerMap, warnings } = parsed;

      // Carica gli utenti locali interessati al matching: tutti quelli con
      // externalSource='isidata', + quelli con matricola o email che potrebbe
      // collidere con externalUsers (per eventuale "promozione" da utente
      // creato manualmente a utente legato all'import).
      const matricoleSet = new Set(externals.map((e) => e.matricola).filter(Boolean));
      const emailsSet = new Set(externals.map((e) => e.email).filter(Boolean));
      const externalIdsSet = new Set(externals.map((e) => e.externalId).filter(Boolean));

      const orFilters = [{ externalSource: 'isidata' }];
      if (matricoleSet.size) orFilters.push({ matricola: { [Op.in]: Array.from(matricoleSet) } });
      if (emailsSet.size) orFilters.push({ email: { [Op.in]: Array.from(emailsSet) } });
      if (externalIdsSet.size)
        orFilters.push({
          externalSource: 'isidata',
          externalId: { [Op.in]: Array.from(externalIdsSet) },
        });

      const localUsers = await User.findAll({
        where: { [Op.or]: orFilters },
        // Mai matchare admin (filtrato a valle nel diff engine), ma nel batch
        // di lookup li includiamo per non confondere fields collidenti.
        paranoid: true,
      });

      const diff = computeDiff(externals, localUsers, 'matricola', 'isidata');

      // Persistenza temporanea per l'apply.
      const { token, hash } = persistTempFile(req.user.id, req.file.buffer, req.file.originalname);

      logger?.info?.(
        {
          actorId: req.user.id,
          rows: externals.length,
          toCreate: diff.toCreate.length,
          toUpdate: diff.toUpdate.length,
          toOrphan: diff.toOrphan.length,
          warnings: warnings.length,
        },
        '[integrations.isidata] preview generato',
      );

      // Serializza il diff per la UI: gli oggetti Sequelize devono essere
      // ridotti a JSON puro (response immutabile).
      res.json({
        token,
        hash,
        headers,
        headerMap,
        summary: {
          fetched: externals.length,
          warnings,
          toCreate: diff.toCreate.length,
          toUpdate: diff.toUpdate.length,
          toOrphan: diff.toOrphan.length,
        },
        diff: {
          toCreate: diff.toCreate,
          toUpdate: diff.toUpdate.map(({ local, external, fieldsChanged, linkChanged }) => ({
            local: {
              id: local.id,
              email: local.email,
              firstName: local.firstName,
              lastName: local.lastName,
              role: local.role,
              matricola: local.matricola,
              externalSource: local.externalSource,
              externalId: local.externalId,
              isActive: local.isActive,
              status: local.status,
            },
            external,
            fieldsChanged,
            linkChanged,
          })),
          toOrphan: diff.toOrphan.map((u) => ({
            id: u.id,
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
            role: u.role,
            matricola: u.matricola,
            isActive: u.isActive,
          })),
        },
      });
    } catch (err) {
      if (err && /multer/i.test(err.name || '')) {
        return res.status(400).json({ error: err.message, code: 'UPLOAD_FAILED' });
      }
      next(err);
    }
  },
);

// =====================================================
// POST /api/admin/integrations/isidata-csv/apply
// body: { token, confirmedDiffHash, mappingOverrides? }
// Riapplica il file persistito, ricomputa il diff, verifica hash
// (anti-TOCTOU: se l'admin ha caricato un file diverso fra preview e apply,
// rifiutiamo), poi applica in transazione SERIALIZABLE.
// =====================================================
router.post('/isidata-csv/apply', authenticate, requireRole('admin'), async (req, res, next) => {
  const { token, confirmedDiffHash, mappingOverrides } = req.body || {};
  if (!token || !confirmedDiffHash) {
    return res
      .status(400)
      .json({ error: 'token e confirmedDiffHash sono obbligatori', code: 'VALIDATION_FAILED' });
  }
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(token)) {
    return res.status(400).json({ error: 'token non valido', code: 'TOKEN_INVALID' });
  }
  // Solo l'admin che ha caricato può applicare: il prefisso del token
  // contiene il suo id.
  const tokenAdminPrefix = String(token).split('-')[0];
  if (String(req.user.id) !== tokenAdminPrefix) {
    return res
      .status(403)
      .json({ error: "token non appartenente all'admin corrente", code: 'TOKEN_FOREIGN' });
  }

  const buffer = readTempFile(token);
  if (!buffer) {
    return res.status(410).json({
      error: 'File scaduto o non trovato — ricarica e riavvia la procedura',
      code: 'TOKEN_EXPIRED',
    });
  }
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (fileHash !== confirmedDiffHash) {
    return res
      .status(409)
      .json({ error: 'Hash file non coincide — ricarica la preview', code: 'HASH_MISMATCH' });
  }

  let parsed;
  try {
    parsed = buildExternals(buffer, token, '', mappingOverrides ?? null);
  } catch (err) {
    return res.status(400).json({ error: err.message, code: err.code || 'PARSE_FAILED' });
  }
  const { externals, warnings } = parsed;

  // Carica config esistente (best-effort: può non esistere ancora).
  const config = await IntegrationConfig.findOne({
    where: { provider: 'isidata' },
    order: [['id', 'ASC']],
  });

  // Crea il run record subito in stato 'in_progress' così è visibile in storia
  // anche se la transazione fallisce.
  const run = await IntegrationSyncRun.create({
    configId: config?.id ?? null,
    instituteId: config?.instituteId ?? null,
    provider: 'isidata',
    actorId: req.user.id,
    startedAt: new Date(),
    triggeredBy: 'manual',
    status: 'in_progress',
    fetched: externals.length,
  });

  try {
    // Postgres: SERIALIZABLE; SQLite/MySQL: best-effort (SQLite non ha
    // SERIALIZABLE vero, ma READ_COMMITTED qui è acceptable perché il
    // file è già caricato e il diff è ricomputato dentro lo stesso block).
    const isPostgres = sequelize.getDialect() === 'postgres';
    const txOpts = isPostgres ? { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE } : {};

    const result = await sequelize.transaction(txOpts, async (t) => {
      // Riprendi il diff DENTRO la transazione (lock-friendly).
      const matricoleSet = new Set(externals.map((e) => e.matricola).filter(Boolean));
      const emailsSet = new Set(externals.map((e) => e.email).filter(Boolean));
      const externalIdsSet = new Set(externals.map((e) => e.externalId).filter(Boolean));

      const orFilters = [{ externalSource: 'isidata' }];
      if (matricoleSet.size) orFilters.push({ matricola: { [Op.in]: Array.from(matricoleSet) } });
      if (emailsSet.size) orFilters.push({ email: { [Op.in]: Array.from(emailsSet) } });
      if (externalIdsSet.size)
        orFilters.push({
          externalSource: 'isidata',
          externalId: { [Op.in]: Array.from(externalIdsSet) },
        });
      const localUsers = await User.findAll({
        where: { [Op.or]: orFilters },
        transaction: t,
      });

      const diff = computeDiff(externals, localUsers, 'matricola', 'isidata');

      let created = 0,
        updated = 0,
        orphaned = 0,
        errors = 0;
      const errorPayload = [];
      const now = new Date();

      // CREATE
      for (const ext of diff.toCreate) {
        try {
          const course = await resolveCourse({ code: ext.courseCode, name: ext.courseName }, t);
          // Email può essere null per studenti minorenni: in quel caso
          // generiamo un placeholder unique-safe (admin la modificherà a
          // mano quando l'utente attiverà il profilo).
          const email =
            ext.email ||
            `import-${ext.externalId || crypto.randomBytes(4).toString('hex')}@imported.local`;
          await User.create(
            {
              email,
              firstName: ext.firstName,
              lastName: ext.lastName,
              role: ext.role,
              matricola: ext.matricola,
              courseId: course?.id ?? null,
              status: 'pending', // l'admin li approva esplicitamente dopo l'import
              isActive: ext.status === 'active',
              externalSource: 'isidata',
              externalId: ext.externalId ?? null,
              lastExternalSyncAt: now,
            },
            { transaction: t },
          );
          created++;
        } catch (err) {
          errors++;
          errorPayload.push({ kind: 'create', externalId: ext.externalId, msg: err.message });
          logger?.warn?.({ ext, err: err.message }, '[integrations.isidata] create failed');
        }
      }

      // UPDATE
      for (const item of diff.toUpdate) {
        try {
          const u = item.local;
          const ext = item.external;
          const updates = {
            externalSource: 'isidata',
            externalId: ext.externalId ?? u.externalId,
            lastExternalSyncAt: now,
          };
          // Applica solo i campi indicati come `fieldsChanged` per evitare
          // di sovrascrivere mod manuali dell'admin in altri campi.
          for (const f of item.fieldsChanged) {
            if (f === 'isActive') {
              updates.isActive = ext.status === 'active';
            } else {
              updates[f] = ext[f] ?? u[f];
            }
          }
          // Se il corso è cambiato, risolvi e linka.
          if (ext.courseCode || ext.courseName) {
            const course = await resolveCourse({ code: ext.courseCode, name: ext.courseName }, t);
            if (course && course.id !== u.courseId) updates.courseId = course.id;
          }
          await u.update(updates, { transaction: t });
          updated++;
        } catch (err) {
          errors++;
          errorPayload.push({ kind: 'update', userId: item.local.id, msg: err.message });
          logger?.warn?.(
            { userId: item.local.id, err: err.message },
            '[integrations.isidata] update failed',
          );
        }
      }

      // ORPHAN: NEVER delete. Soft-disable + nota.
      for (const u of diff.toOrphan) {
        try {
          await u.update(
            {
              isActive: false,
              externalStatusNote: `Non più presente nell'export Isidata del ${now.toISOString().slice(0, 10)}`,
              lastExternalSyncAt: now,
            },
            { transaction: t },
          );
          orphaned++;
        } catch (err) {
          errors++;
          errorPayload.push({ kind: 'orphan', userId: u.id, msg: err.message });
        }
      }

      return { created, updated, orphaned, errors, errorPayload, diff };
    });

    const { created, updated, orphaned, errors, errorPayload, diff } = result;
    const finalStatus =
      errors === 0 ? 'success' : created + updated + orphaned > 0 ? 'partial' : 'failed';

    // Snapshot diff "leggera" per audit (no `raw` per non gonfiare il DB).
    const diffSnapshot = {
      toCreate: diff.toCreate.map((e) => ({
        externalId: e.externalId,
        email: e.email,
        role: e.role,
      })),
      toUpdate: diff.toUpdate.map((u) => ({
        userId: u.local.id,
        externalId: u.external.externalId,
        fieldsChanged: u.fieldsChanged,
      })),
      toOrphan: diff.toOrphan.map((u) => ({ userId: u.id })),
      warnings,
    };
    await run.update({
      finishedAt: new Date(),
      status: finalStatus,
      created,
      updated,
      skipped: 0,
      orphaned,
      errors,
      errorPayload: errorPayload.length ? errorPayload : null,
      diffSnapshot,
    });

    // Aggiorna config "last run" denormalizzato (se config esiste).
    if (config) {
      await config.update({
        lastRunAt: new Date(),
        lastRunStatus: finalStatus,
        lastRunSummary: { fetched: externals.length, created, updated, orphaned, errors },
        lastErrorMessage: errors > 0 ? `${errors} errori; vedi run #${run.id}` : null,
      });
    }

    // Cleanup file temp dopo apply riuscito (best-effort).
    try {
      fs.unlinkSync(path.join(TMP_DIR, path.basename(token)));
    } catch {
      /* noop */
    }

    logger?.info?.(
      {
        runId: run.id,
        actorId: req.user.id,
        created,
        updated,
        orphaned,
        errors,
        status: finalStatus,
      },
      '[integrations.isidata] apply completato',
    );

    res.status(201).json({
      runId: run.id,
      status: finalStatus,
      summary: { fetched: externals.length, created, updated, orphaned, errors, warnings },
    });
  } catch (err) {
    // Best-effort: marca il run come failed e propaga.
    try {
      await run.update({
        finishedAt: new Date(),
        status: 'failed',
        errorPayload: [
          { kind: 'fatal', msg: err.message, stack: err.stack?.split('\n').slice(0, 5).join('\n') },
        ],
      });
    } catch {
      /* noop */
    }
    logger?.error?.({ err }, '[integrations.isidata] apply fallito');
    next(err);
  }
});

// =====================================================
// GET /api/admin/integrations/runs?provider=isidata&limit=50
// =====================================================
router.get('/runs', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.provider) where.provider = String(req.query.provider);
    if (req.query.configId) where.configId = Number(req.query.configId);
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
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

module.exports = router;
