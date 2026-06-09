'use strict';

const express = require('express');
const multer = require('multer');
const { Op } = require('sequelize');
const { stringify: csvStringify } = require('csv-stringify/sync');
const { sequelize, User, Course, Booking, MonteOreProposal, ContractType } = require('../models');
const { currentAcademicYear } = require('../services/monteOreCalendarService');
const { authenticate, requireRole } = require('../middleware/auth');
const { pickAllowed, ValidationError } = require('../lib/sanitize');
const { parsePagination, setPaginationHeaders } = require('../lib/pagination');
const csvImporter = require('../services/integrations/isidata/csvImporter');
const { importUsersFromFile } = require('../services/users/csvImport');
const {
  sendSetupLink,
  PURPOSE_INITIAL_SETUP,
  TTL_SETUP_MIN_DAYS,
  TTL_SETUP_MAX_DAYS,
} = require('../services/auth/sendSetupLink');
const logger = require('../lib/logger');

// Policy password: identica a quella di registrazione/reset (routes/auth.js).
// Tenere sincronizzate per evitare downgrade della robustezza via rotte admin.
const PASSWORD_MIN_LEN = 10;
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{10,}$/;
const PASSWORD_POLICY_MSG = `La password deve avere almeno ${PASSWORD_MIN_LEN} caratteri, con almeno una maiuscola e una cifra`;

/**
 * Anti-lockout: previene la trasformazione dell'ULTIMO admin in non-admin
 * (sia diretta — `role: 'docente'`, sia indiretta — `isActive: false`,
 * `status: 'rejected'`). Senza questo check un'errore admin distratto può
 * lasciare l'istituto senza alcun account amministratore, recuperabile solo
 * da terminale lato server.
 *
 * Restituisce { ok: true } se l'operazione è sicura, oppure
 * { ok: false, error, code } se va bloccata.
 */
async function checkAdminLockout(target, updates) {
  const wouldStripAdmin =
    target.role === 'admin' &&
    ((updates.role !== undefined && updates.role !== 'admin') ||
      updates.isActive === false ||
      updates.status === 'rejected');
  if (!wouldStripAdmin) return { ok: true };

  // Conta gli admin ATTIVI e APPROVATI residui (escluso il target).
  const otherActiveAdmins = await User.count({
    where: {
      role: 'admin',
      isActive: true,
      status: 'approved',
      id: { [Op.ne]: target.id },
    },
  });
  if (otherActiveAdmins === 0) {
    return {
      ok: false,
      error:
        "Operazione bloccata: questo è l'ultimo amministratore attivo. " +
        'Promuovi prima un altro utente ad admin.',
      code: 'LAST_ADMIN_LOCKOUT',
    };
  }
  return { ok: true };
}

const router = express.Router();

// =====================================================
// EXPORT CSV utenti (admin)
// Esporta in CSV email, anagrafica, ruolo, matricola, corso (SAD), stato e
// flag attivo. **NON** include hash password, segreti 2FA, token. Round-trip
// safe con POST /import (l'import imposta una password temporanea casuale).
// =====================================================
router.get('/export.csv', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const users = await User.findAll({
      include: [{ association: 'course', attributes: ['code', 'name'] }],
      order: [
        ['lastName', 'ASC'],
        ['firstName', 'ASC'],
      ],
    });
    const rows = [
      ['Email', 'Cognome', 'Nome', 'Ruolo', 'Matricola', 'CodiceCorso', 'Stato', 'Attivo'],
      ...users.map((u) => [
        u.email,
        u.lastName || '',
        u.firstName || '',
        u.role,
        u.matricola || '',
        u.course?.code || '',
        u.status || 'approved',
        u.isActive ? 'si' : 'no',
      ]),
    ];
    const csv = csvStringify(rows, { delimiter: ';', quoted_string: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="utenti-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
});

// =====================================================
// IMPORT CSV/XLSX utenti (admin)
//
// Multipart upload (campo `file`). Accetta sia CSV (delimitatore `;` o `,`,
// auto-detect) sia XLSX. Colonne riconosciute (case e accenti indifferenti,
// stesso schema dell'export Isidata):
//   Email*, Cognome*, Nome*, Ruolo* (admin/docente/studente), Matricola,
//   CodiceCorso (SAD lookup → courseId), Stato (pending/approved/rejected;
//   default approved), Attivo (si/no; default si).
//
// Per ogni nuovo utente viene generata una password temporanea casuale: l'admin
// deve invitare l'utente al reset password (o consentire il primo login via
// 2FA email/SSO). Idempotente: upsert su email; per utenti esistenti aggiorna
// solo i campi presenti nel file, NON tocca password.
//
// L'implementazione vive in `services/users/csvImport.js` e riusa il parser
// di `services/integrations/isidata/csvImporter` (XLSX + CSV multidelimiter).
// =====================================================
const VALID_ROLES = ['admin', 'docente', 'studente'];
const VALID_STATUSES = ['pending', 'approved', 'rejected'];

const userImportUpload = multer({
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

router.post(
  '/import',
  authenticate,
  requireRole('admin'),
  userImportUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: 'File mancante (campo "file")', code: 'FILE_REQUIRED' });
      }
      const result = await importUsersFromFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
      res.json(result);
    } catch (err) {
      if (
        err.code === 'FILE_TOO_LARGE' ||
        err.code === 'PARSE_FAILED' ||
        err.code === 'EMPTY_FILE'
      ) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      next(err);
    }
  },
);

// Crea utente manualmente (admin) — sempre creato come 'approved'.
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { firstName, lastName, email, password, role, matricola, courseId, isActive } = req.body;

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return res
      .status(400)
      .json({ error: 'Nome, cognome ed email sono obbligatori', code: 'VALIDATION_FAILED' });
  }
  if (!password || !PASSWORD_REGEX.test(password)) {
    return res.status(400).json({ error: PASSWORD_POLICY_MSG, code: 'PASSWORD_POLICY' });
  }

  const existing = await User.findOne({ where: { email: email.toLowerCase().trim() } });
  if (existing)
    return res
      .status(409)
      .json({ error: 'Esiste già un account con questa email', code: 'EMAIL_ALREADY_REGISTERED' });

  if (matricola?.trim()) {
    const existingMatricola = await User.findOne({ where: { matricola: matricola.trim() } });
    if (existingMatricola)
      return res.status(409).json({
        error: 'Matricola già assegnata a un altro utente',
        code: 'MATRICOLA_ALREADY_USED',
      });
  }

  const user = await User.create({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.toLowerCase().trim(),
    passwordHash: password,
    role: role || 'studente',
    matricola: matricola?.trim() || null,
    courseId: parseInt(courseId, 10) || null,
    isActive: isActive !== false,
    status: 'approved',
  });

  res.status(201).json({ user: user.toSafeJSON() });
});

// Lista utenti (admin) — paginated.
// Query: ?role=, ?active=, ?status=, ?limit= (1-500, def 100), ?offset= (def 0).
// Risposta: { users: User[] } + header X-Total-Count, X-Limit, X-Offset.
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const where = {};
  if (req.query.role) where.role = req.query.role;
  if (req.query.active) where.isActive = req.query.active === 'true';
  if (req.query.status) where.status = req.query.status;

  const { limit, offset } = parsePagination(req.query);
  const { rows, count } = await User.findAndCountAll({
    where,
    include: [{ model: Course, as: 'course' }],
    order: [['lastName', 'ASC']],
    limit,
    offset,
    // distinct=true necessario quando si usa include + count, altrimenti
    // count gonfia per ogni JOIN (es. utente con N corsi → contato N volte).
    distinct: true,
  });
  setPaginationHeaders(res, count, limit, offset);
  res.json({ users: rows.map((u) => u.toSafeJSON()) });
});

// Conteggio utenti in attesa di approvazione (admin) — usato per badge in UI.
router.get('/pending/count', authenticate, requireRole('admin'), async (req, res) => {
  const count = await User.count({ where: { status: 'pending', role: 'docente' } });
  res.json({ count });
});

// Approva un utente in attesa (admin)
router.post('/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato', code: 'USER_NOT_FOUND' });
  user.status = 'approved';
  await user.save();
  res.json({ user: user.toSafeJSON() });
});

// Rifiuta un utente in attesa (admin)
router.post('/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato', code: 'USER_NOT_FOUND' });
  user.status = 'rejected';
  await user.save();
  res.json({ user: user.toSafeJSON() });
});

// Reset del flag hard-bounce (admin): l'utente torna a ricevere email.
// Da usare dopo aver corretto un typo o quando il provider è stato sbloccato.
router.post('/:id/reset-bounce', authenticate, requireRole('admin'), async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato', code: 'USER_NOT_FOUND' });
  user.emailBouncedAt = null;
  user.emailBouncedReason = null;
  await user.save();
  res.json({ user: user.toSafeJSON() });
});

// Dettaglio utente
router.get('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const user = await User.findByPk(req.params.id, {
    include: [{ model: Course, as: 'course' }],
  });
  if (!user) return res.status(404).json({ error: 'Utente non trovato', code: 'USER_NOT_FOUND' });
  res.json({ user: user.toSafeJSON() });
});

// =====================================================
// Monte Ore — override individuale (admin)
// PUT /api/users/:id/monte-ore-override
// Body: {
//   contractType?: string|null,  // ContractType.code (anagrafica dinamica) o null
//   monteOreAnnualHoursOverride?: number|null,  // null = rimuove override
//   monteOreBypassDayConstraint?: boolean,
//   monteOreOverrideReason?: string|null,
// }
// Quando si imposta override hours o bypass, `monteOreOverrideReason` è
// obbligatoria. Solo per utenti con role='docente'. L'audit log è gestito dal
// middleware globale (pattern /api/users/:id).
// =====================================================
router.put(
  '/:id/monte-ore-override',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const user = await User.findByPk(req.params.id);
      if (!user) {
        return res.status(404).json({ error: 'Utente non trovato', code: 'USER_NOT_FOUND' });
      }
      if (user.role !== 'docente') {
        return res.status(400).json({
          error: 'Override Monte Ore valido solo per ruolo docente',
          code: 'WRONG_ROLE',
        });
      }

      const {
        contractType: rawContractType,
        monteOreAnnualHoursOverride: rawHours,
        monteOreBypassDayConstraint: rawBypass,
        monteOreOverrideReason: rawReason,
        // Fase 6.1: deroga individuale alla finestra di submission.
        // Stringa YYYY-MM-DD (DATEONLY), oppure null/'' per revocare.
        monteOreSubmissionAllowedUntil: rawSubmissionUntil,
      } = req.body || {};

      // Normalizzazione
      const contractType =
        rawContractType === undefined
          ? user.contractType
          : rawContractType === '' || rawContractType === null
            ? null
            : String(rawContractType);
      // Validazione cross-tabella: il code deve esistere in ContractType
      // (anagrafica dinamica gestita dall'admin). Accettiamo anche tipi
      // soft-deleted/disattivati: l'utente potrebbe averli già assegnati e
      // dobbiamo permettere di salvare altre modifiche senza forzare un
      // cambio di tipologia. I 4 code storici sono sempre accettati come
      // fallback: in produzione sono garantiti dal seed, e questo evita
      // regressioni in setup minimal che non eseguono il seeder.
      const LEGACY_CONTRACT_CODES = ['titolare', 'contratto_orario', 'supplente', 'altro'];
      if (contractType !== null && !LEGACY_CONTRACT_CODES.includes(contractType)) {
        if (!/^[a-z0-9_]{1,40}$/.test(contractType)) {
          return res.status(400).json({
            error: 'contractType non valido (formato atteso: a-z, 0-9, _; max 40 char)',
            code: 'INVALID_CONTRACT_TYPE',
          });
        }
        const ct = await ContractType.findOne({
          where: { code: contractType },
          paranoid: false,
        });
        if (!ct) {
          const validCodes = (
            await ContractType.findAll({ attributes: ['code'], where: { isActive: true } })
          )
            .map((c) => c.code)
            .join(', ');
          return res.status(400).json({
            error: `contractType "${contractType}" non trovato. Ammessi: ${validCodes || LEGACY_CONTRACT_CODES.join(', ')}`,
            code: 'INVALID_CONTRACT_TYPE',
          });
        }
      }

      let hoursOverride = null;
      if (rawHours !== undefined && rawHours !== null && rawHours !== '') {
        const n = Number(rawHours);
        if (!Number.isFinite(n) || n < 0 || n > 1500) {
          return res.status(400).json({
            error: 'Override ore deve essere un numero tra 0 e 1500',
            code: 'OVERRIDE_OUT_OF_RANGE',
          });
        }
        hoursOverride = n;
      }

      const bypass = rawBypass === true || rawBypass === 'true';
      const reason = rawReason ? String(rawReason).trim().slice(0, 500) : null;

      // Motivazione obbligatoria se si IMPOSTA almeno una deroga.
      const settingOverride = hoursOverride != null || bypass === true;
      if (settingOverride && !reason) {
        return res.status(400).json({
          error: 'Motivazione obbligatoria quando si imposta una deroga',
          code: 'OVERRIDE_REASON_REQUIRED',
        });
      }

      // Fase 6.1 — deroga finestra submission. Accetta stringa YYYY-MM-DD
      // (inclusa) oppure null/'' per revocare. Se omessa nel body lasciamo
      // il valore corrente invariato.
      let submissionAllowedUntil; // undefined = no-op
      if (rawSubmissionUntil !== undefined) {
        if (rawSubmissionUntil === null || rawSubmissionUntil === '') {
          submissionAllowedUntil = null;
        } else {
          const s = String(rawSubmissionUntil).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            return res.status(400).json({
              error: 'monteOreSubmissionAllowedUntil deve essere YYYY-MM-DD',
              code: 'INVALID_DATE',
            });
          }
          submissionAllowedUntil = s;
        }
      }

      // Snapshot pre-update per rilevare cambiamenti rilevanti (6.3).
      const before = {
        contractType: user.contractType,
        hours: user.monteOreAnnualHoursOverride,
        bypass: user.monteOreBypassDayConstraint,
      };

      const updates = {
        contractType: contractType || null,
        monteOreAnnualHoursOverride: hoursOverride,
        monteOreBypassDayConstraint: bypass,
        // Se nessuna deroga è attiva, azzeriamo reason/setBy/setAt per pulizia.
        monteOreOverrideReason: settingOverride ? reason : null,
        monteOreOverrideSetAt: settingOverride ? new Date() : null,
        monteOreOverrideSetBy: settingOverride ? req.user.id : null,
      };
      if (submissionAllowedUntil !== undefined) {
        updates.monteOreSubmissionAllowedUntil = submissionAllowedUntil;
      }
      await user.update(updates);

      // Fase 6.3 — se il contratto / ore / bypass sono cambiati e il docente
      // ha una proposta dell'AA corrente in stato submitted/approved/generated,
      // la marchiamo come da rivalidare: il banner UI inviterà il docente a
      // rivedere e ri-inviare. Non blocchiamo la richiesta se questa update
      // fallisce: è un'ottimizzazione UX, non un invariant.
      const contractChanged = before.contractType !== (contractType || null);
      const hoursChanged = before.hours !== hoursOverride;
      const bypassChanged = before.bypass !== bypass;
      if (contractChanged || hoursChanged || bypassChanged) {
        try {
          const year = currentAcademicYear();
          const note = `Variazione ${contractChanged ? 'contratto' : hoursChanged ? 'ore' : 'vincolo giorni'} (admin) in corso d'anno: rivedi e re-invia la proposta.`;
          await MonteOreProposal.update(
            { requiresRevalidation: true, revalidationReason: note },
            {
              where: {
                userId: user.id,
                academicYear: year,
                status: ['submitted', 'approved', 'generated'],
              },
            },
          );
        } catch (e) {
          // Log ma non blocca: la modifica utente è andata a buon fine.

          console.warn('[monte-ore] flag requiresRevalidation fallita:', e?.message);
        }
      }

      res.json({ user: user.toSafeJSON() });
    } catch (err) {
      next(err);
    }
  },
);

// Modifica utente (admin: può cambiare ruolo, attivare/disattivare, ecc.)
router.put('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Utente non trovato', code: 'USER_NOT_FOUND' });
    }

    // Whitelist + coercizione tipi: tutto il resto del body viene scartato
    // silenziosamente (anti mass-assignment di campi sensibili tipo passwordHash,
    // tokenVersion, twoFaSecretEncrypted, monteOreOverrideSetBy, …).
    const updates = pickAllowed(req.body, {
      firstName: { type: 'string', maxLength: 100 },
      lastName: { type: 'string', maxLength: 100 },
      matricola: { type: 'string', maxLength: 50, nullable: true },
      courseId: { type: 'integer', nullable: true, min: 0 },
      isActive: 'boolean',
      role: { type: 'enum', values: VALID_ROLES },
      status: { type: 'enum', values: VALID_STATUSES },
    });

    // Auto-protezione: l'admin non può cambiare il PROPRIO ruolo né disattivarsi
    // né rifiutarsi (richiede l'azione di un altro admin). Evita lockout
    // accidentale quando l'admin è loggato col proprio account e clicca per
    // sbaglio "Disattiva" sul proprio profilo.
    if (user.id === req.user.id) {
      if (updates.role !== undefined && updates.role !== user.role) {
        return res.status(400).json({
          error: 'Non puoi cambiare il tuo stesso ruolo. Chiedi a un altro amministratore.',
          code: 'CANNOT_SELF_ROLE_CHANGE',
        });
      }
      if (updates.isActive === false) {
        return res.status(400).json({
          error: 'Non puoi disattivare il tuo stesso account.',
          code: 'CANNOT_SELF_DEACTIVATE',
        });
      }
      if (updates.status === 'rejected') {
        return res.status(400).json({
          error: 'Non puoi rifiutare il tuo stesso account.',
          code: 'CANNOT_SELF_REJECT',
        });
      }
    }

    // Anti-lockout: blocca la rimozione dell'ULTIMO admin attivo.
    const lockout = await checkAdminLockout(user, updates);
    if (!lockout.ok) {
      return res.status(409).json({ error: lockout.error, code: lockout.code });
    }

    // Reset password (gestito separatamente: NON è in pickAllowed perché viene
    // sotto un nome diverso `newPassword` e ha la propria policy).
    if (typeof req.body.newPassword === 'string' && PASSWORD_REGEX.test(req.body.newPassword)) {
      updates.passwordHash = req.body.newPassword;
      // Bump tokenVersion: un reset forzato dall'admin deve invalidare TUTTI
      // i JWT già emessi per l'utente (es. dopo sospetta compromissione),
      // altrimenti le sessioni del vecchio possessore restano valide fino a scadenza.
      updates.tokenVersion = (user.tokenVersion ?? 0) + 1;
    } else if (typeof req.body.newPassword === 'string') {
      // Stringa fornita ma non conforme alla policy → errore esplicito (vs ignorare).
      return res.status(400).json({
        error: PASSWORD_POLICY_MSG,
        code: 'PASSWORD_POLICY',
      });
    }

    await user.update(updates);
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: err.message, code: err.code, field: err.field });
    }
    next(err);
  }
});

// Elimina utente (cascade applicativo: rimuove anche le sue prenotazioni)
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Utente non trovato', code: 'USER_NOT_FOUND' });
    if (user.id === req.user.id) {
      return res
        .status(400)
        .json({ error: 'Non puoi eliminare te stesso', code: 'CANNOT_DELETE_SELF' });
    }
    // Anti-lockout: cancellare un admin equivale a un "demote totale".
    const lockout = await checkAdminLockout(user, { isActive: false });
    if (!lockout.ok) {
      return res.status(409).json({ error: lockout.error, code: lockout.code });
    }
    const result = await sequelize.transaction(async (t) => {
      const removedBookings = await Booking.destroy({
        where: { userId: user.id },
        transaction: t,
      });
      // User è paranoid (soft-delete): la CASCADE dell'FK non scatta.
      // Eliminiamo esplicitamente le proposte Monte Ore per evitare che
      // restino orfane nella pagina "Gestione Monte ore" dopo la cancellazione.
      // Schedules/slots/amendments seguono via CASCADE (tabelle non paranoid).
      const removedMonteOreProposals = await MonteOreProposal.destroy({
        where: { userId: user.id },
        transaction: t,
      });
      await user.destroy({ transaction: t });
      return { removedBookings, removedMonteOreProposals };
    });
    res.json({
      message: 'Utente eliminato',
      removedBookings: result.removedBookings,
      removedMonteOreProposals: result.removedMonteOreProposals,
    });
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({
        error: "Impossibile eliminare: l'utente è ancora referenziato da altri dati.",
        code: 'FK_CONSTRAINT',
      });
    }
    next(err);
  }
});

// Bulk approve/reject utenti pending (admin). Body: { ids[], action: 'approve'|'reject' }.
// Aggiorna status su utenti che sono ancora in stato 'pending'; ignora gli altri.
// Risponde con { changed, skipped }.
router.post('/bulk-approve', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const action = req.body?.action;
    if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'Azione non valida', code: 'VALIDATION_FAILED' });
    }
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const [changed] = await User.update(
      { status: newStatus },
      { where: { id: { [Op.in]: ids }, status: 'pending' } },
    );
    res.json({ changed, skipped: ids.length - changed });
  } catch (err) {
    next(err);
  }
});

// Bulk delete utenti (admin) — registrato come route esplicita, in transazione
router.post('/bulk-delete', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
    if (ids.includes(req.user.id)) {
      return res.status(400).json({
        error: 'Non puoi includere te stesso nella selezione',
        code: 'CANNOT_DELETE_SELF',
      });
    }
    // Anti-lockout: la selezione bulk non deve azzerare gli admin attivi.
    const adminsInSelection = await User.count({
      where: { id: { [Op.in]: ids }, role: 'admin', isActive: true, status: 'approved' },
    });
    if (adminsInSelection > 0) {
      const totalActiveAdmins = await User.count({
        where: { role: 'admin', isActive: true, status: 'approved' },
      });
      if (totalActiveAdmins - adminsInSelection < 1) {
        return res.status(409).json({
          error:
            "Operazione bloccata: la selezione lascerebbe l'istituto senza amministratori. " +
            'Promuovi prima un altro utente ad admin o rimuovi gli admin dalla selezione.',
          code: 'LAST_ADMIN_LOCKOUT',
        });
      }
    }
    const result = await sequelize.transaction(async (t) => {
      const removedBookings = await Booking.destroy({
        where: { userId: { [Op.in]: ids } },
        transaction: t,
      });
      // Vedi nota in DELETE /:id: User paranoid → la CASCADE FK non scatta,
      // serve eliminare a mano le proposte Monte Ore.
      const removedMonteOreProposals = await MonteOreProposal.destroy({
        where: { userId: { [Op.in]: ids } },
        transaction: t,
      });
      const deleted = await User.destroy({
        where: { id: { [Op.in]: ids } },
        transaction: t,
      });
      return { deleted, removedBookings, removedMonteOreProposals };
    });
    res.json(result);
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({
        error: 'Eliminazione bloccata da vincoli di integrità.',
      });
    }
    next(err);
  }
});

// =====================================================
// Magic-link primo accesso (post-import Isidata / bulk admin)
// =====================================================
//
// Pattern d'uso:
//   1) Post-apply Isidata: il frontend riceve `createdUserIds` e chiama
//      `send-setup-links-bulk` per spedire a tutti i nuovi un email con
//      link "imposta la tua password".
//   2) Manuale: l'admin in pagina Utenti seleziona N righe e clicca
//      "Invia link di primo accesso" (stesso endpoint bulk).
//   3) Singolo (`POST /:id/send-setup-link`): ricerca puntuale per un utente
//      specifico, es. "ha perso la mail, rimandagliela".
//
// Il service `sendSetupLink` invalida i token precedenti dello stesso
// purpose e ne emette uno nuovo (single-valid-link). Idempotency outbox
// previene doppi invii accidentali entro il minuto.

function validateTtlDays(raw) {
  if (raw == null) return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < TTL_SETUP_MIN_DAYS || n > TTL_SETUP_MAX_DAYS) {
    return {
      ok: false,
      error: `ttlDays deve essere tra ${TTL_SETUP_MIN_DAYS} e ${TTL_SETUP_MAX_DAYS}`,
      code: 'INVALID_TTL',
    };
  }
  return { ok: true, value: Math.round(n) };
}

// POST /api/users/:id/send-setup-link
// Body: { ttlDays?: 1..90 }
router.post('/:id/send-setup-link', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id non valido', code: 'INVALID_ID' });
    }
    const ttlCheck = validateTtlDays(req.body?.ttlDays);
    if (!ttlCheck.ok) return res.status(400).json({ error: ttlCheck.error, code: ttlCheck.code });

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'Utente non trovato', code: 'NOT_FOUND' });
    if (user.passwordHash) {
      return res.status(400).json({
        error: 'Utente con password già impostata: usa il flusso reset',
        code: 'USER_HAS_PASSWORD',
      });
    }

    const r = await sendSetupLink({
      user,
      purpose: PURPOSE_INITIAL_SETUP,
      ttlDays: ttlCheck.value,
      requestIp: req.ip,
      requestUserAgent: req.get('user-agent'),
    });
    if (!r.ok) {
      logger.warn({ userId: id, err: r.error, scope: 'admin.send_setup_link' }, 'send fallito');
      return res.status(502).json({ error: r.error, code: r.code || 'SEND_FAILED' });
    }
    return res.json({ sent: true, expiresAt: r.expiresAt });
  } catch (err) {
    logger.error({ err: err.message, scope: 'admin.send_setup_link' }, 'errore');
    return res.status(500).json({ error: 'Errore invio link', code: 'INTERNAL' });
  }
});

// POST /api/users/send-setup-links-bulk
// Body: { userIds: number[], ttlDays?: number, onlyMissingPassword?: boolean }
const BULK_MAX = 1000;
router.post('/send-setup-links-bulk', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    const onlyMissingPassword = req.body?.onlyMissingPassword !== false; // default true
    if (userIds.length === 0) {
      return res.status(400).json({ error: 'userIds vuoto', code: 'EMPTY_LIST' });
    }
    if (userIds.length > BULK_MAX) {
      return res
        .status(400)
        .json({ error: `userIds supera il massimo (${BULK_MAX})`, code: 'TOO_MANY' });
    }
    const ids = userIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'userIds non validi', code: 'INVALID_LIST' });
    }
    const ttlCheck = validateTtlDays(req.body?.ttlDays);
    if (!ttlCheck.ok) return res.status(400).json({ error: ttlCheck.error, code: ttlCheck.code });

    const users = await User.findAll({ where: { id: { [Op.in]: ids } } });
    const reasons = { USER_HAS_PASSWORD: 0, INVALID_EMAIL: 0, SEND_FAILED: 0, NOT_FOUND: 0 };
    let sent = 0;
    let skipped = 0;

    const foundIds = new Set(users.map((u) => u.id));
    for (const id of ids) {
      if (!foundIds.has(id)) {
        reasons.NOT_FOUND += 1;
        skipped += 1;
      }
    }

    for (const user of users) {
      if (onlyMissingPassword && user.passwordHash) {
        reasons.USER_HAS_PASSWORD += 1;
        skipped += 1;
        continue;
      }
      if (!user.email) {
        reasons.INVALID_EMAIL += 1;
        skipped += 1;
        continue;
      }
      const r = await sendSetupLink({
        user,
        purpose: PURPOSE_INITIAL_SETUP,
        ttlDays: ttlCheck.value,
        requestIp: req.ip,
        requestUserAgent: req.get('user-agent'),
      });
      if (r.ok) {
        sent += 1;
      } else {
        reasons.SEND_FAILED += 1;
        skipped += 1;
      }
    }

    logger.info(
      { sent, skipped, ids: ids.length, scope: 'admin.send_setup_link_bulk' },
      'bulk setup link completato',
    );
    return res.json({ sent, skipped, skippedReasons: reasons });
  } catch (err) {
    logger.error({ err: err.message, scope: 'admin.send_setup_link_bulk' }, 'errore');
    return res.status(500).json({ error: 'Errore invio bulk', code: 'INTERNAL' });
  }
});

module.exports = router;
