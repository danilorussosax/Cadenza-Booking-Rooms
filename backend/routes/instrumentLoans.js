'use strict';

const express = require('express');
const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { sequelize, Instrument, InstrumentLoan, User } = require('../models');
const { authenticate, requireRole, requireApproved } = require('../middleware/auth');
const { sendInstrumentLoanEmail } = require('../services/instrumentLoanEmail');
const { buildInstrumentLoanPdf } = require('../services/instrumentLoanPdf');
const { utils: instrumentsUtils } = require('./instruments');
const { annotateStatus } = instrumentsUtils;

const router = express.Router();

const userPublicAttrs = ['id', 'firstName', 'lastName', 'email', 'matricola', 'role'];

// Costruisce un loan completo con relazioni e status calcolato
async function findLoanFull(id) {
  const loan = await InstrumentLoan.findByPk(id, {
    include: [
      { model: Instrument, as: 'instrument' },
      { model: User, as: 'user', attributes: userPublicAttrs },
      { model: User, as: 'approver', attributes: userPublicAttrs },
    ],
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
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.userId) where.userId = req.query.userId;
  if (req.query.instrumentId) where.instrumentId = req.query.instrumentId;

  const loans = await InstrumentLoan.findAll({
    where,
    include: [
      { model: Instrument, as: 'instrument' },
      { model: User, as: 'user', attributes: userPublicAttrs },
      { model: User, as: 'approver', attributes: userPublicAttrs },
    ],
    order: [['fromDate', 'DESC']],
  });
  res.json({ loans: loans.map((l) => annotateStatus(l)) });
});

// GET /api/loans/overdue — prestiti scaduti (admin)
//   Comprende sia gli "active" oltre toDate sia quelli già marcati "overdue".
router.get('/overdue', authenticate, requireRole('admin'), async (req, res) => {
  const today = dayjs().format('YYYY-MM-DD');
  const loans = await InstrumentLoan.findAll({
    where: {
      [Op.or]: [{ status: 'overdue' }, { status: 'active', toDate: { [Op.lt]: today } }],
    },
    include: [
      { model: Instrument, as: 'instrument' },
      { model: User, as: 'user', attributes: userPublicAttrs },
    ],
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
    include: [
      { model: Instrument, as: 'instrument' },
      { model: User, as: 'user', attributes: userPublicAttrs },
    ],
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

    // Conflitti: c'è già un prestito attivo/richiesto che si sovrappone all'intervallo
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
    });
    if (conflict) {
      return res.status(409).json({
        error: 'Lo strumento è già impegnato nel periodo richiesto',
        code: 'LOAN_CONFLICT',
      });
    }

    // Quote prestiti per ruolo (vedi services/loanQuotaValidator.js).
    // Gli admin sono esclusi a priori dal validatore.
    if (req.user.role !== 'admin') {
      const { checkLoanQuotas } = require('../services/loanQuotaValidator');
      const quotaIssues = await checkLoanQuotas({
        user: req.user,
        instrument,
        fromDate: start.format('YYYY-MM-DD'),
        toDate: end.format('YYYY-MM-DD'),
      });
      if (quotaIssues.length > 0) {
        // Mostra il primo come errore principale + tutti come details.
        const first = quotaIssues[0];
        return res.status(409).json({
          error: first.message,
          code: first.code,
          details: quotaIssues.map((i) => ({ message: i.message, code: i.code })),
        });
      }
    }

    try {
      const loan = await InstrumentLoan.create({
        instrumentId,
        userId: req.user.id,
        fromDate: start.format('YYYY-MM-DD'),
        toDate: end.format('YYYY-MM-DD'),
        notes: notes || null,
        status: 'requested',
      });
      const full = await findLoanFull(loan.id);
      // notifica utente: richiesta ricevuta
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
  const loan = await findLoanFull(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Prestito non trovato', code: 'NOT_FOUND' });
  if (loan.status !== 'requested') {
    return res
      .status(400)
      .json({ error: "Stato non valido per l'approvazione", code: 'LOAN_INVALID_STATE' });
  }
  await loan.update({
    status: 'active',
    approvedBy: req.user.id,
    approvedAt: new Date(),
  });
  const full = await findLoanFull(loan.id);
  sendInstrumentLoanEmail({ user: full.user, loan: full, kind: 'loan_approved' }).catch(() => {});
  res.json({ loan: annotateStatus(full) });
});

router.post('/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  const loan = await findLoanFull(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Prestito non trovato', code: 'NOT_FOUND' });
  if (loan.status !== 'requested') {
    return res
      .status(400)
      .json({ error: 'Stato non valido per il rifiuto', code: 'LOAN_INVALID_STATE' });
  }
  await loan.update({
    status: 'rejected',
    approvedBy: req.user.id,
    approvedAt: new Date(),
  });
  const full = await findLoanFull(loan.id);
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
  if (loan.status === 'returned') {
    return res
      .status(400)
      .json({ error: 'Prestito già restituito', code: 'LOAN_ALREADY_RETURNED' });
  }
  if (loan.status !== 'active' && loan.status !== 'overdue') {
    return res
      .status(400)
      .json({ error: 'Stato non valido per la restituzione', code: 'LOAN_INVALID_STATE' });
  }
  await loan.update({ status: 'returned', returnedAt: new Date() });
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
