'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { BookingTemplate, Room, Building } = require('../models');
const { authenticate, requireApproved, requireCompleteProfile } = require('../middleware/auth');
const { book, BookingError } = require('../services/bookingLifecycle');

const router = express.Router();

const TYPE_VALUES = ['studio_individuale', 'lezione', 'prova', 'concerto', 'altro'];

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
      // Stato iniziale, validazione, retry, mail utente / notifica admin
      // (pending_approval) sono nel ciclo di vita.
      const { full } = await book({
        actor: req.user,
        roomId: tpl.roomId,
        startTime: start,
        endTime: end,
        type: tpl.type || 'studio_individuale',
        purpose: tpl.purpose,
      });

      res.status(201).json({
        booking: full,
        scheduled: { startTime: start, endTime: end },
      });
    } catch (err) {
      if (err instanceof BookingError) {
        return res.status(err.status).json({
          error: err.message,
          ...(err.issues && { issues: err.issues }),
          code: err.code || 'BOOKING_INVALID',
        });
      }
      next(err);
    }
  },
);

module.exports = router;
