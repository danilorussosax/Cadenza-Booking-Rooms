'use strict';

const express = require('express');
const institutionTime = require('../lib/institutionTime');
const { Op } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { Instrument, InstrumentLoan } = require('../models');
const { authenticate, requireRole, requireApproved } = require('../middleware/auth');
const { buildInstrumentLoanPdf } = require('../services/instrumentLoanPdf');
const { parsePagination, setPaginationHeaders } = require('../lib/pagination');
const loanLifecycle = require('../services/loanLifecycle');
const { domainError } = require('../lib/domainError');
const { assertCan } = require('../lib/access');
const { annotateStatus, loanAdminIncludes, findLoanFull } = loanLifecycle;

const router = express.Router();

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
    try {
      const full = await loanLifecycle.request({
        user: req.user,
        instrumentId,
        fromDate,
        toDate,
        notes,
      });
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
  const full = await loanLifecycle.approve({ id: req.params.id, actor: req.user });
  res.json({ loan: annotateStatus(full) });
});

router.post('/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  const full = await loanLifecycle.reject({ id: req.params.id, actor: req.user });
  res.json({ loan: annotateStatus(full) });
});

// =========================================================
// Restituzione (utente proprietario o admin)
// =========================================================

router.post('/:id/return', authenticate, async (req, res) => {
  const loan = await findLoanFull(req.params.id);
  if (!loan) throw domainError('NOT_FOUND', 'Prestito non trovato', { status: 404 });
  assertCan(req.user, 'loan:return', loan);
  const full = await loanLifecycle.returnLoan({ id: loan.id });
  res.json({ loan: annotateStatus(full) });
});

// =========================================================
// Cancellazione (utente: solo richiesta ancora "requested"; admin: sempre)
// =========================================================
router.delete('/:id', authenticate, async (req, res) => {
  const loan = await InstrumentLoan.findByPk(req.params.id);
  if (!loan) throw domainError('NOT_FOUND', 'Prestito non trovato', { status: 404 });
  assertCan(req.user, 'loan:cancel', loan);
  await loanLifecycle.cancel({ loan, actor: req.user });
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
    assertCan(req.user, 'loan:view', loan);
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
