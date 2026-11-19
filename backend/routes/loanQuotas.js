'use strict';

/**
 * Quote dinamiche sul prestito strumenti — endpoint admin paralleli a
 * `routes/quotas.js` ma con semantica adatta al dominio (giorni/anno
 * invece di ore/settimana, count contemporaneo).
 *
 * Vedi `models/InstrumentLoanQuota.js` per la specifica del modello e
 * `services/loanQuotaValidator.js` per l'applicazione runtime.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { InstrumentLoanQuota, Instrument } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { domainError } = require('../lib/domainError');

const router = express.Router();

const VALID_ROLES = ['admin', 'docente', 'studente'];
const VALID_SCOPE_KINDS = ['family', 'instrument', 'global'];
const VALID_FAMILIES = [
  'archi',
  'fiati_legni',
  'fiati_ottoni',
  'tastiere',
  'percussioni',
  'corde',
  'voce',
  'elettronica',
  'altro',
];

// =====================================================
// GET /api/admin/instrument-loan-quotas
// =====================================================
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.role && VALID_ROLES.includes(req.query.role)) where.role = req.query.role;
    if (req.query.scopeKind && VALID_SCOPE_KINDS.includes(req.query.scopeKind)) {
      where.scopeKind = req.query.scopeKind;
    }
    if (req.query.isActive === 'true') where.isActive = true;
    if (req.query.isActive === 'false') where.isActive = false;

    const quotas = await InstrumentLoanQuota.findAll({
      where,
      order: [
        ['role', 'ASC'],
        ['scopeKind', 'ASC'],
        ['scopeValue', 'ASC'],
      ],
    });
    res.json({ quotas });
  } catch (err) {
    next(err);
  }
});

// Validazione condivisa POST/PUT.
// `instrument` esistenza è verificata in modo lazy: il check fisico richiede
// una query DB → la facciamo nel route handler.
function validateLoanQuotaPayload(payload) {
  const errors = [];
  if (!VALID_ROLES.includes(payload.role)) errors.push('Ruolo non valido');
  if (!VALID_SCOPE_KINDS.includes(payload.scopeKind)) errors.push('scopeKind non valido');

  const rawScopeValue =
    payload.scopeKind === 'global'
      ? '*'
      : typeof payload.scopeValue === 'string'
        ? payload.scopeValue.trim()
        : String(payload.scopeValue ?? '').trim();

  if (payload.scopeKind === 'family') {
    if (!VALID_FAMILIES.includes(rawScopeValue)) {
      errors.push('Famiglia strumentale non valida');
    }
  } else if (payload.scopeKind === 'instrument') {
    if (!/^\d+$/.test(rawScopeValue)) {
      errors.push('scopeValue per "instrument" deve essere l\'id numerico');
    }
  }

  const concurrent = Number(payload.maxConcurrent);
  const days = Number(payload.maxDaysPerYear);
  if (!Number.isInteger(concurrent) || concurrent < 0)
    errors.push('maxConcurrent deve essere intero >= 0');
  if (!Number.isInteger(days) || days < 0) errors.push('maxDaysPerYear deve essere intero >= 0');
  if (concurrent === 0 && days === 0) {
    errors.push('Almeno uno tra maxConcurrent e maxDaysPerYear deve essere > 0');
  }

  return {
    errors,
    normalized: {
      role: payload.role,
      scopeKind: payload.scopeKind,
      scopeValue: rawScopeValue,
      maxConcurrent: concurrent,
      maxDaysPerYear: days,
      isActive: payload.isActive !== false,
    },
  };
}

// =====================================================
// POST /api/admin/instrument-loan-quotas
// =====================================================
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('role').isIn(VALID_ROLES),
    body('scopeKind').isIn(VALID_SCOPE_KINDS),
    body('maxConcurrent').optional().isInt({ min: 0 }),
    body('maxDaysPerYear').optional().isInt({ min: 0 }),
  ],
  async (req, res, next) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty()) {
        throw domainError('VALIDATION_FAILED', 'Validazione fallita', { details: errs.array() });
      }
      const { errors, normalized } = validateLoanQuotaPayload(req.body || {});
      if (errors.length) {
        throw domainError('VALIDATION_FAILED', errors[0], {
          details: errors.map((m) => ({ message: m })),
        });
      }

      // Verifica che l'instrument id riferito esista realmente.
      if (normalized.scopeKind === 'instrument') {
        const instrument = await Instrument.findByPk(Number(normalized.scopeValue));
        if (!instrument) {
          throw domainError('INSTRUMENT_NOT_FOUND', 'Strumento non trovato', { status: 404 });
        }
      }

      const quota = await InstrumentLoanQuota.create(normalized);
      res.status(201).json({ quota });
    } catch (err) {
      next(err);
    }
  },
);

// =====================================================
// PUT /api/admin/instrument-loan-quotas/:id
// =====================================================
router.put('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const quota = await InstrumentLoanQuota.findByPk(req.params.id);
    if (!quota) throw domainError('NOT_FOUND', 'Quota non trovata', { status: 404 });

    const merged = {
      role: req.body.role ?? quota.role,
      scopeKind: req.body.scopeKind ?? quota.scopeKind,
      scopeValue: req.body.scopeValue ?? quota.scopeValue,
      maxConcurrent: req.body.maxConcurrent ?? quota.maxConcurrent,
      maxDaysPerYear: req.body.maxDaysPerYear ?? quota.maxDaysPerYear,
      isActive: req.body.isActive ?? quota.isActive,
    };
    const { errors, normalized } = validateLoanQuotaPayload(merged);
    if (errors.length) {
      throw domainError('VALIDATION_FAILED', errors[0], {
        details: errors.map((m) => ({ message: m })),
      });
    }
    await quota.update(normalized);
    res.json({ quota });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// DELETE /api/admin/instrument-loan-quotas/:id
// =====================================================
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const quota = await InstrumentLoanQuota.findByPk(req.params.id);
    if (!quota) throw domainError('NOT_FOUND', 'Quota non trovata', { status: 404 });
    await quota.destroy({ force: req.query.force === 'true' });
    res.json({ message: 'Quota eliminata' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
