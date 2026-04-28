'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { BookingQuota } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_ROLES = ['admin', 'docente', 'studente'];
const VALID_SCOPE_KINDS = ['roomType', 'equipmentType', 'room', 'building', 'global'];
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// =====================================================
// GET /api/admin/quotas
// Lista tutte le quote, ordinate per role + scopeKind + scopeValue.
// Filtri opzionali: ?role=studente, ?scopeKind=roomType, ?isActive=true
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

    const quotas = await BookingQuota.findAll({
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

// =====================================================
// Helpers di validazione condivisi tra POST e PUT.
// Le validazioni "business" (scopeValue richiesto se non global, almeno
// un cap > 0) sono fatte qui perché express-validator non può esprimerle
// concisamente.
// =====================================================
function validateQuotaPayload(payload) {
  const errors = [];
  if (!VALID_ROLES.includes(payload.role)) errors.push('Ruolo non valido');
  if (!VALID_SCOPE_KINDS.includes(payload.scopeKind)) errors.push('scopeKind non valido');

  const rawScopeValue =
    payload.scopeKind === 'global'
      ? '*'
      : typeof payload.scopeValue === 'string'
        ? payload.scopeValue.trim()
        : String(payload.scopeValue ?? '').trim();

  if (payload.scopeKind !== 'global' && !rawScopeValue) {
    errors.push('scopeValue obbligatorio per scopeKind non globale');
  }
  if (
    (payload.scopeKind === 'room' || payload.scopeKind === 'building') &&
    rawScopeValue &&
    !/^\d+$/.test(rawScopeValue)
  ) {
    errors.push(`scopeValue per "${payload.scopeKind}" deve essere l'id numerico`);
  }

  const wk = Number(payload.maxHoursPerWeek ?? 0);
  const dy = Number(payload.maxHoursPerDay ?? 0);
  const mo = Number(payload.maxHoursPerMonth ?? 0);
  const cnt = Number(payload.maxBookings ?? 0);
  if (!Number.isInteger(wk) || wk < 0) errors.push('maxHoursPerWeek deve essere intero >= 0');
  if (!Number.isInteger(dy) || dy < 0) errors.push('maxHoursPerDay deve essere intero >= 0');
  if (!Number.isInteger(mo) || mo < 0) errors.push('maxHoursPerMonth deve essere intero >= 0');
  if (!Number.isInteger(cnt) || cnt < 0) errors.push('maxBookings deve essere intero >= 0');
  if (wk === 0 && dy === 0 && mo === 0 && cnt === 0) {
    errors.push('Almeno uno tra max hours/week, hours/day, hours/month, bookings deve essere > 0');
  }

  let daysOfWeek = [];
  if (Array.isArray(payload.daysOfWeek)) {
    daysOfWeek = payload.daysOfWeek
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    daysOfWeek = [...new Set(daysOfWeek)].sort();
  }

  const timeFrom = payload.timeFrom?.trim() || null;
  const timeTo = payload.timeTo?.trim() || null;
  if (timeFrom && !TIME_REGEX.test(timeFrom)) errors.push('timeFrom formato HH:mm');
  if (timeTo && !TIME_REGEX.test(timeTo)) errors.push('timeTo formato HH:mm');
  if ((timeFrom && !timeTo) || (timeTo && !timeFrom)) {
    errors.push('timeFrom e timeTo vanno entrambi valorizzati o entrambi vuoti');
  }
  if (timeFrom && timeTo && timeFrom >= timeTo) {
    errors.push('timeFrom deve essere precedente a timeTo');
  }

  return {
    errors,
    normalized: {
      role: payload.role,
      scopeKind: payload.scopeKind,
      scopeValue: rawScopeValue,
      maxHoursPerWeek: wk,
      maxHoursPerDay: dy,
      maxHoursPerMonth: mo,
      maxBookings: cnt,
      daysOfWeek,
      timeFrom,
      timeTo,
      isActive: payload.isActive !== false,
    },
  };
}

// =====================================================
// POST /api/admin/quotas
// Body: { role, scopeKind, scopeValue, maxHoursPerWeek, maxHoursPerDay, isActive }
// La UNIQUE su (role, scopeKind, scopeValue) è gestita dal mapper centrale:
// in caso di duplicato, il middleware ritorna 409 UNIQUE_VIOLATION.
// =====================================================
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('role').isIn(VALID_ROLES),
    body('scopeKind').isIn(VALID_SCOPE_KINDS),
    body('maxHoursPerWeek').optional().isInt({ min: 0 }),
    body('maxHoursPerDay').optional().isInt({ min: 0 }),
  ],
  async (req, res, next) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty()) {
        return res.status(400).json({
          error: 'Validazione fallita',
          code: 'VALIDATION_FAILED',
          details: errs.array(),
        });
      }
      const { errors, normalized } = validateQuotaPayload(req.body || {});
      if (errors.length) {
        return res.status(400).json({
          error: errors[0],
          code: 'VALIDATION_FAILED',
          details: errors.map((m) => ({ message: m })),
        });
      }
      const quota = await BookingQuota.create(normalized);
      res.status(201).json({ quota });
    } catch (err) {
      next(err);
    }
  },
);

// =====================================================
// PUT /api/admin/quotas/:id
// Aggiorna i soli campi forniti. Re-valida il payload risultante per
// preservare l'invariante "almeno un cap > 0".
// =====================================================
router.put('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const quota = await BookingQuota.findByPk(req.params.id);
    if (!quota) return res.status(404).json({ error: 'Quota non trovata', code: 'NOT_FOUND' });

    const merged = {
      role: req.body.role ?? quota.role,
      scopeKind: req.body.scopeKind ?? quota.scopeKind,
      scopeValue: req.body.scopeValue ?? quota.scopeValue,
      maxHoursPerWeek: req.body.maxHoursPerWeek ?? quota.maxHoursPerWeek,
      maxHoursPerDay: req.body.maxHoursPerDay ?? quota.maxHoursPerDay,
      maxHoursPerMonth: req.body.maxHoursPerMonth ?? quota.maxHoursPerMonth,
      maxBookings: req.body.maxBookings ?? quota.maxBookings,
      daysOfWeek: req.body.daysOfWeek ?? quota.daysOfWeek,
      timeFrom: req.body.timeFrom ?? quota.timeFrom,
      timeTo: req.body.timeTo ?? quota.timeTo,
      isActive: req.body.isActive ?? quota.isActive,
    };
    const { errors, normalized } = validateQuotaPayload(merged);
    if (errors.length) {
      return res.status(400).json({
        error: errors[0],
        code: 'VALIDATION_FAILED',
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
// DELETE /api/admin/quotas/:id  — soft delete (paranoid)
// Per cancellazione definitiva: query param ?force=true
// =====================================================
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const quota = await BookingQuota.findByPk(req.params.id);
    if (!quota) return res.status(404).json({ error: 'Quota non trovata', code: 'NOT_FOUND' });
    await quota.destroy({ force: req.query.force === 'true' });
    res.json({ message: 'Quota eliminata' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
