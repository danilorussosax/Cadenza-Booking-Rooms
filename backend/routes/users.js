'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { stringify: csvStringify } = require('csv-stringify/sync');
const { sequelize, User, Course, Booking } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { parseCSV } = require('../services/structureImporter');

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
        const existing = await User.findOne({ where: { email } });
        if (existing) {
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
            password: hash,
          });
          result.created++;
        }
      } catch (err) {
        lineMsg(err.message || 'Errore creazione/aggiornamento');
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

// Lista utenti (admin)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const where = {};
  if (req.query.role) where.role = req.query.role;
  if (req.query.active) where.isActive = req.query.active === 'true';
  if (req.query.status) where.status = req.query.status;

  const users = await User.findAll({
    where,
    include: [{ model: Course, as: 'course' }],
    order: [['lastName', 'ASC']],
  });
  res.json({ users: users.map((u) => u.toSafeJSON()) });
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

// Modifica utente (admin: può cambiare ruolo, attivare/disattivare, ecc.)
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato', code: 'USER_NOT_FOUND' });

  const allowed = ['firstName', 'lastName', 'role', 'matricola', 'courseId', 'isActive', 'status'];
  const updates = {};
  for (const k of allowed) if (k in req.body) updates[k] = req.body[k];

  // Se viene resettata la password
  if (req.body.newPassword && req.body.newPassword.length >= 8) {
    updates.passwordHash = req.body.newPassword;
  }

  await user.update(updates);
  res.json({ user: user.toSafeJSON() });
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
    const result = await sequelize.transaction(async (t) => {
      const removedBookings = await Booking.destroy({
        where: { userId: user.id },
        transaction: t,
      });
      await user.destroy({ transaction: t });
      return removedBookings;
    });
    res.json({ message: 'Utente eliminato', removedBookings: result });
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
    const result = await sequelize.transaction(async (t) => {
      const removedBookings = await Booking.destroy({
        where: { userId: { [Op.in]: ids } },
        transaction: t,
      });
      const deleted = await User.destroy({
        where: { id: { [Op.in]: ids } },
        transaction: t,
      });
      return { deleted, removedBookings };
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
