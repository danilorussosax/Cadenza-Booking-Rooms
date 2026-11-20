'use strict';

// Aule: CRUD, ricerca, overview QR.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { Institute, Building, Room, Equipment, Booking } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const removal = require('../../services/removal');
const { pickAllowed } = require('../../lib/sanitize');
const { isCheckInRequired } = require('../../lib/checkInPolicy');

const { domainError, httpError } = require('../../lib/domainError');

const router = express.Router();
const ROOM_ALLOWED = {
  buildingId: { type: 'integer', min: 1 },
  name: { type: 'string', maxLength: 100 },
  code: { type: 'string', maxLength: 50, nullable: true },
  floor: { type: 'string', maxLength: 50, nullable: true },
  capacity: { type: 'integer', min: 0, max: 10000, nullable: true },
  type: {
    // Allineato all'ENUM del model Room.type. Storicamente questo validator
    // aveva una lista diversa (aula/concerto/ufficio) che non riflette mai
    // esistita nel model: salvare un'aula con tipo "classe" o "aula_concerti"
    // veniva rifiutato dal validator con "Valore X non valido per type".
    type: 'enum',
    values: ['studio', 'sala_prove', 'aula_concerti', 'classe', 'aula_didattica', 'altro'],
  },
  allowedRoles: 'json',
  allowedCourseIds: 'json',
  isBookable: 'boolean',
  // null = eredita Building.checkInDefault (impostazione generale)
  // true/false = override esplicito. Vedi backend/lib/checkInPolicy.js.
  requireCheckIn: { type: 'boolean', nullable: true },
  requiresApproval: 'boolean',
  notes: { type: 'string', nullable: true },
  // photoUrl: gestito da POST /rooms/:id/photo, NON da PUT
  // qrToken: gestito da POST /rooms/:id/qr/regenerate, NON da PUT
};

// =========================================================
// AULE
// =========================================================

// Bulk delete (admin) — registered BEFORE :id to win the route match.
router.post('/rooms/bulk-delete', authenticate, requireRole('admin'), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (ids.length === 0) throw httpError(400, 'Nessun id fornito');
  const { deleted, removedBookings } = await removal.removeRooms(ids, { bookings: 'purge' });
  res.json({ deleted, removedBookings });
});

router.get('/rooms', authenticate, async (req, res) => {
  const where = {};
  if (req.query.buildingId) where.buildingId = req.query.buildingId;
  if (req.query.bookable === 'true') where.isBookable = true;
  // required: true → INNER JOIN su Building. Esclude le aule "orfane" il
  // cui edificio è stato soft-deleted da /admin/structure (Building è
  // paranoid, ma il soft-delete non cascada sulle Room: senza questo
  // filtro l'endpoint elencherebbe aule che non compaiono in Structure).
  const rooms = await Room.findAll({
    where,
    include: [
      {
        model: Building,
        as: 'building',
        required: true,
        include: [{ model: Institute, as: 'institute' }],
      },
      { model: Equipment, as: 'equipment' },
    ],
    order: [['name', 'ASC']],
  });
  res.json({ rooms });
});

// =========================================================
// GET /api/structure/rooms/search
//
// Ricerca aule con filtri combinati. REGISTRATO PRIMA di /rooms/:id per
// evitare che ":id" matchi la stringa "search".
//
// Query params (tutti opzionali, AND logic):
//   - equipmentType: stringa CSV oppure parametro multi-valore (es.
//                    ?equipmentType=pianoforte&equipmentType=leggio).
//                    L'aula deve possedere TUTTI i tipi richiesti
//                    con quantity >= 1.
//   - minCapacity:   capacità minima posti (default 0)
//   - building:      id edificio
//   - type:          Room.type (studio | sala_prove | aula_concerti | ...)
//   - from / to:     ISO datetime; esclude aule con almeno 1 booking
//                    confermato sovrapposto al range.
//
// Sempre filtra: isBookable=true (le aule disabilitate non compaiono nei
// risultati di ricerca utente).
// =========================================================
router.get('/rooms/search', authenticate, async (req, res, next) => {
  try {
    // Parsing robusto del multi-valore equipmentType:
    //   ?equipmentType=a&equipmentType=b  → ['a', 'b']  (express default)
    //   ?equipmentType=a,b                → ['a', 'b']
    const rawEq = req.query.equipmentType;
    const equipmentTypes = (Array.isArray(rawEq) ? rawEq : rawEq ? String(rawEq).split(',') : [])
      .map((s) => String(s).trim())
      .filter(Boolean);

    const minCapacity = Math.max(0, Number(req.query.minCapacity) || 0);
    const buildingId = req.query.building ? Number(req.query.building) || null : null;
    const roomType = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    if (from && Number.isNaN(from.getTime())) {
      throw domainError('VALIDATION_FAILED', 'from non valido');
    }
    if (to && Number.isNaN(to.getTime())) {
      throw domainError('VALIDATION_FAILED', 'to non valido');
    }
    if (from && to && from.getTime() >= to.getTime()) {
      throw domainError('VALIDATION_FAILED', 'from deve precedere to');
    }

    // 1) Base query sulle Room: filtri "esatti" che possono andare in WHERE
    const where = { isBookable: true };
    if (buildingId) where.buildingId = buildingId;
    if (roomType) where.type = roomType;
    if (minCapacity > 0) where.capacity = { [Op.gte]: minCapacity };

    // INNER JOIN su Building → esclude aule orfane di edificio soft-deleted
    // (vedi nota in GET /rooms).
    let rooms = await Room.findAll({
      where,
      include: [
        {
          model: Building,
          as: 'building',
          required: true,
          include: [{ model: Institute, as: 'institute' }],
        },
        { model: Equipment, as: 'equipment' },
      ],
      order: [['name', 'ASC']],
    });

    // 2) Filtro equipment richiesti (AND logic): l'aula deve avere TUTTI i
    //    type richiesti con quantity >= 1. Eseguito in JS per semplicità —
    //    inefficiente solo per N >> 1000 aule (qui largamente sufficiente).
    if (equipmentTypes.length > 0) {
      rooms = rooms.filter((room) => {
        const owned = new Set(
          (room.equipment || [])
            .filter((e) => (e.quantity ?? 0) >= 1 && e.isWorking !== false)
            .map((e) => e.type),
        );
        return equipmentTypes.every((req) => owned.has(req));
      });
    }

    // 3) Filtro disponibilità: scarta le aule con almeno 1 Booking confermato
    //    sovrapposto al range [from, to]. Una sola query bulk con WHERE roomId IN (...).
    if (from && to && rooms.length > 0) {
      const candidateIds = rooms.map((r) => r.id);
      const overlapping = await Booking.findAll({
        attributes: ['roomId'],
        where: {
          roomId: { [Op.in]: candidateIds },
          status: 'confirmed',
          // Overlap: !(end <= from || start >= to) ⇒ start < to AND end > from
          startTime: { [Op.lt]: to },
          endTime: { [Op.gt]: from },
        },
        raw: true,
      });
      const busyIds = new Set(overlapping.map((b) => b.roomId));
      rooms = rooms.filter((r) => !busyIds.has(r.id));
    }

    res.json({
      rooms,
      filters: {
        equipmentTypes,
        minCapacity,
        buildingId,
        type: roomType || null,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
      },
      total: rooms.length,
    });
  } catch (err) {
    next(err);
  }
});

// Lista aule con metadati QR per il pannello admin (no PNG, solo JSON).
// Espone anche lo stato effettivo del check-in risolto dalla cascata
// Room.requireCheckIn → Building.checkInDefault (vedi lib/checkInPolicy.js).
router.get('/rooms/qr-overview', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const rooms = await Room.findAll({
      attributes: ['id', 'name', 'code', 'requireCheckIn', 'qrToken', 'updatedAt'],
      include: [
        {
          association: 'building',
          attributes: ['id', 'name', 'checkInDefault'],
        },
      ],
      order: [
        [{ model: require('../../models').Building, as: 'building' }, 'name', 'ASC'],
        ['name', 'ASC'],
      ],
    });
    res.json({
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        building: r.building ? { id: r.building.id, name: r.building.name } : null,
        requireCheckIn: r.requireCheckIn,
        effectiveCheckIn: isCheckInRequired(r),
        inheritedFromBuilding: r.requireCheckIn === null || r.requireCheckIn === undefined,
        hasQrToken: !!r.qrToken,
        qrTokenUpdatedAt: r.qrToken ? r.updatedAt : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/rooms/:id', authenticate, async (req, res) => {
  const room = await Room.findByPk(req.params.id, {
    include: [
      { model: Building, as: 'building', include: [{ model: Institute, as: 'institute' }] },
      { model: Equipment, as: 'equipment' },
    ],
  });
  if (!room) throw httpError(404, 'Aula non trovata');
  res.json({ room });
});

router.post(
  '/rooms',
  authenticate,
  requireRole('admin'),
  [body('buildingId').isInt(), body('name').notEmpty().trim(), body('floor').notEmpty().trim()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) throw httpError(400, 'Validazione fallita', { details: errs.array() });
    const room = await Room.create(pickAllowed(req.body, ROOM_ALLOWED));
    res.status(201).json({ room });
  },
);

router.put('/rooms/:id', authenticate, requireRole('admin'), async (req, res) => {
  const r = await Room.findByPk(req.params.id);
  if (!r) throw httpError(404, 'Aula non trovata');
  await r.update(pickAllowed(req.body, ROOM_ALLOWED));
  res.json({ room: r });
});

module.exports = router;
