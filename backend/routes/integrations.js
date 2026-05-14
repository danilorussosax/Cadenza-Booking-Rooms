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
const {
  buildHeaderMap,
  applyMapping,
  sanitizeOverrides,
  extractEffectiveMapping,
} = require('../services/integrations/isidata/fieldMapping');
const { computeDiff, computeSafetyChecks } = require('../services/integrations/diffEngine');

// Token formato: `${adminId}-${Date.now()}-${hex16}${ext}` con ext `.csv|.xlsx|...`.
// Stringere la regex impedisce che varianti tipo `1-foo.csv` (senza Date e
// senza hex random) passino il filtro pre-readTempFile.
const TOKEN_REGEX = /^\d+-\d+-[a-f0-9]{16}\.[a-z0-9]{1,8}$/i;

const router = express.Router();

// =====================================================
// Multer storage temporaneo: filesystem in os.tmpdir().
// Il file resta su disco tra preview e apply (TTL 10 minuti) così l'apply
// può ricomputare il diff sullo stesso payload e validare l'hash anti-TOCTOU.
// =====================================================
const TMP_DIR = path.join(os.tmpdir(), 'cadenza-imports');
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
// Esposto via module.exports e chiamato dal retentionScheduler ogni 24h
// — no setInterval locale (P1-4: il pattern `setInterval(..., 5min)` con
// `unref?.()` ottimistico tratteneva il process se l'opt chaining falliva
// silenziosamente in alcuni runtime, e duplicava il timer ad ogni
// `require()` del modulo nei test).
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
  // Doppia difesa contro path traversal:
  //   1. `path.basename(token)` strappa qualsiasi separatore (`/`, `..`, etc.)
  //   2. `path.relative` containment check funziona uniformemente su Windows
  //      e POSIX (il check `startsWith(TMP_DIR)` precedente poteva fallire su
  //      Windows quando TMP_DIR usava `/` mixed con `\`, lasciando passare
  //      casi tipo `D:\evil` se TMP_DIR=`D:\evil-prefix\tmp`).
  const safeBase = path.basename(token);
  if (!safeBase || safeBase === '.' || safeBase === '..') return null;
  const tmpResolved = path.resolve(TMP_DIR);
  const full = path.resolve(tmpResolved, safeBase);
  const rel = path.relative(tmpResolved, full);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') return null;
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
// Pre-carica una Map { courseCode → courseId } per la risoluzione
// `User.courseId` durante l'import (Miglioria 3). Una sola query, riusata
// per tutto il batch di externalUsers. Filtra i Course inattivi: non
// vogliamo "linkare" studenti a corsi disattivati.
// =====================================================
async function loadCourseCodeToIdMap(transaction = undefined) {
  const courses = await Course.findAll({
    attributes: ['id', 'code'],
    where: { isActive: true },
    transaction,
  });
  const map = new Map();
  for (const c of courses) {
    if (c.code) map.set(String(c.code).trim(), c.id);
  }
  return map;
}

// =====================================================
// Costruisce gli ExternalUser dal buffer del file: parse + mapping.
// Restituisce {externals, headers, warnings} senza toccare il DB.
// =====================================================
async function buildExternals(buffer, filename, mimetype, mappingOverrides) {
  const { rows, headers, warnings } = await csvImporter.parse(buffer, filename, mimetype);
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
// multipart/form-data: 'file', body { mappingOverrides? }
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
        const raw = req.body.mappingOverrides;
        // Cap dimensione del JSON dell'admin: evita CPU-spike su parse di
        // payload patologici. 4KB > 10× la dimensione di un override realistico.
        if (typeof raw === 'string' && raw.length > 4096) {
          return res
            .status(400)
            .json({ error: 'mappingOverrides troppo grande', code: 'VALIDATION_FAILED' });
        }
        let parsed;
        try {
          parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          return res
            .status(400)
            .json({ error: 'mappingOverrides JSON non valido', code: 'VALIDATION_FAILED' });
        }
        try {
          mappingOverrides = sanitizeOverrides(parsed);
        } catch (err) {
          return res
            .status(400)
            .json({ error: err.message, code: err.code || 'VALIDATION_FAILED' });
        }
      }

      // Parse + mapping → ExternalUser[]
      let parsed;
      try {
        parsed = await buildExternals(
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

      // Map courseCode → courseId per la valorizzazione di `User.courseId`
      // sui record con courseCode noto (Miglioria 3). I codici sconosciuti
      // finiscono in diff.warnings (soft).
      const courseCodeToId = await loadCourseCodeToIdMap();
      const diff = computeDiff(externals, localUsers, 'matricola', 'isidata', { courseCodeToId });

      // Soglie sicurezza (Miglioria 1): conta utenti Isidata attualmente attivi
      // per calcolare la frazione di disattivazioni. `User.count` con
      // `externalSource='isidata'` + `isActive=true` è l'universo significativo
      // (gli utenti già disattivati non rientrano nel rischio "mass
      // deactivation": disattivarli di nuovo è no-op).
      const totalActiveUsers = await User.count({
        where: { externalSource: 'isidata', isActive: true },
      });
      const safetyChecks = computeSafetyChecks(diff, totalActiveUsers);

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
          safetyWarnings: safetyChecks.warnings.map((w) => `${w.level}:${w.code}`),
        },
        '[integrations.isidata] preview generato',
      );

      // Mapping "user-facing" per la UI guidata (Miglioria 1):
      //   - `detectedHeaders` = elenco completo degli header del file (così la
      //     UI può popolare i dropdown);
      //   - `effectiveMapping` = mapping risolto DOPO l'applicazione degli
      //     overrides admin (è ciò che il backend useŕa davvero);
      //   - `autoDetected`     = mapping risolto SENZA overrides — serve alla
      //     UI per (a) "Ripristina mapping automatico" e (b) calcolare i
      //     delta-vs-auto da rinviare in `mappingOverrides` su una preview
      //     successiva.
      const autoHeaderMap = buildHeaderMap(headers, null);
      const effectiveMapping = extractEffectiveMapping(headers, headerMap);
      const autoDetected = extractEffectiveMapping(headers, autoHeaderMap);

      // Serializza il diff per la UI: gli oggetti Sequelize devono essere
      // ridotti a JSON puro (response immutabile).
      res.json({
        token,
        hash,
        headers,
        headerMap,
        detectedHeaders: headers,
        effectiveMapping,
        autoDetected,
        summary: {
          fetched: externals.length,
          warnings,
          toCreate: diff.toCreate.length,
          toUpdate: diff.toUpdate.length,
          toOrphan: diff.toOrphan.length,
        },
        // Soft warnings dal diff engine (es. courseCode non in catalogo).
        // Distinti da `summary.warnings` (parse) e da `safetyChecks.warnings`
        // (gate bloccante).
        softWarnings: diff.warnings ?? [],
        safetyChecks,
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
              contractType: local.contractType ?? null,
              courseId: local.courseId ?? null,
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
  const { token, confirmedDiffHash, mappingOverrides, confirmCriticalWarnings } = req.body || {};
  if (!token || !confirmedDiffHash) {
    return res
      .status(400)
      .json({ error: 'token e confirmedDiffHash sono obbligatori', code: 'VALIDATION_FAILED' });
  }
  if (typeof token !== 'string' || !TOKEN_REGEX.test(token)) {
    return res.status(400).json({ error: 'token non valido', code: 'TOKEN_INVALID' });
  }
  // Hash atteso: 64 char hex (SHA-256). Validare PRIMA del confronto evita
  // chiamate a Buffer.from con input non normalizzato e dà un errore parlante.
  if (typeof confirmedDiffHash !== 'string' || !/^[a-f0-9]{64}$/i.test(confirmedDiffHash)) {
    return res.status(400).json({ error: 'hash non valido', code: 'VALIDATION_FAILED' });
  }
  // Solo l'admin che ha caricato può applicare: il prefisso del token
  // contiene il suo id.
  const tokenAdminPrefix = String(token).split('-')[0];
  if (String(req.user.id) !== tokenAdminPrefix) {
    return res
      .status(403)
      .json({ error: "token non appartenente all'admin corrente", code: 'TOKEN_FOREIGN' });
  }

  // Sanitizza eventuali overrides anche in apply: il client può passarli di
  // nuovo per "rifinire" il diff. Senza sanitize l'apply userebbe un mapping
  // diverso dalla preview se il client invia shape diversa.
  let safeOverrides = null;
  try {
    safeOverrides = sanitizeOverrides(mappingOverrides ?? null);
  } catch (err) {
    return res.status(400).json({ error: err.message, code: err.code || 'VALIDATION_FAILED' });
  }

  const buffer = readTempFile(token);
  if (!buffer) {
    return res.status(410).json({
      error: 'File scaduto o non trovato — ricarica e riavvia la procedura',
      code: 'TOKEN_EXPIRED',
    });
  }
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  // Confronto in tempo costante: previene timing-attack sull'hash atteso
  // (defense-in-depth — l'attaccante deve comunque possedere un token valido).
  const a = Buffer.from(fileHash, 'hex');
  const b = Buffer.from(confirmedDiffHash.toLowerCase(), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res
      .status(409)
      .json({ error: 'Hash file non coincide — ricarica la preview', code: 'HASH_MISMATCH' });
  }

  let parsed;
  try {
    parsed = await buildExternals(buffer, token, '', safeOverrides);
  } catch (err) {
    return res.status(400).json({ error: err.message, code: err.code || 'PARSE_FAILED' });
  }
  const { externals, warnings } = parsed;

  // Gate sicurezza pre-apply (Miglioria 1): ricomputiamo il diff PROSPECTIVE
  // fuori transazione per produrre i warning di safety. Se ci sono warning
  // `critical` e l'admin NON ha spedito `confirmCriticalWarnings: true`,
  // rifiutiamo con 409. Questa ricomputazione è "consultiva": la transazione
  // vera la rifarà di nuovo dentro al t (Snapshot Isolation), così se nel
  // frattempo qualcuno crea/disattiva utenti il diff finale sarà coerente.
  // Il rischio "false-negative" (in /apply non c'è più warning critico, ma
  // l'admin l'ha confermato) è accettabile: niente bloccante.
  {
    const matricoleSetCheck = new Set(externals.map((e) => e.matricola).filter(Boolean));
    const emailsSetCheck = new Set(externals.map((e) => e.email).filter(Boolean));
    const externalIdsSetCheck = new Set(externals.map((e) => e.externalId).filter(Boolean));
    const orFiltersCheck = [{ externalSource: 'isidata' }];
    if (matricoleSetCheck.size)
      orFiltersCheck.push({ matricola: { [Op.in]: Array.from(matricoleSetCheck) } });
    if (emailsSetCheck.size)
      orFiltersCheck.push({ email: { [Op.in]: Array.from(emailsSetCheck) } });
    if (externalIdsSetCheck.size)
      orFiltersCheck.push({
        externalSource: 'isidata',
        externalId: { [Op.in]: Array.from(externalIdsSetCheck) },
      });
    const localUsersCheck = await User.findAll({ where: { [Op.or]: orFiltersCheck } });
    const diffCheck = computeDiff(externals, localUsersCheck, 'matricola', 'isidata');
    const totalActiveUsersCheck = await User.count({
      where: { externalSource: 'isidata', isActive: true },
    });
    const safetyChecksApply = computeSafetyChecks(diffCheck, totalActiveUsersCheck);
    const criticalCodes = safetyChecksApply.warnings
      .filter((w) => w.level === 'critical')
      .map((w) => w.code);
    if (criticalCodes.length > 0 && confirmCriticalWarnings !== true) {
      return res.status(409).json({
        error: 'Sono presenti warning critici: richiesta conferma esplicita',
        code: 'CRITICAL_WARNINGS_PRESENT',
        criticalCodes,
        safetyChecks: safetyChecksApply,
      });
    }
  }

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

      // Map courseCode → courseId DENTRO la transazione: garantisce che un
      // corso disattivato/cancellato fra preview e apply venga ri-letto.
      const courseCodeToIdTx = await loadCourseCodeToIdMap(t);
      const diff = computeDiff(externals, localUsers, 'matricola', 'isidata', {
        courseCodeToId: courseCodeToIdTx,
      });

      let created = 0,
        updated = 0,
        orphaned = 0,
        errors = 0;
      const errorPayload = [];
      const now = new Date();

      // CREATE
      for (const ext of diff.toCreate) {
        try {
          // Priorità: courseId pre-risolto dal diff engine (lookup esatto
          // su `Course.code`). Fallback `resolveCourse` per quei record con
          // SOLO courseName (legacy) o courseCode non in catalogo: in quel
          // caso `resolveCourse` può creare on-demand un Course se serve.
          let courseId = ext.courseId ?? null;
          if (!courseId && (ext.courseCode || ext.courseName)) {
            const course = await resolveCourse({ code: ext.courseCode, name: ext.courseName }, t);
            courseId = course?.id ?? null;
          }
          // Email può essere null per studenti minorenni: in quel caso
          // generiamo un placeholder unique-safe (admin la modificherà a
          // mano quando l'utente attiverà il profilo). Sanitiziamo l'externalId
          // a `[a-z0-9._-]` per il local-part: il modello User ha validate
          // isEmail e externalId arbitrari (con `:`, spazi, accenti) farebbero
          // fallire la create con ValidationError.
          const safeLocalPart =
            String(ext.externalId || crypto.randomBytes(4).toString('hex'))
              .toLowerCase()
              .replace(/[^a-z0-9._-]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .slice(0, 60) || crypto.randomBytes(4).toString('hex');
          const email = ext.email || `import-${safeLocalPart}@imported.local`;
          const createData = {
            email,
            firstName: ext.firstName,
            lastName: ext.lastName,
            role: ext.role,
            matricola: ext.matricola,
            courseId,
            status: 'pending', // l'admin li approva esplicitamente dopo l'import
            isActive: ext.status === 'active',
            externalSource: 'isidata',
            externalId: ext.externalId ?? null,
            lastExternalSyncAt: now,
          };
          // contractType: presente solo per docenti con qualifica riconosciuta
          // (Miglioria 2). Per gli studenti il campo non è nel payload.
          if (ext.contractType) createData.contractType = ext.contractType;
          await User.create(createData, { transaction: t });
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
            } else if (f === 'contractType') {
              // contractType è opt-in: il diff l'ha già filtrato (entra in
              // fieldsChanged solo se ext.contractType != null). Lo settiamo
              // direttamente senza fallback al valore locale per non
              // produrre un noop.
              updates.contractType = ext.contractType;
            } else {
              updates[f] = ext[f] ?? u[f];
            }
          }
          // Se il corso è cambiato, risolvi e linka. Prima prova la map
          // (Miglioria 3 — lookup O(1)), poi fallback al resolver completo
          // che può creare il Course on-demand su courseName.
          if (ext.courseId && ext.courseId !== u.courseId) {
            updates.courseId = ext.courseId;
          } else if (!ext.courseId && (ext.courseCode || ext.courseName)) {
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
    // Includiamo `matricola` (oltre a externalId) per rendere possibile il
    // confronto run-vs-run (Miglioria 2): l'endpoint compare-previous estrae
    // matricole o, in fallback, externalId.
    const diffSnapshot = {
      toCreate: diff.toCreate.map((e) => ({
        matricola: e.matricola ?? null,
        externalId: e.externalId,
        email: e.email,
        role: e.role,
      })),
      toUpdate: diff.toUpdate.map((u) => ({
        userId: u.local.id,
        matricola: u.local?.matricola ?? u.external?.matricola ?? null,
        externalId: u.external.externalId,
        fieldsChanged: u.fieldsChanged,
      })),
      toOrphan: diff.toOrphan.map((u) => ({
        userId: u.id,
        matricola: u.matricola ?? null,
        externalId: u.externalId ?? null,
      })),
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
        return res.status(400).json({ error: 'id non valido', code: 'VALIDATION_FAILED' });
      }
      const current = await IntegrationSyncRun.findByPk(id);
      if (!current) {
        return res.status(404).json({ error: 'Run non trovato', code: 'NOT_FOUND' });
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
module.exports.cleanupExpiredTmpFiles = cleanupExpiredTmpFiles;
