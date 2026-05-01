'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { stringify: csvStringify } = require('csv-stringify/sync');
const { sequelize, User, Course, Booking, MonteOreProposal, ContractType } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { parseCSV } = require('../services/structureImporter');
const { pickAllowed, ValidationError } = require('../lib/sanitize');
const { parsePagination, setPaginationHeaders } = require('../lib/pagination');

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
// IMPORT CSV utenti (admin)
// Body: { csv: string }
// Colonne riconosciute (case-insensitive): Email*, Cognome*, Nome*, Ruolo*
// (admin/docente/studente), Matricola, CodiceCorso (SAD lookup → courseId),
// Stato (pending/approved/rejected; default approved), Attivo (si/no).
// L'import imposta una password temporanea casuale (32 byte hex) per ogni
// nuovo utente: l'admin deve comunicare reset password / 2FA email.
// Idempotente: upsert su email. Per utenti esistenti aggiorna solo i campi
// presenti nel CSV, NON tocca password.
// =====================================================
const HEADER_MAP_USERS = {
  email: 'email',
  'e-mail': 'email',
  mail: 'email',
  cognome: 'lastName',
  'last name': 'lastName',
  lastname: 'lastName',
  surname: 'lastName',
  nome: 'firstName',
  'first name': 'firstName',
  firstname: 'firstName',
  ruolo: 'role',
  role: 'role',
  matricola: 'matricola',
  badge: 'matricola',
  codicecorso: 'courseCode',
  'codice corso': 'courseCode',
  corso: 'courseCode',
  sad: 'courseCode',
  stato: 'status',
  status: 'status',
  attivo: 'isActive',
  active: 'isActive',
  'is active': 'isActive',
};
const VALID_ROLES = ['admin', 'docente', 'studente'];
const VALID_STATUSES = ['pending', 'approved', 'rejected'];

function parseBoolUser(v, def = true) {
  if (v == null || v === '') return def;
  const s = String(v).trim().toLowerCase();
  if (['no', 'false', '0', 'n', 'off'].includes(s)) return false;
  if (['si', 'sì', 'yes', 'true', '1', 'y', 'on', 'x'].includes(s)) return true;
  return def;
}

router.post('/import', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    if (!csv.trim()) return res.status(400).json({ error: 'Body "csv" mancante' });

    const matrix = parseCSV(csv);
    if (matrix.length < 2) {
      return res
        .status(400)
        .json({ error: "CSV deve contenere almeno una riga oltre all'intestazione" });
    }
    const headers = matrix[0].map((h) =>
      String(h || '')
        .trim()
        .toLowerCase(),
    );
    const dataRows = matrix.slice(1).map((cells, idx) => {
      const obj = { _line: idx + 2 };
      headers.forEach((h, i) => {
        const key = HEADER_MAP_USERS[h] || h;
        const val = (cells[i] || '').trim();
        if (val !== '') obj[key] = val;
      });
      return obj;
    });

    // Cache courses per SAD lookup
    const courses = await Course.findAll({ attributes: ['id', 'code'] });
    const courseByCode = new Map(courses.map((c) => [c.code.toLowerCase(), c.id]));

    const result = {
      parsed: dataRows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    for (const r of dataRows) {
      const lineMsg = (msg) => result.errors.push({ line: r._line, msg });
      if (!r.email) {
        lineMsg('email mancante');
        result.skipped++;
        continue;
      }
      if (!r.firstName || !r.lastName) {
        lineMsg('nome o cognome mancante');
        result.skipped++;
        continue;
      }
      const role = (r.role || '').toLowerCase();
      if (!VALID_ROLES.includes(role)) {
        lineMsg(`ruolo "${r.role}" non valido (admin/docente/studente)`);
        result.skipped++;
        continue;
      }
      const status =
        r.status && VALID_STATUSES.includes(r.status.toLowerCase())
          ? r.status.toLowerCase()
          : 'approved';
      const courseId = r.courseCode ? (courseByCode.get(r.courseCode.toLowerCase()) ?? null) : null;
      if (r.courseCode && courseId == null) {
        lineMsg(`codice corso "${r.courseCode}" non trovato (utente importato senza corso)`);
      }
      const email = r.email.toLowerCase().trim();

      try {
        // paranoid:false → trova anche utenti soft-deleted con stessa email
        // (altrimenti scatta unique violation sull'INSERT successivo).
        const existing = await User.findOne({ where: { email }, paranoid: false });
        if (existing) {
          if (existing.deletedAt) await existing.restore();
          await existing.update({
            firstName: r.firstName,
            lastName: r.lastName,
            role,
            matricola: r.matricola || existing.matricola,
            courseId,
            status,
            isActive: parseBoolUser(r.isActive, existing.isActive),
          });
          result.updated++;
        } else {
          // Password temporanea casuale: l'admin DEVE invitare l'utente al
          // reset password (oppure usare 2FA email per primo accesso).
          const tempPassword = crypto.randomBytes(16).toString('hex');
          const hash = await bcrypt.hash(tempPassword, 12);
          await User.create({
            email,
            firstName: r.firstName,
            lastName: r.lastName,
            role,
            matricola: r.matricola || null,
            courseId,
            status,
            isActive: parseBoolUser(r.isActive, true),
            // Il modello User ha campo `passwordHash` (non `password`). Bug
            // pre-esistente: gli utenti importati avevano passwordHash NULL
            // e non potevano loggare nemmeno con reset.
            passwordHash: hash,
          });
          result.created++;
        }
      } catch (err) {
        // Estrai dettagli da errori Sequelize per non mostrare solo "Validation error"
        let msg = err?.message || 'Errore creazione/aggiornamento';
        if (
          err?.name === 'SequelizeValidationError' &&
          Array.isArray(err.errors) &&
          err.errors.length
        ) {
          msg = err.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
        } else if (err?.name === 'SequelizeUniqueConstraintError') {
          const fields = Array.isArray(err.errors)
            ? err.errors.map((e) => e.path).join(', ')
            : Object.keys(err.fields || {}).join(', ');
          msg = `Vincolo unique violato (${fields || '?'})`;
        }
        lineMsg(msg);
        result.skipped++;
      }
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Crea utente manualmente (admin) — sempre creato come 'approved'.
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { firstName, lastName, email, password, role, matricola, courseId, isActive } = req.body;

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return res
      .status(400)
      .json({ error: 'Nome, cognome ed email sono obbligatori', code: 'VALIDATION_FAILED' });
  }
  if (!password || password.length < 8) {
    return res
      .status(400)
      .json({ error: 'La password deve essere di almeno 8 caratteri', code: 'PASSWORD_TOO_SHORT' });
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

      await user.update({
        contractType: contractType || null,
        monteOreAnnualHoursOverride: hoursOverride,
        monteOreBypassDayConstraint: bypass,
        // Se nessuna deroga è attiva, azzeriamo reason/setBy/setAt per pulizia.
        monteOreOverrideReason: settingOverride ? reason : null,
        monteOreOverrideSetAt: settingOverride ? new Date() : null,
        monteOreOverrideSetBy: settingOverride ? req.user.id : null,
      });

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
    if (typeof req.body.newPassword === 'string' && req.body.newPassword.length >= 8) {
      updates.passwordHash = req.body.newPassword;
    } else if (typeof req.body.newPassword === 'string') {
      // Stringa fornita ma troppo corta → errore esplicito (vs ignorare).
      return res.status(400).json({
        error: 'La password deve avere almeno 8 caratteri',
        code: 'PASSWORD_TOO_SHORT',
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

module.exports = router;
