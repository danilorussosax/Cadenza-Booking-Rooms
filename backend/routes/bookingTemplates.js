'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const dayjs = require('dayjs');
const { Op, Transaction } = require('sequelize');
const { sequelize, BookingTemplate, Booking, Room, Building, User } = require('../models');
const { authenticate, requireApproved, requireCompleteProfile } = require('../middleware/auth');
const { validateBooking } = require('../services/bookingValidator');
const { sendBookingEmail } = require('../services/emailService');

const router = express.Router();

const TYPE_VALUES = ['studio_individuale', 'lezione', 'prova', 'concerto', 'altro'];
const WRITE_ISOLATION = Transaction.ISOLATION_LEVELS.SERIALIZABLE;

const FAVORITE_LIMIT = 3;

// ---------------------------------------------------------------------------
// Validatori condivisi
// ---------------------------------------------------------------------------
const baseBodyValidators = [
  body('name').isString().trim().isLength({ min: 1, max: 100 }),
  body('roomId').isInt({ min: 1 }),
  body('dayOfWeek').isInt({ min: 0, max: 6 }),
  body('startMinutes').isInt({ min: 0, max: 1439 }),
  body('durationMinutes').isInt({ min: 1, max: 1440 }),
  body('type').optional().isIn(TYPE_VALUES),
  body('purpose').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('isFavorite').optional().isBoolean().toBoolean(),
];

function serialize(t) {
  return {
    id: t.id,
    name: t.name,
    roomId: t.roomId,
    dayOfWeek: t.dayOfWeek,
    startMinutes: t.startMinutes,
    durationMinutes: t.durationMinutes,
    type: t.type,
    purpose: t.purpose,
    isFavorite: t.isFavorite,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    room: t.room
      ? {
          id: t.room.id,
          name: t.room.name,
          code: t.room.code,
          floor: t.room.floor,
          building: t.room.building ? { id: t.room.building.id, name: t.room.building.name } : null,
        }
      : null,
  };
}

/**
 * Calcola la prossima occorrenza del template a partire da `from` (default ora):
 *  - cerca la prima data >= oggi con dayOfWeek matching;
 *  - se è oggi e l'orario è già passato, salta a +7 giorni;
 *  - applica startMinutes e durationMinutes.
 *
 * Lavora in local time perché startMinutes è espresso in fuso del server
 * (è ciò che l'utente vede nel form e ciò che validateBooking confronta).
 */
function nextOccurrence(template, from = dayjs()) {
  const todayDow = from.day();
  let daysAhead = (template.dayOfWeek - todayDow + 7) % 7;
  let candidate = from.startOf('day').add(daysAhead, 'day').add(template.startMinutes, 'minute');
  if (daysAhead === 0 && !candidate.isAfter(from)) {
    candidate = candidate.add(7, 'day');
  }
  const start = candidate.toDate();
  const end = candidate.add(template.durationMinutes, 'minute').toDate();
  return { start, end };
}

const ROOM_INCLUDE = {
  model: Room,
  as: 'room',
  include: [{ model: Building, as: 'building', attributes: ['id', 'name'] }],
};

// ---------------------------------------------------------------------------
// GET /api/bookings/templates
// Ritorna i template dell'utente loggato, favoriti prima, poi nome.
// ---------------------------------------------------------------------------
router.get('/', authenticate, async (req, res, next) => {
  try {
    const items = await BookingTemplate.findAll({
      where: { userId: req.user.id },
      include: [ROOM_INCLUDE],
      order: [
        ['isFavorite', 'DESC'],
        ['name', 'ASC'],
      ],
    });
    res.json({ templates: items.map(serialize) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/bookings/templates
// ---------------------------------------------------------------------------
router.post(
  '/',
  authenticate,
  requireApproved,
  requireCompleteProfile,
  baseBodyValidators,
  async (req, res, next) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });
    }
    try {
      // Verifica esistenza aula (FK è già lì, ma 404 esplicito è più gentile)
      const room = await Room.findByPk(req.body.roomId);
      if (!room) {
        return res.status(400).json({ error: 'Aula non trovata', code: 'ROOM_NOT_FOUND' });
      }

      // Limite hard ai favoriti per non far esplodere il "Quick book" del Dashboard.
      // Se l'utente prova a salvare un 4° favorito, gli rispondiamo 409 — lui decide
      // se sganciare un altro favorito o salvare con isFavorite=false.
      if (req.body.isFavorite) {
        const favCount = await BookingTemplate.count({
          where: { userId: req.user.id, isFavorite: true },
        });
        if (favCount >= FAVORITE_LIMIT) {
          return res.status(409).json({
            error: `Hai già ${FAVORITE_LIMIT} template tra i favoriti`,
            code: 'FAVORITE_LIMIT_REACHED',
            limit: FAVORITE_LIMIT,
          });
        }
      }

      const created = await BookingTemplate.create({
        userId: req.user.id,
        name: req.body.name,
        roomId: req.body.roomId,
        dayOfWeek: req.body.dayOfWeek,
        startMinutes: req.body.startMinutes,
        durationMinutes: req.body.durationMinutes,
        type: req.body.type || 'studio_individuale',
        purpose: req.body.purpose ?? null,
        isFavorite: req.body.isFavorite === true,
      });

      const full = await BookingTemplate.findByPk(created.id, { include: [ROOM_INCLUDE] });
      res.status(201).json({ template: serialize(full) });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({
          error: 'Esiste già un template con questo nome',
          code: 'TEMPLATE_NAME_DUPLICATE',
        });
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/bookings/templates/:id  (own only)
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  authenticate,
  requireApproved,
  requireCompleteProfile,
  param('id').isInt({ min: 1 }),
  baseBodyValidators,
  async (req, res, next) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });
    }
    try {
      const tpl = await BookingTemplate.findByPk(req.params.id);
      if (!tpl) return res.status(404).json({ error: 'Template non trovato' });
      if (tpl.userId !== req.user.id) return res.status(403).json({ error: 'Non autorizzato' });

      const wantsFavorite = req.body.isFavorite === true;
      if (wantsFavorite && !tpl.isFavorite) {
        const favCount = await BookingTemplate.count({
          where: {
            userId: req.user.id,
            isFavorite: true,
            id: { [Op.ne]: tpl.id },
          },
        });
        if (favCount >= FAVORITE_LIMIT) {
          return res.status(409).json({
            error: `Hai già ${FAVORITE_LIMIT} template tra i favoriti`,
            code: 'FAVORITE_LIMIT_REACHED',
            limit: FAVORITE_LIMIT,
          });
        }
      }

      await tpl.update({
        name: req.body.name,
        roomId: req.body.roomId,
        dayOfWeek: req.body.dayOfWeek,
        startMinutes: req.body.startMinutes,
        durationMinutes: req.body.durationMinutes,
        type: req.body.type || tpl.type,
        purpose: req.body.purpose ?? null,
        isFavorite: wantsFavorite,
      });

      const full = await BookingTemplate.findByPk(tpl.id, { include: [ROOM_INCLUDE] });
      res.json({ template: serialize(full) });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({
          error: 'Esiste già un template con questo nome',
          code: 'TEMPLATE_NAME_DUPLICATE',
        });
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/bookings/templates/:id  (own only)
// ---------------------------------------------------------------------------
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const tpl = await BookingTemplate.findByPk(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template non trovato' });
    if (tpl.userId !== req.user.id) return res.status(403).json({ error: 'Non autorizzato' });
    await tpl.destroy();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/bookings/templates/:id/quick-book
// Calcola la prossima occorrenza del template e crea una Booking applicando
// la validazione standard del role rule engine.
// ---------------------------------------------------------------------------
router.post(
  '/:id/quick-book',
  authenticate,
  requireApproved,
  requireCompleteProfile,
  async (req, res, next) => {
    try {
      const tpl = await BookingTemplate.findByPk(req.params.id, { include: [ROOM_INCLUDE] });
      if (!tpl) return res.status(404).json({ error: 'Template non trovato' });
      if (tpl.userId !== req.user.id) return res.status(403).json({ error: 'Non autorizzato' });

      const { start, end } = nextOccurrence(tpl);

      // Aula "high-impact" (sala concerti, auditorium): per i non-admin la
      // prenotazione nasce in 'pending_approval' e richiede l'ok di un admin.
      const room = tpl.room || (await Room.findByPk(tpl.roomId));
      if (!room) {
        return res
          .status(400)
          .json({ error: 'Aula del template non disponibile', code: 'ROOM_NOT_FOUND' });
      }
      const needsApproval = room.requiresApproval === true && req.user.role !== 'admin';
      const initialStatus = needsApproval ? 'pending_approval' : 'confirmed';

      const booking = await sequelize.transaction(
        { isolationLevel: WRITE_ISOLATION },
        async (t) => {
          const validation = await validateBooking({
            user: req.user,
            roomId: tpl.roomId,
            startTime: start,
            endTime: end,
            type: tpl.type || 'studio_individuale',
            transaction: t,
          });
          if (!validation.valid) {
            const e = new Error(validation.errors[0] || 'Prenotazione non valida');
            e.status = 400;
            e.issues = validation.errors;
            e.code = validation.codes?.find((c) => !!c) || 'BOOKING_INVALID';
            throw e;
          }
          return Booking.create(
            {
              userId: req.user.id,
              roomId: tpl.roomId,
              startTime: start,
              endTime: end,
              purpose: tpl.purpose || null,
              type: tpl.type || 'studio_individuale',
              status: initialStatus,
            },
            { transaction: t },
          );
        },
      );

      const full = await Booking.findByPk(booking.id, {
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstName', 'lastName', 'role', 'email', 'emailNotifications'],
          },
          { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
        ],
      });
      // Email fire-and-forget come per /api/bookings POST
      if (!needsApproval) {
        sendBookingEmail({ user: full.user, booking: full, kind: 'confirmation' }).catch(() => {});
      }

      res.status(201).json({
        booking: full,
        scheduled: { startTime: start, endTime: end },
      });
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json({
          error: err.message,
          issues: err.issues,
          code: err.code || 'BOOKING_INVALID',
        });
      }
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res
          .status(409)
          .json({ error: 'Conflitto: prenotazione già esistente', code: 'BOOKING_CONFLICT' });
      }
      next(err);
    }
  },
);

module.exports = router;
