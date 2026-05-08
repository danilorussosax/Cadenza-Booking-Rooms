'use strict';

const express = require('express');
const { Op } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { BookingRule, BookingRuleException, Room } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  findOverlappingBookings,
  cancelOverlappingBookings,
} = require('../services/exceptionOverlapService');

const router = express.Router();

const VALID_ROLES_FOR_EXCEPTION = ['admin', 'docente', 'studente', 'all'];
const VALID_KINDS = ['block', 'time_window'];
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// Lista tutte le regole (uno per ruolo)
router.get('/', authenticate, async (req, res) => {
  const rules = await BookingRule.findAll({ order: [['role', 'ASC']] });
  res.json({ rules });
});

// =====================================================
// ECCEZIONI alle regole di prenotazione
// =====================================================

// GET /api/rules/exceptions?role=studente&roomId=12
// Restituisce le eccezioni del ruolo richiesto + quelle 'all'. Senza ?role:
// tutte (admin only). roomId è solo un filtro di lista (NON limita lo
// scope dell'eccezione: serve all'admin per vedere "cosa è configurato per
// questa aula"). Una eccezione globale (roomId IS NULL) compare sempre.
router.get('/exceptions', authenticate, async (req, res) => {
  const { role, roomId } = req.query;
  const where = {};
  if (role) {
    if (!VALID_ROLES_FOR_EXCEPTION.includes(role)) {
      return res.status(400).json({ error: 'Ruolo non valido' });
    }
    where.role = { [Op.in]: [role, 'all'] };
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Riservato agli admin' });
  }
  if (roomId) {
    const id = Number(roomId);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'roomId non valido' });
    }
    // null (globale) OR match aula richiesta
    where.roomId = { [Op.or]: [null, id] };
  }
  const exceptions = await BookingRuleException.findAll({
    where,
    include: [
      {
        model: Room,
        as: 'room',
        attributes: ['id', 'name', 'buildingId'],
        required: false,
      },
    ],
    order: [
      ['role', 'ASC'],
      ['name', 'ASC'],
    ],
  });
  res.json({ exceptions });
});

function validateExceptionPayload(body) {
  const errors = [];
  if (!body.name || !body.name.trim()) errors.push('Nome obbligatorio');
  if (!VALID_ROLES_FOR_EXCEPTION.includes(body.role)) errors.push('Ruolo non valido');
  if (!VALID_KINDS.includes(body.kind)) errors.push('Tipo non valido');
  if (
    body.kind === 'time_window' &&
    (typeof body.maxHoursInWindow !== 'number' || body.maxHoursInWindow <= 0)
  ) {
    errors.push('maxHoursInWindow obbligatorio per kind=time_window');
  }
  if (body.startTime && !TIME_REGEX.test(body.startTime)) errors.push('startTime formato HH:mm');
  if (body.endTime && !TIME_REGEX.test(body.endTime)) errors.push('endTime formato HH:mm');
  if (body.startTime && body.endTime && body.startTime >= body.endTime) {
    errors.push('startTime deve essere precedente a endTime');
  }
  if (body.dateFrom && body.dateTo && body.dateFrom > body.dateTo) {
    errors.push('dateFrom deve essere precedente o uguale a dateTo');
  }
  if (
    body.daysOfWeek &&
    (!Array.isArray(body.daysOfWeek) ||
      body.daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
  ) {
    errors.push('daysOfWeek deve essere un array di interi 0-6');
  }
  if (body.roomId !== null && body.roomId !== undefined && body.roomId !== '') {
    if (!Number.isInteger(body.roomId) || body.roomId <= 0) {
      errors.push('roomId non valido');
    }
  }
  return errors;
}

async function assertRoomExists(roomId) {
  if (roomId == null) return;
  const exists = await Room.findByPk(roomId, { attributes: ['id'] });
  if (!exists) {
    const err = new Error('Aula non trovata');
    err.status = 400;
    err.code = 'ROOM_NOT_FOUND';
    throw err;
  }
}

function normalizeException(body) {
  return {
    role: body.role,
    name: String(body.name).trim(),
    kind: body.kind,
    daysOfWeek:
      Array.isArray(body.daysOfWeek) && body.daysOfWeek.length > 0
        ? [...new Set(body.daysOfWeek)].sort()
        : null,
    dateFrom: body.dateFrom || null,
    dateTo: body.dateTo || null,
    startTime: body.startTime || null,
    endTime: body.endTime || null,
    maxHoursInWindow: body.kind === 'time_window' ? Number(body.maxHoursInWindow) : null,
    isActive: body.isActive !== false,
    notes: body.notes ? String(body.notes).trim() : null,
    roomId:
      body.roomId !== null && body.roomId !== undefined && body.roomId !== ''
        ? Number(body.roomId)
        : null,
  };
}

// POST /api/rules/exceptions  (admin)
router.post('/exceptions', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const errors = validateExceptionPayload(req.body || {});
    if (errors.length > 0)
      return res
        .status(400)
        .json({ error: 'Validazione fallita', details: errors.map((m) => ({ message: m })) });
    const payload = normalizeException(req.body);
    await assertRoomExists(payload.roomId);
    const created = await BookingRuleException.create(payload);
    res.status(201).json({ exception: created });
  } catch (err) {
    if (err.code === 'ROOM_NOT_FOUND') {
      return res
        .status(400)
        .json({ error: err.message, code: err.code, details: [{ message: err.message }] });
    }
    next(err);
  }
});

// POST /api/rules/exceptions/preview-overlaps  (admin)
// Anteprima delle prenotazioni esistenti che cadrebbero in un block
// proposto (kind='block'). Body: stessa shape di POST /exceptions.
// Risponde con { overlapping: Booking[] } — non scrive nulla.
router.post(
  '/exceptions/preview-overlaps',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const errs = validateExceptionPayload(req.body || {});
      if (errs.length > 0) {
        return res
          .status(400)
          .json({ error: 'Validazione fallita', details: errs.map((m) => ({ message: m })) });
      }
      const def = normalizeException(req.body);
      const overlapping = await findOverlappingBookings(def, { onlyFuture: true });
      // Flag "originato da Monte Ore" per UI: cerchiamo gli slot che
      // puntano a questi booking. Se c'è il link → è una booking generata
      // dal monte ore (non manuale).
      const ids = overlapping.map((b) => b.id);
      const moSlots =
        ids.length > 0
          ? await require('../models').MonteOreSlot.findAll({
              where: { bookingId: { [require('sequelize').Op.in]: ids } },
              attributes: ['bookingId'],
            })
          : [];
      const moBookingIds = new Set(moSlots.map((s) => s.bookingId));
      res.json({
        overlapping: overlapping.map((b) => ({
          id: b.id,
          startTime: b.startTime,
          endTime: b.endTime,
          purpose: b.purpose,
          type: b.type,
          checkedIn: !!b.checkedInAt,
          fromMonteOre: moBookingIds.has(b.id),
          user: b.user
            ? {
                id: b.user.id,
                firstName: b.user.firstName,
                lastName: b.user.lastName,
                email: b.user.email,
                role: b.user.role,
              }
            : null,
          room: b.room
            ? {
                id: b.room.id,
                name: b.room.name,
                building: b.room.building
                  ? { id: b.room.building.id, name: b.room.building.name }
                  : null,
              }
            : null,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/rules/exceptions/:id/cancel-overlapping  (admin)
// Cancella in batch tutte le prenotazioni FUTURE non checked-in che cadono
// nello scope dell'eccezione `block` salvata. Body opzionale: { reason }.
router.post(
  '/exceptions/:id/cancel-overlapping',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const exception = await BookingRuleException.findByPk(req.params.id);
      if (!exception) return res.status(404).json({ error: 'Eccezione non trovata' });
      if (exception.kind !== 'block') {
        return res.status(400).json({
          error: 'Operazione disponibile solo per kind=block',
          code: 'NOT_BLOCK_KIND',
        });
      }
      const result = await cancelOverlappingBookings(exception, {
        reason: req.body?.reason ? String(req.body.reason).slice(0, 200) : exception.name,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/rules/exceptions/:id  (admin)
router.put('/exceptions/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const exception = await BookingRuleException.findByPk(req.params.id);
    if (!exception) return res.status(404).json({ error: 'Eccezione non trovata' });
    const errors = validateExceptionPayload(req.body || {});
    if (errors.length > 0)
      return res
        .status(400)
        .json({ error: 'Validazione fallita', details: errors.map((m) => ({ message: m })) });
    const payload = normalizeException(req.body);
    await assertRoomExists(payload.roomId);
    await exception.update(payload);
    res.json({ exception });
  } catch (err) {
    if (err.code === 'ROOM_NOT_FOUND') {
      return res
        .status(400)
        .json({ error: err.message, code: err.code, details: [{ message: err.message }] });
    }
    next(err);
  }
});

// DELETE /api/rules/exceptions/:id  (admin)
router.delete('/exceptions/:id', authenticate, requireRole('admin'), async (req, res) => {
  const exception = await BookingRuleException.findByPk(req.params.id);
  if (!exception) return res.status(404).json({ error: 'Eccezione non trovata' });
  await exception.destroy();
  res.json({ message: 'Eccezione eliminata' });
});

// Singola regola per ruolo
router.get('/:role', authenticate, async (req, res) => {
  const role = req.params.role;
  if (!['admin', 'docente', 'studente'].includes(role)) {
    return res.status(400).json({ error: 'Ruolo non valido' });
  }
  const rule = await BookingRule.findOne({ where: { role } });
  if (!rule) return res.status(404).json({ error: 'Regola non trovata' });
  res.json({ rule });
});

// Aggiorna le regole per un ruolo (admin).
// UPSERT pattern: una sola query INSERT ... ON CONFLICT ("role") DO UPDATE,
// elimina la race condition del classico "find-then-create" (due admin
// concorrenti che salvano per lo stesso ruolo). Il vincolo UNIQUE su `role`
// nel modello rende l'upsert deterministico.
router.put(
  '/:role',
  authenticate,
  requireRole('admin'),
  [
    body('maxActiveBookings').optional().isInt({ min: 0 }),
    body('maxHoursPerWeek').optional().isInt({ min: 0 }),
    body('maxHoursPerDay').optional().isInt({ min: 0 }),
    body('maxBookingDurationMinutes').optional().isInt({ min: 15 }),
    body('minBookingDurationMinutes').optional().isInt({ min: 15 }),
    body('maxAdvanceDays').optional().isInt({ min: 0 }),
    body('minAdvanceHours').optional().isInt({ min: 0 }),
    body('cancellationDeadlineHours').optional().isInt({ min: 0 }),
    body('minIntervalBetweenBookingsMinutes').optional().isInt({ min: 0 }),
    body('allowRecurring').optional().isBoolean(),
    body('allowNightHours').optional().isBoolean(),
    body('allowedStartTime')
      .optional()
      .matches(/^\d{2}:\d{2}$/),
    body('allowedEndTime')
      .optional()
      .matches(/^\d{2}:\d{2}$/),
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

      const role = req.params.role;
      if (!['admin', 'docente', 'studente'].includes(role)) {
        return res.status(400).json({ error: 'Ruolo non valido', code: 'VALIDATION_FAILED' });
      }

      // Sequelize Model.upsert() restituisce [instance, created]: created=true
      // se ha inserito, false se ha aggiornato. Lato Postgres traduce in:
      //   INSERT ... ON CONFLICT ("role") DO UPDATE SET ...
      // Eventuali errori di vincolo (es. valori fuori validate) salgono al
      // middleware globale che li traduce in code stabili.
      const [rule] = await BookingRule.upsert({ ...req.body, role });
      res.json({ rule });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
