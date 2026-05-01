'use strict';

/**
 * Booking type catalog (gap #7 EasyRoom parity).
 *
 * Pubblico:
 *   GET /api/booking-types        → lista tipi attivi con label/color/icon/sortOrder
 *
 * Admin:
 *   GET /api/admin/booking-types  → lista TUTTI (anche disattivati / system)
 *   PUT /api/admin/booking-types/:code → aggiorna label/color/icon/sortOrder/isActive/...
 *
 * In questa release NON esponiamo POST/DELETE: i tipi corrispondono ai 5
 * valori ENUM `Booking.type` che richiedono migration formale. Per ora
 * l'admin può solo *personalizzare* i 5 esistenti.
 */

const express = require('express');
const { BookingTypeCatalog } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { pickAllowed, ValidationError } = require('../lib/sanitize');

const router = express.Router();
const adminRouter = express.Router();

// Whitelist campi editabili. Esclude `code` (immutabile, è la PK funzionale)
// e `isSystem` (flag protezione, deciso solo a seed-time).
const EDITABLE_FIELDS = {
  label: { type: 'string', maxLength: 100 },
  color: { type: 'string', maxLength: 7 },
  icon: { type: 'string', maxLength: 40 },
  sortOrder: { type: 'integer', min: 0, max: 9999 },
  isActive: 'boolean',
  defaultDurationMinutes: { type: 'integer', min: 5, max: 1440, nullable: true },
  description: { type: 'string', maxLength: 500, nullable: true },
};

// =========================================================
// PUBBLICO — GET /api/booking-types
// =========================================================
// Espone solo i tipi attivi. Auth richiesta (qualsiasi ruolo, anche pending).
// Il frontend usa questa per popolare la dropdown del BookingFormDialog.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const types = await BookingTypeCatalog.findAll({
      where: { isActive: true },
      attributes: [
        'code',
        'label',
        'color',
        'icon',
        'sortOrder',
        'defaultDurationMinutes',
        'description',
      ],
      order: [
        ['sortOrder', 'ASC'],
        ['label', 'ASC'],
      ],
    });
    res.json({ types: types.map((t) => t.toJSON()) });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// ADMIN — GET /api/admin/booking-types
// =========================================================
adminRouter.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const types = await BookingTypeCatalog.findAll({
      order: [
        ['sortOrder', 'ASC'],
        ['code', 'ASC'],
      ],
    });
    res.json({ types: types.map((t) => t.toJSON()) });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// ADMIN — PUT /api/admin/booking-types/:code
// =========================================================
// Lookup per `code` (NON per id) così l'admin può fare URL bookmark stabili
// e gli script di provisioning sono leggibili.
adminRouter.put('/:code', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const code = String(req.params.code || '').toLowerCase();
    if (!code || !/^[a-z][a-z0-9_]{1,39}$/.test(code)) {
      return res.status(400).json({ error: 'code non valido', code: 'INVALID_CODE' });
    }
    const target = await BookingTypeCatalog.findOne({ where: { code } });
    if (!target) {
      return res
        .status(404)
        .json({ error: 'Tipo prenotazione non trovato', code: 'TYPE_NOT_FOUND' });
    }
    const updates = pickAllowed(req.body, EDITABLE_FIELDS);
    // Safety: i tipi system devono restare con almeno una entry attiva
    // visibile nella dropdown — altrimenti la UI non offre alcuna scelta.
    if (target.isSystem && updates.isActive === false) {
      const otherActive = await BookingTypeCatalog.count({
        where: { isActive: true },
      });
      if (otherActive <= 1) {
        return res.status(409).json({
          error:
            "Impossibile disattivare l'ultimo tipo prenotazione attivo. Attivane un altro prima.",
          code: 'LAST_ACTIVE_TYPE',
        });
      }
    }
    await target.update(updates);
    res.json({ type: target.toJSON() });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: err.message, code: err.code, field: err.field });
    }
    next(err);
  }
});

module.exports = { router, adminRouter };
