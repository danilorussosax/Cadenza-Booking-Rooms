'use strict';

const express = require('express');
const { withSerializableRetry } = require('../lib/serializableTx');
const dayjs = require('dayjs');
const institutionTime = require('../lib/institutionTime');
const { Op, Transaction } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { sequelize, Instrument, InstrumentLoan, User } = require('../models');
const { authenticate, requireRole, requireApproved } = require('../middleware/auth');
const { sendInstrumentLoanEmail } = require('../services/instrumentLoanEmail');
const { buildInstrumentLoanPdf } = require('../services/instrumentLoanPdf');
const { parsePagination, setPaginationHeaders } = require('../lib/pagination');
const { utils: instrumentsUtils } = require('./instruments');
const { domainError } = require('../lib/domainError');
const { annotateStatus } = instrumentsUtils;

const router = express.Router();

const userPublicAttrs = ['id', 'firstName', 'lastName', 'email', 'matricola', 'role'];

// Include riusabile per i listing admin: instrument + user + approver.
// Centralizzato qui per evitare di duplicare la lista in 4 endpoint diversi
// (con il rischio che una modifica ne dimentichi qualcuno).
function loanAdminIncludes() {
  return [
    { model: Instrument, as: 'instrument' },
    { model: User, as: 'user', attributes: userPublicAttrs },
    { model: User, as: 'approver', attributes: userPublicAttrs },
  ];
}

// Costruisce un loan completo con relazioni e status calcolato
async function findLoanFull(id) {
  const loan = await InstrumentLoan.findByPk(id, {
    include: loanAdminIncludes(),
  });
  return loan;
}

// =========================================================
// Listing prestiti
// =========================================================

// GET /api/loans/mine — i miei prestiti (storico + attivi)
router.get('/mine', authenticate, async (req, res) => {
  const loans = await InstrumentLoan.findAll({
    where: { userId: req.user.id },
    include: [{ model: Instrument, as: 'instrument' }],
    order: [['fromDate', 'DESC']],
  });
  res.json({ loans: loans.map((l) => annotateStatus(l)) });
});

// GET /api/loans — tutti i prestiti (admin)
//   Filtri: status (requested|active|returned|overdue|rejected), userId, instrumentId
//   Pagination: ?limit=&offset= (default 100, max 500). Header
//   X-Total-Count/X-Limit/X-Offset esposti via lib/pagination.
//   Senza limit, su un istituto con migliaia di prestiti storici, la response
//   cresceva linearmente e drenava memoria del processo.
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.userId) {
    const n = Number.parseInt(req.query.userId, 10);
    if (Number.isInteger(n)) where.userId = n;
  }
  if (req.query.instrumentId) {
    const n = Number.parseInt(req.query.instrumentId, 10);
    if (Number.isInteger(n)) where.instrumentId = n;
  }

  const { limit, offset } = parsePagination(req.query);
  const { rows, count } = await InstrumentLoan.findAndCountAll({
    where,
    include: loanAdminIncludes(),
    order: [['fromDate', 'DESC']],
    limit,
    offset,
    distinct: true, // count corretto in presenza di JOIN su user/instrument
  });
  setPaginationHeaders(res, count, limit, offset);
  res.json({ loans: rows.map((l) => annotateStatus(l)) });
});

// GET /api/loans/overdue — prestiti scaduti (admin)
//   Comprende sia gli "active" oltre toDate sia quelli già marcati "overdue".
router.get('/overdue', authenticate, requireRole('admin'), async (req, res) => {
  const today = institutionTime.todayIso();
  const loans = await InstrumentLoan.findAll({
    where: {
      [Op.or]: [{ status: 'overdue' }, { status: 'active', toDate: { [Op.lt]: today } }],
    },
    include: loanAdminIncludes(),
    order: [['toDate', 'ASC']],
  });
  res.json({ loans: loans.map((l) => annotateStatus(l)) });
});

// GET /api/loans/expiring?days=2 — in scadenza nei prossimi N giorni (admin)
router.get('/expiring', authenticate, requireRole('admin'), async (req, res) => {
  const days = Math.max(1, Math.min(30, Number(req.query.days || 2)));
  const today = institutionTime.todayIso();
  const limit = institutionTime.inInstitute().add(days, 'day').format('YYYY-MM-DD');
  const loans = await InstrumentLoan.findAll({
    where: {
      status: 'active',
      toDate: { [Op.between]: [today, limit] },
    },
    include: loanAdminIncludes(),
    order: [['toDate', 'ASC']],
  });
  res.json({ loans: loans.map((l) => annotateStatus(l)) });
});

// =========================================================
// Richieste utente
// =========================================================

// POST /api/loans — richiesta prestito (utente loggato e approvato)
router.post(
  '/',
  authenticate,
  requireApproved,
  [
    body('instrumentId').isInt(),
    body('fromDate').isISO8601(),
    body('toDate').isISO8601(),
    body('notes').optional({ nullable: true }).isString(),
  ],
  async (req, res, next) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      throw domainError('VALIDATION_FAILED', 'Validazione fallita', { details: errs.array() });
    const { instrumentId, fromDate, toDate, notes } = req.body;

    const start = dayjs(fromDate);
    const end = dayjs(toDate);
    if (!start.isValid() || !end.isValid()) {
      throw domainError('LOAN_INVALID_DATE', 'Date non valide');
    }
    if (end.isBefore(start)) {
      throw domainError(
        'LOAN_INVALID_DATE',
        'La data di restituzione deve essere successiva alla data di inizio',
      );
    }
    if (start.isBefore(institutionTime.startOfDay())) {
      throw domainError('LOAN_INVALID_DATE', 'Non puoi richiedere un prestito nel passato');
    }

    const instrument = await Instrument.findByPk(instrumentId);
    if (!instrument) throw domainError('NOT_FOUND', 'Strumento non trovato', { status: 404 });
    if (!instrument.isLoanable) {
      throw domainError('INSTRUMENT_NOT_LOANABLE', 'Strumento non disponibile per il prestito');
    }
    if (instrument.condition === 'fuori_uso' || instrument.condition === 'da_riparare') {
      throw domainError('INSTRUMENT_NOT_LOANABLE', 'Strumento non disponibile (condizione)');
    }

    // Verifica regola di abilitazione PER STRUMENTO. Coerente con
    // Room.allowedCourseIds: array vuoto = permissivo (chiunque non admin
    // con profilo completo può richiedere). Gli admin bypassano sempre.
    if (req.user.role !== 'admin') {
      const allowedCourseIds = Array.isArray(instrument.allowedCourseIds)
        ? instrument.allowedCourseIds
        : [];
      if (allowedCourseIds.length > 0) {
        if (!req.user.courseId || !allowedCourseIds.includes(req.user.courseId)) {
          throw domainError(
            'INSTRUMENT_NOT_ALLOWED_FOR_COURSE',
            'Il tuo corso non è abilitato a richiedere il prestito di questo strumento',
            { status: 403 },
          );
        }
      }
    }

    // Conflict check + create in transazione SERIALIZABLE (Postgres) o
    // default (SQLite/MySQL): senza tx due request concorrenti sullo stesso
    // strumento nello stesso intervallo passavano entrambe la check di
    // sovrapposizione e creavano DUE loan attivi sullo stesso item.
    try {
      const txOpts =
        sequelize.getDialect() === 'postgres'
          ? { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }
          : {};
      const loan = await withSerializableRetry(sequelize, txOpts, async (t) => {
        const conflict = await InstrumentLoan.findOne({
          where: {
            instrumentId,
            status: { [Op.in]: ['requested', 'active', 'overdue'] },
            // overlap: not (existing.to < newFrom OR existing.from > newTo)
            [Op.and]: [
              { fromDate: { [Op.lte]: end.format('YYYY-MM-DD') } },
              { toDate: { [Op.gte]: start.format('YYYY-MM-DD') } },
            ],
          },
          transaction: t,
        });
        if (conflict) {
          throw domainError('LOAN_CONFLICT', 'Lo strumento è già impegnato nel periodo richiesto', {
            status: 409,
          });
        }

        // Quote prestiti per ruolo (vedi services/loanQuotaValidator.js).
        // Eseguito DENTRO la stessa tx per coerenza con la conflict check.
        if (req.user.role !== 'admin') {
          const { checkLoanQuotas } = require('../services/loanQuotaValidator');
          const quotaIssues = await checkLoanQuotas({
            user: req.user,
            instrument,
            fromDate: start.format('YYYY-MM-DD'),
            toDate: end.format('YYYY-MM-DD'),
            transaction: t,
          });
          if (quotaIssues.length > 0) {
            const first = quotaIssues[0];
            throw domainError(first.code, first.message, {
              status: 409,
              details: quotaIssues.map((i) => ({ message: i.message, code: i.code })),
            });
          }
        }

        return InstrumentLoan.create(
          {
            instrumentId,
            userId: req.user.id,
            fromDate: start.format('YYYY-MM-DD'),
            toDate: end.format('YYYY-MM-DD'),
            notes: notes || null,
            status: 'requested',
          },
          { transaction: t },
        );
      });
      const full = await findLoanFull(loan.id);
      sendInstrumentLoanEmail({ user: full.user, loan: full, kind: 'loan_requested' }).catch(
        () => {},
      );
      res.status(201).json({ loan: annotateStatus(full) });
    } catch (err) {
      next(err);
    }
  },
);

// =========================================================
// Azioni admin: approve / reject
// =========================================================

router.post('/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  // UPDATE atomico: solo se status='requested' (uno solo dei 2 admin che
  // cliccano simultaneamente passa).
  const [affected] = await InstrumentLoan.update(
    { status: 'active', approvedBy: req.user.id, approvedAt: new Date() },
    { where: { id: req.params.id, status: 'requested' } },
  );
  if (affected === 0) {
    const exists = await InstrumentLoan.findByPk(req.params.id);
    if (!exists) throw domainError('NOT_FOUND', 'Prestito non trovato', { status: 404 });
    throw domainError('LOAN_INVALID_STATE', "Stato non valido per l'approvazione");
  }
  const full = await findLoanFull(req.params.id);
  sendInstrumentLoanEmail({ user: full.user, loan: full, kind: 'loan_approved' }).catch(() => {});
  res.json({ loan: annotateStatus(full) });
});

router.post('/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  const [affected] = await InstrumentLoan.update(
    { status: 'rejected', approvedBy: req.user.id, approvedAt: new Date() },
    { where: { id: req.params.id, status: 'requested' } },
  );
  if (affected === 0) {
    const exists = await InstrumentLoan.findByPk(req.params.id);
    if (!exists) throw domainError('NOT_FOUND', 'Prestito non trovato', { status: 404 });
    throw domainError('LOAN_INVALID_STATE', 'Stato non valido per il rifiuto');
  }
  const full = await findLoanFull(req.params.id);
  sendInstrumentLoanEmail({ user: full.user, loan: full, kind: 'loan_rejected' }).catch(() => {});
  res.json({ loan: annotateStatus(full) });
});

// =========================================================
// Restituzione (utente proprietario o admin)
// =========================================================

router.post('/:id/return', authenticate, async (req, res) => {
  const loan = await findLoanFull(req.params.id);
  if (!loan) throw domainError('NOT_FOUND', 'Prestito non trovato', { status: 404 });
  if (loan.userId !== req.user.id && req.user.role !== 'admin') {
    throw domainError('FORBIDDEN', 'Non autorizzato', { status: 403 });
  }
  // UPDATE atomico con WHERE status IN (active, overdue): se due richieste
  // concorrenti tentano il return, una sola restituisce affectedRows=1.
  // L'altra vede affectedRows=0 → "già restituito" senza dover ricaricare.
  const [affected] = await InstrumentLoan.update(
    { status: 'returned', returnedAt: new Date() },
    {
      where: {
        id: loan.id,
        status: { [Op.in]: ['active', 'overdue'] },
      },
    },
  );
  if (affected === 0) {
    // Diagnosi: ricarica per dare messaggio specifico
    const fresh = await InstrumentLoan.findByPk(loan.id);
    if (fresh?.status === 'returned') {
      throw domainError('LOAN_ALREADY_RETURNED', 'Prestito già restituito');
    }
    throw domainError('LOAN_INVALID_STATE', 'Stato non valido per la restituzione');
  }
  const full = await findLoanFull(loan.id);
  sendInstrumentLoanEmail({ user: full.user, loan: full, kind: 'loan_returned' }).catch(() => {});
  res.json({ loan: annotateStatus(full) });
});

// =========================================================
// Cancellazione richiesta da parte dell'utente (solo se ancora "requested")
// =========================================================
router.delete('/:id', authenticate, async (req, res) => {
  const loan = await InstrumentLoan.findByPk(req.params.id);
  if (!loan) throw domainError('NOT_FOUND', 'Prestito non trovato', { status: 404 });
  if (loan.userId !== req.user.id && req.user.role !== 'admin') {
    throw domainError('FORBIDDEN', 'Non autorizzato', { status: 403 });
  }
  // Solo admin può cancellare un prestito già attivo/restituito (per pulizia inventario);
  // l'utente può solo cancellare la propria richiesta in attesa.
  if (req.user.role !== 'admin' && loan.status !== 'requested') {
    throw domainError('LOAN_INVALID_STATE', 'Puoi cancellare solo richieste ancora in attesa');
  }
  const removed = await InstrumentLoan.destroy({
    where: {
      id: loan.id,
      ...(req.user.role === 'admin' ? {} : { userId: req.user.id, status: 'requested' }),
    },
  });
  if (!removed)
    throw domainError('LOAN_INVALID_STATE', 'Lo stato del prestito è cambiato', { status: 409 });
  res.json({ message: 'Prestito eliminato' });
});

// =========================================================
// PDF di consegna/restituzione
// =========================================================
//   GET /api/loans/:id/pdf?kind=delivery|return
router.get('/:id/pdf', authenticate, async (req, res, next) => {
  try {
    const loan = await findLoanFull(req.params.id);
    if (!loan) throw domainError('NOT_FOUND', 'Prestito non trovato', { status: 404 });
    if (loan.userId !== req.user.id && req.user.role !== 'admin') {
      throw domainError('FORBIDDEN', 'Non autorizzato', { status: 403 });
    }
    const kind = req.query.kind === 'return' ? 'return' : 'delivery';

    const { Institute } = require('../models');
    const institute = await Institute.findOne({ order: [['id', 'ASC']] }).catch(() => null);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="prestito-${loan.id}-${kind}.pdf"`);
    buildInstrumentLoanPdf({ res, loan, institute, kind });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
