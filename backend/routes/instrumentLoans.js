'use strict';

const express = require('express');
const dayjs = require('dayjs');
const { Op, Transaction } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { sequelize, Instrument, InstrumentLoan, User } = require('../models');
const { authenticate, requireRole, requireApproved } = require('../middleware/auth');
const { sendInstrumentLoanEmail } = require('../services/instrumentLoanEmail');
const { buildInstrumentLoanPdf } = require('../services/instrumentLoanPdf');
const { parsePagination, setPaginationHeaders } = require('../lib/pagination');
const { utils: instrumentsUtils } = require('./instruments');
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
  const today = dayjs().format('YYYY-MM-DD');
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
  const today = dayjs().format('YYYY-MM-DD');
  const limit = dayjs().add(days, 'day').format('YYYY-MM-DD');
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
      return res
        .status(400)
        .json({ error: 'Validazione fallita', details: errs.array(), code: 'VALIDATION_FAILED' });
    const { instrumentId, fromDate, toDate, notes } = req.body;

    const start = dayjs(fromDate);
    const end = dayjs(toDate);
    if (!start.isValid() || !end.isValid()) {
      return res.status(400).json({ error: 'Date non valide', code: 'LOAN_INVALID_DATE' });
    }
    if (end.isBefore(start)) {
      return res.status(400).json({
        error: 'La data di restituzione deve essere successiva alla data di inizio',
        code: 'LOAN_INVALID_DATE',
      });
    }
    if (start.isBefore(dayjs().startOf('day'))) {
      return res
        .status(400)
        .json({ error: 'Non puoi richiedere un prestito nel passato', code: 'LOAN_INVALID_DATE' });
    }

    const instrument = await Instrument.findByPk(instrumentId);
    if (!instrument)
      return res.status(404).json({ error: 'Strumento non trovato', code: 'NOT_FOUND' });
    if (!instrument.isLoanable) {
      return res.status(400).json({
        error: 'Strumento non disponibile per il prestito',
        code: 'INSTRUMENT_NOT_LOANABLE',
      });
    }
    if (instrument.condition === 'fuori_uso' || instrument.condition === 'da_riparare') {
      return res
        .status(400)
        .json({ error: 'Strumento non disponibile (condizione)', code: 'INSTRUMENT_NOT_LOANABLE' });
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
          return res.status(403).json({
            error: 'Il tuo corso non è abilitato a richiedere il prestito di questo strumento',
            code: 'INSTRUMENT_NOT_ALLOWED_FOR_COURSE',
          });
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
      const loan = await sequelize.transaction(txOpts, async (t) => {
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
          const e = new Error('Lo strumento è già impegnato nel periodo richiesto');
          e.status = 409;
          e.code = 'LOAN_CONFLICT';
          throw e;
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
          });
          if (quotaIssues.length > 0) {
            const first = quotaIssues[0];
            const e = new Error(first.message);
            e.status = 409;
            e.code = first.code;
            e.details = quotaIssues.map((i) => ({ message: i.message, code: i.code }));
            throw e;
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
      if (err.status) {
        const body = { error: err.message, code: err.code };
        if (err.details) body.details = err.details;
        return res.status(err.status).json(body);
      }
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
    if (!exists) return res.status(404).json({ error: 'Prestito non trovato', code: 'NOT_FOUND' });
    return res
      .status(400)
      .json({ error: "Stato non valido per l'approvazione", code: 'LOAN_INVALID_STATE' });
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
    if (!exists) return res.status(404).json({ error: 'Prestito non trovato', code: 'NOT_FOUND' });
    return res
      .status(400)
      .json({ error: 'Stato non valido per il rifiuto', code: 'LOAN_INVALID_STATE' });
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
  if (!loan) return res.status(404).json({ error: 'Prestito non trovato', code: 'NOT_FOUND' });
  if (loan.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorizzato', code: 'FORBIDDEN' });
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
      return res
        .status(400)
        .json({ error: 'Prestito già restituito', code: 'LOAN_ALREADY_RETURNED' });
    }
    return res
      .status(400)
      .json({ error: 'Stato non valido per la restituzione', code: 'LOAN_INVALID_STATE' });
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
  if (!loan) return res.status(404).json({ error: 'Prestito non trovato', code: 'NOT_FOUND' });
  if (loan.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorizzato', code: 'FORBIDDEN' });
  }
  // Solo admin può cancellare un prestito già attivo/restituito (per pulizia inventario);
  // l'utente può solo cancellare la propria richiesta in attesa.
  if (req.user.role !== 'admin' && loan.status !== 'requested') {
    return res.status(400).json({
      error: 'Puoi cancellare solo richieste ancora in attesa',
      code: 'LOAN_INVALID_STATE',
    });
  }
  await loan.destroy();
  res.json({ message: 'Prestito eliminato' });
});

// =========================================================
// PDF di consegna/restituzione
// =========================================================
//   GET /api/loans/:id/pdf?kind=delivery|return
router.get('/:id/pdf', authenticate, async (req, res, next) => {
  try {
    const loan = await findLoanFull(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Prestito non trovato', code: 'NOT_FOUND' });
    if (loan.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Non autorizzato', code: 'FORBIDDEN' });
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
