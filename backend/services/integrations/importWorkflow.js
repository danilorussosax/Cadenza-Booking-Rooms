'use strict';

/**
 * Workflow di import anagrafica (Isidata, ESSE3, ...): preview + apply.
 *
 * Interfaccia (module profondo, nessuna dipendenza da Express):
 *   preview(source, { buffer, originalName, mimetype, mappingOverrides }, actor)
 *     → corpo della risposta preview ({ token, hash, diff, safetyChecks, ... })
 *   apply(source, { token, confirmedDiffHash, mappingOverrides, confirmCriticalWarnings }, actor)
 *     → corpo della risposta apply ({ runId, status, summary, createdUserIds })
 *   cleanupExpiredTmpFiles()
 *
 * `actor` = { id } dell'admin. Gli errori sono `domainError` con status/code
 * stabili: la route li inoltra a `next()` senza ulteriore mappatura.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Op, Transaction } = require('sequelize');

const { sequelize, User, Course, IntegrationConfig, IntegrationSyncRun } = require('../../models');
const logger = require('../../lib/logger');
const csvImporter = require('./isidata/csvImporter');
const {
  buildHeaderMap,
  applyMapping,
  sanitizeOverrides,
  extractEffectiveMapping,
} = require('./isidata/fieldMapping');
const { computeDiff, computeSafetyChecks } = require('./diffEngine');
const profiles = require('./profiles');
const { domainError } = require('../../lib/domainError');

// Token formato: `${adminId}-${Date.now()}-${hex16}${ext}` con ext `.csv|.xlsx|...`.
// Stringere la regex impedisce che varianti tipo `1-foo.csv` (senza Date e
// senza hex random) passino il filtro pre-readTempFile.
const TOKEN_REGEX = /^\d+-\d+-[a-f0-9]{16}\.[a-z0-9]{1,8}$/i;

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

// Utenti locali candidati al matching: quelli già legati al provider + quelli
// con matricola/email/externalId che potrebbero collidere con il file
// (promozione da utente creato a mano a utente legato all'import).
function loadMatchingLocalUsers(externals, source, options = {}) {
  const matricole = new Set(externals.map((e) => e.matricola).filter(Boolean));
  const emails = new Set(externals.map((e) => e.email).filter(Boolean));
  const externalIds = new Set(externals.map((e) => e.externalId).filter(Boolean));

  const orFilters = [{ externalSource: source }];
  if (matricole.size) orFilters.push({ matricola: { [Op.in]: Array.from(matricole) } });
  if (emails.size) orFilters.push({ email: { [Op.in]: Array.from(emails) } });
  if (externalIds.size)
    orFilters.push({
      externalSource: source,
      externalId: { [Op.in]: Array.from(externalIds) },
    });
  return User.findAll({ where: { [Op.or]: orFilters }, ...options });
}

// Parse + validazione di `mappingOverrides` ricevuto dal client (stringa JSON
// o oggetto). Cap a 4KB: evita CPU-spike su payload patologici.
function parseOverridesInput(raw) {
  if (!raw) return null;
  if (typeof raw === 'string' && raw.length > 4096) {
    throw domainError('VALIDATION_FAILED', 'mappingOverrides troppo grande');
  }
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw domainError('VALIDATION_FAILED', 'mappingOverrides JSON non valido');
  }
  try {
    return sanitizeOverrides(parsed);
  } catch (err) {
    throw domainError(err.code || 'VALIDATION_FAILED', err.message);
  }
}

// =====================================================
// PREVIEW: calcola il diff senza toccare il DB (salvo il file temporaneo).
// =====================================================
async function preview(source, { buffer, originalName, mimetype, mappingOverrides }, actor) {
  if (!buffer) {
    throw domainError('FILE_REQUIRED', 'File mancante (campo "file")');
  }
  const overrides = parseOverridesInput(mappingOverrides);

  let parsed;
  try {
    parsed = await buildExternals(buffer, originalName, mimetype, overrides);
  } catch (err) {
    if (err.code === 'FILE_TOO_LARGE' || err.code === 'PARSE_FAILED') {
      throw domainError(err.code, err.message);
    }
    throw err;
  }
  const { externals, headers, headerMap, warnings } = parsed;

  const localUsers = await loadMatchingLocalUsers(externals, source, { paranoid: true });

  // Codici corso sconosciuti finiscono in diff.warnings (soft).
  const courseCodeToId = await loadCourseCodeToIdMap();
  const diff = computeDiff(externals, localUsers, 'matricola', source, { courseCodeToId });

  // Universo del rischio "mass deactivation": utenti del provider attivi.
  const totalActiveUsers = await User.count({
    where: { externalSource: source, isActive: true },
  });
  const safetyChecks = computeSafetyChecks(diff, totalActiveUsers);

  const { token, hash } = persistTempFile(actor.id, buffer, originalName);

  logger?.info?.(
    {
      source,
      actorId: actor.id,
      rows: externals.length,
      toCreate: diff.toCreate.length,
      toUpdate: diff.toUpdate.length,
      toOrphan: diff.toOrphan.length,
      warnings: warnings.length,
      safetyWarnings: safetyChecks.warnings.map((w) => `${w.level}:${w.code}`),
    },
    `[integrations.${source}] preview generato`,
  );

  // Mapping "user-facing": `effectiveMapping` dopo gli overrides admin,
  // `autoDetected` senza overrides (per "Ripristina mapping automatico").
  const autoHeaderMap = buildHeaderMap(headers, null);
  const effectiveMapping = extractEffectiveMapping(headers, headerMap);
  const autoDetected = extractEffectiveMapping(headers, autoHeaderMap);

  return {
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
    // Soft warnings del diff engine (distinti da summary.warnings e dal gate).
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
  };
}

// Validazione sintattica di token/hash e ownership (prefisso = id admin).
function assertTokenRequest(token, confirmedDiffHash, actor) {
  if (!token || !confirmedDiffHash) {
    throw domainError('VALIDATION_FAILED', 'token e confirmedDiffHash sono obbligatori');
  }
  if (typeof token !== 'string' || !TOKEN_REGEX.test(token)) {
    throw domainError('TOKEN_INVALID', 'token non valido');
  }
  // Hash atteso: 64 char hex (SHA-256), validato PRIMA del confronto.
  if (typeof confirmedDiffHash !== 'string' || !/^[a-f0-9]{64}$/i.test(confirmedDiffHash)) {
    throw domainError('VALIDATION_FAILED', 'hash non valido');
  }
  // Solo l'admin che ha caricato può applicare: il prefisso contiene il suo id.
  if (String(actor.id) !== token.split('-')[0]) {
    throw domainError('TOKEN_FOREIGN', "token non appartenente all'admin corrente", {
      status: 403,
    });
  }
}

// Legge il file temporaneo e verifica l'hash confermato (anti-TOCTOU).
function readConfirmedBuffer(token, confirmedDiffHash) {
  const buffer = readTempFile(token);
  if (!buffer) {
    throw domainError(
      'TOKEN_EXPIRED',
      'File scaduto o non trovato — ricarica e riavvia la procedura',
      { status: 410 },
    );
  }
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  // Confronto in tempo costante (defense-in-depth contro timing-attack).
  const a = Buffer.from(fileHash, 'hex');
  const b = Buffer.from(confirmedDiffHash.toLowerCase(), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw domainError('HASH_MISMATCH', 'Hash file non coincide — ricarica la preview', {
      status: 409,
    });
  }
  return buffer;
}

// Gate sicurezza pre-apply: diff PROSPECTIVE fuori transazione; i warning
// `critical` bloccano (409) salvo `confirmCriticalWarnings === true`.
async function assertCriticalWarningsConfirmed(externals, source, confirmCriticalWarnings) {
  const localUsers = await loadMatchingLocalUsers(externals, source);
  const diff = computeDiff(externals, localUsers, 'matricola', source);
  const totalActiveUsers = await User.count({
    where: { externalSource: source, isActive: true },
  });
  const safetyChecks = computeSafetyChecks(diff, totalActiveUsers);
  const criticalCodes = safetyChecks.warnings
    .filter((w) => w.level === 'critical')
    .map((w) => w.code);
  if (criticalCodes.length > 0 && confirmCriticalWarnings !== true) {
    throw domainError(
      'CRITICAL_WARNINGS_PRESENT',
      'Sono presenti warning critici: richiesta conferma esplicita',
      { status: 409, extra: { criticalCodes, safetyChecks } },
    );
  }
}

// Applica il diff ricomputato DENTRO la transazione. Errori per-record sono
// raccolti in errorPayload; un errore fatale fa rollback dell'intero batch.
async function applyDiffInTransaction(externals, source, t) {
  const localUsers = await loadMatchingLocalUsers(externals, source, { transaction: t });

  // Map corsi DENTRO la transazione: un corso disattivato fra preview e apply
  // viene ri-letto.
  const courseCodeToIdTx = await loadCourseCodeToIdMap(t);
  const diff = computeDiff(externals, localUsers, 'matricola', source, {
    courseCodeToId: courseCodeToIdTx,
  });

  let created = 0,
    updated = 0,
    orphaned = 0,
    errors = 0;
  const errorPayload = [];
  const createdUserIds = [];
  const now = new Date();

  // CREATE
  for (const ext of diff.toCreate) {
    try {
      // courseId pre-risolto dal diff engine; fallback `resolveCourse` per
      // record con solo courseName o courseCode non in catalogo.
      let courseId = ext.courseId ?? null;
      if (!courseId && (ext.courseCode || ext.courseName)) {
        const course = await resolveCourse({ code: ext.courseCode, name: ext.courseName }, t);
        courseId = course?.id ?? null;
      }
      // Email null (studenti minorenni): placeholder unique-safe. L'externalId
      // viene sanitizzato a `[a-z0-9._-]` perché User valida isEmail.
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
        externalSource: source,
        externalId: ext.externalId ?? null,
        lastExternalSyncAt: now,
      };
      // contractType: solo docenti con qualifica riconosciuta.
      if (ext.contractType) createData.contractType = ext.contractType;
      const createdUser = await User.create(createData, { transaction: t });
      createdUserIds.push(createdUser.id);
      created++;
    } catch (err) {
      errors++;
      errorPayload.push({ kind: 'create', externalId: ext.externalId, msg: err.message });
      logger?.warn?.({ source, ext, err: err.message }, `[integrations.${source}] create failed`);
    }
  }

  // UPDATE
  for (const item of diff.toUpdate) {
    try {
      const u = item.local;
      const ext = item.external;
      const updates = {
        externalSource: source,
        externalId: ext.externalId ?? u.externalId,
        lastExternalSyncAt: now,
      };
      // Solo i campi in `fieldsChanged`: non sovrascrive mod manuali dell'admin.
      for (const f of item.fieldsChanged) {
        if (f === 'isActive') {
          updates.isActive = ext.status === 'active';
        } else if (f === 'contractType') {
          // opt-in: il diff l'ha già filtrato (ext.contractType != null).
          updates.contractType = ext.contractType;
        } else {
          updates[f] = ext[f] ?? u[f];
        }
      }
      // Corso cambiato: prima la map (O(1)), poi resolver che può creare il Course.
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
        { source, userId: item.local.id, err: err.message },
        `[integrations.${source}] update failed`,
      );
    }
  }

  // ORPHAN: MAI delete. Soft-disable + nota.
  const sourceLabel = profiles.getProfile(source)?.displayName || source;
  for (const u of diff.toOrphan) {
    try {
      await u.update(
        {
          isActive: false,
          externalStatusNote: `Non più presente nell'export ${sourceLabel} del ${now.toISOString().slice(0, 10)}`,
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

  return { created, updated, orphaned, errors, errorPayload, diff, createdUserIds };
}

// =====================================================
// APPLY: riapplica il file persistito, verifica hash (anti-TOCTOU) e applica
// in transazione (SERIALIZABLE su Postgres). Registra sempre un
// IntegrationSyncRun, anche se la transazione fallisce.
// =====================================================
async function apply(
  source,
  { token, confirmedDiffHash, mappingOverrides, confirmCriticalWarnings } = {},
  actor,
) {
  assertTokenRequest(token, confirmedDiffHash, actor);

  // Sanitizza gli overrides anche in apply: shape diversa dalla preview
  // produrrebbe un mapping diverso.
  let safeOverrides;
  try {
    safeOverrides = sanitizeOverrides(mappingOverrides ?? null);
  } catch (err) {
    throw domainError(err.code || 'VALIDATION_FAILED', err.message);
  }

  const buffer = readConfirmedBuffer(token, confirmedDiffHash);

  let parsed;
  try {
    parsed = await buildExternals(buffer, token, '', safeOverrides);
  } catch (err) {
    throw domainError(err.code || 'PARSE_FAILED', err.message);
  }
  const { externals, warnings } = parsed;

  await assertCriticalWarningsConfirmed(externals, source, confirmCriticalWarnings);

  // Config esistente (best-effort: può non esistere ancora).
  const config = await IntegrationConfig.findOne({
    where: { provider: source },
    order: [['id', 'ASC']],
  });

  // Run subito 'in_progress': visibile in storia anche se la transazione fallisce.
  const run = await IntegrationSyncRun.create({
    configId: config?.id ?? null,
    instituteId: config?.instituteId ?? null,
    provider: source,
    actorId: actor.id,
    startedAt: new Date(),
    triggeredBy: 'manual',
    status: 'in_progress',
    fetched: externals.length,
  });

  try {
    // Postgres: SERIALIZABLE; SQLite/MySQL: best-effort.
    const isPostgres = sequelize.getDialect() === 'postgres';
    const txOpts = isPostgres ? { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE } : {};

    const result = await sequelize.transaction(txOpts, (t) =>
      applyDiffInTransaction(externals, source, t),
    );

    const { created, updated, orphaned, errors, errorPayload, diff, createdUserIds } = result;
    const finalStatus =
      errors === 0 ? 'success' : created + updated + orphaned > 0 ? 'partial' : 'failed';

    // Snapshot "leggero" per audit (no `raw`). Include `matricola` per il
    // confronto run-vs-run (compare-previous).
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

    // Aggiorna "last run" denormalizzato della config (se esiste).
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
        source,
        runId: run.id,
        actorId: actor.id,
        created,
        updated,
        orphaned,
        errors,
        status: finalStatus,
      },
      `[integrations.${source}] apply completato`,
    );

    return {
      runId: run.id,
      status: finalStatus,
      summary: { fetched: externals.length, created, updated, orphaned, errors, warnings },
      // Il frontend li passa a POST /api/users/send-setup-links-bulk.
      createdUserIds,
    };
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
    logger?.error?.({ source, err }, `[integrations.${source}] apply fallito`);
    throw err;
  }
}

module.exports = { preview, apply, cleanupExpiredTmpFiles, TOKEN_REGEX, TMP_DIR };
