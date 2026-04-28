'use strict';

const express = require('express');
const { Op, Transaction } = require('sequelize');
const { body, validationResult } = require('express-validator');
const dayjs = require('dayjs');
const ics = require('ics');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const {
  sequelize,
  Booking,
  Room,
  User,
  Building,
  Institute,
  Equipment,
  ConcertInfo,
} = require('../models');
const {
  authenticate,
  requireRole,
  requireCompleteProfile,
  requireApproved,
} = require('../middleware/auth');
const { validateBooking, canCancel } = require('../services/bookingValidator');
const { sendBookingEmail } = require('../services/emailService');
const { buildIcs } = require('../services/icalService');
const { extractClientIp, isIpInCidrList, normalizeIp } = require('../lib/network');

const router = express.Router();

/**
 * Notifica gli admin attivi di una richiesta in attesa di approvazione.
 * Fire-and-forget: errori SMTP non bloccano la creazione della booking.
 */
async function notifyAdminsOfPendingBooking(booking) {
  const admins = await User.findAll({
    where: { role: 'admin', isActive: true },
    attributes: [
      'id',
      'firstName',
      'lastName',
      'email',
      'emailNotifications',
      'notifyOnConfirmation',
    ],
  });
  await Promise.all(
    admins
      .filter((a) => a.email && a.emailNotifications !== false)
      .map((admin) =>
        sendBookingEmail({
          user: admin,
          booking,
          kind: 'booking_pending_admin',
          // requester info embedded nel context: il template legge user.* in
          // intestazione, quindi sostituiamo lo "user" con il richiedente
          // mantenendo l'email di destinazione = admin.email.
          extra: {
            requesterName:
              `${booking.user?.firstName ?? ''} ${booking.user?.lastName ?? ''}`.trim(),
            requesterEmail: booking.user?.email ?? '',
          },
        }).catch(() => {}),
      ),
  );
}

// =====================================================
// GET /api/bookings/ical?token=<icalToken>
// Esporta in iCalendar le prenotazioni confermate dell'utente nei prossimi 90 giorni.
// Auth: query string ?token=<icalToken> (sola lettura) OPPURE Bearer JWT classico.
// Registrato PRIMA di /:id per evitare match come id="ical".
// =====================================================
router.get('/ical', async (req, res, next) => {
  try {
    let user = null;
    const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (queryToken) {
      user = await User.findOne({ where: { icalToken: queryToken } });
    } else {
      const auth = req.headers.authorization || '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) {
        try {
          const payload = jwt.verify(m[1], process.env.JWT_SECRET || 'dev-secret-change-me');
          user = await User.findByPk(payload.id);
        } catch {
          user = null;
        }
      }
    }
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Token non valido', code: 'INVALID_TOKEN' });
    }

    const from = dayjs().startOf('day').toDate();
    const to = dayjs().add(90, 'day').endOf('day').toDate();

    const bookings = await Booking.findAll({
      where: {
        userId: user.id,
        status: 'confirmed',
        startTime: { [Op.gte]: from, [Op.lte]: to },
      },
      include: [
        {
          model: Room,
          as: 'room',
          include: [{ model: Building, as: 'building' }],
        },
      ],
      order: [['startTime', 'ASC']],
    });

    const calendar = buildIcs(bookings, { calName: 'Aula Book' });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="aula-book.ics"');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(calendar);
  } catch (err) {
    next(err);
  }
});

// Isolation level per le scritture su prenotazioni:
// SERIALIZABLE evita race condition sulla rilevazione conflitti
// (validate + insert eseguiti come una sola unità logica).
// SQLite ignora il livello (è già single-writer); Postgres/MySQL lo applicano.
const WRITE_ISOLATION = Transaction.ISOLATION_LEVELS.SERIALIZABLE;

// =====================================================
// GET /api/bookings
// Filtri: from, to, roomId, userId (admin), mine=true
// =====================================================
router.get('/', authenticate, async (req, res) => {
  const where = {};

  if (req.query.from) where.startTime = { [Op.gte]: new Date(req.query.from) };
  if (req.query.to) {
    where.endTime = { ...(where.endTime || {}), [Op.lte]: new Date(req.query.to) };
  }
  if (req.query.roomId) where.roomId = req.query.roomId;
  if (req.query.status) where.status = req.query.status;

  if (req.query.mine === 'true') {
    where.userId = req.user.id;
  } else if (req.query.userId && req.user.role === 'admin') {
    where.userId = req.query.userId;
  }

  const bookings = await Booking.findAll({
    where,
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'matricola'],
      },
      {
        model: Room,
        as: 'room',
        include: [
          { model: Building, as: 'building', include: [{ model: Institute, as: 'institute' }] },
        ],
      },
      // Includiamo SOLO il titolo: usato dalla weekly view per renderizzare
      // i blocchi concerto. required:false per non escludere le altre booking.
      { model: ConcertInfo, as: 'concertInfo', attributes: ['title'], required: false },
    ],
    order: [['startTime', 'ASC']],
  });

  res.json({ bookings });
});

// =====================================================
// Check-in (anti ghost-booking) — costanti e config
// =====================================================
//
// Configurabile via env:
//   CHECKIN_EARLY_MINUTES     (default 5)  → quanto prima si può fare check-in
//   GHOST_GRACE_MINUTES       (default 15) → quanto dopo l'inizio scatta l'auto-cancel
const CHECKIN_EARLY_MINUTES = Math.max(0, Number(process.env.CHECKIN_EARLY_MINUTES) || 5);
const GHOST_GRACE_MINUTES = Math.max(1, Number(process.env.GHOST_GRACE_MINUTES) || 15);

// GET /api/bookings/checkin-candidates?roomId=...
//   Le prenotazioni dell'utente loggato in una specifica stanza per le quali
//   è/sarà a breve possibile il check-in. Usato dalla pagina /check-in/room/:id.
//   Registrata PRIMA di /:id per evitare il match dinamico.
router.get('/checkin-candidates', authenticate, async (req, res) => {
  const roomId = Number(req.query.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'roomId mancante', code: 'VALIDATION_FAILED' });
  }
  const now = dayjs();
  const windowStart = now.subtract(GHOST_GRACE_MINUTES, 'minute').toDate();
  const windowEnd = now.add(24, 'hour').toDate();

  const bookings = await Booking.findAll({
    where: {
      roomId,
      userId: req.user.id,
      status: 'confirmed',
      startTime: { [Op.between]: [windowStart, windowEnd] },
    },
    include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
    order: [['startTime', 'ASC']],
  });

  res.json({
    bookings,
    config: { earlyMinutes: CHECKIN_EARLY_MINUTES, graceMinutes: GHOST_GRACE_MINUTES },
  });
});

// =====================================================
// GET /api/bookings/:id
// =====================================================
router.get('/:id', authenticate, async (req, res) => {
  const booking = await Booking.findByPk(req.params.id, {
    include: [
      { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'email', 'role'] },
      {
        model: Room,
        as: 'room',
        include: [
          { model: Building, as: 'building', include: [{ model: Institute, as: 'institute' }] },
          { model: Equipment, as: 'equipment' },
        ],
      },
    ],
  });
  if (!booking)
    return res.status(404).json({ error: 'Prenotazione non trovata', code: 'NOT_FOUND' });
  if (booking.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorizzato', code: 'FORBIDDEN' });
  }
  res.json({ booking });
});

// =====================================================
// POST /api/bookings  - Crea prenotazione
// =====================================================
router.post(
  '/',
  authenticate,
  requireApproved,
  requireCompleteProfile,
  [
    body('roomId').isInt(),
    body('startTime').isISO8601(),
    body('endTime').isISO8601(),
    body('purpose').optional().trim(),
    body('type').optional().isIn(['studio_individuale', 'lezione', 'prova', 'concerto', 'altro']),
    body('onBehalfOfUserId').optional({ nullable: true }).isInt(),
  ],
  async (req, res, next) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });

    const { roomId, startTime, endTime, purpose, type, notes, onBehalfOfUserId } = req.body;

    try {
      // Risolve il proprietario della prenotazione: se admin specifica
      // `onBehalfOfUserId` differente dal proprio id, prenota PER quell'utente.
      // Per gli utenti non-admin il campo viene ignorato silenziosamente.
      let owner = req.user;
      const targetId = Number(onBehalfOfUserId);
      const isOnBehalf =
        req.user.role === 'admin' && Number.isInteger(targetId) && targetId !== req.user.id;
      if (isOnBehalf) {
        owner = await User.findByPk(targetId);
        if (!owner) {
          return res
            .status(400)
            .json({ error: 'Utente target non trovato', code: 'USER_NOT_FOUND' });
        }
        if (owner.status !== 'approved' || owner.isActive === false) {
          return res.status(400).json({
            error: 'Utente target non approvato o non attivo',
            code: 'USER_NOT_AVAILABLE',
          });
        }
      }

      // Aula "high-impact" (sala concerti, auditorium): per i non-admin la
      // prenotazione nasce in 'pending_approval' e richiede l'ok di un admin.
      // Gli admin bypassano (creano direttamente 'confirmed') anche quando
      // prenotano per conto di un altro utente.
      const room = await Room.findByPk(roomId);
      const needsApproval = room && room.requiresApproval === true && req.user.role !== 'admin';
      const initialStatus = needsApproval ? 'pending_approval' : 'confirmed';

      const booking = await sequelize.transaction(
        { isolationLevel: WRITE_ISOLATION },
        async (t) => {
          // Validazione contro l'owner (così rispetta i ruoli/aule consentiti
          // dell'utente target). Quando admin prenota per altri, bypassiamo le
          // quote del target: l'admin si assume la responsabilità della scelta.
          const validation = await validateBooking({
            user: owner,
            roomId,
            startTime,
            endTime,
            type,
            bypassQuotas: isOnBehalf,
            transaction: t,
          });
          if (!validation.valid) {
            const e = new Error(validation.errors[0] || 'Prenotazione non valida');
            e.status = 400;
            e.issues = validation.errors;
            // Propaga il primo `code` strutturato (es. QUOTA_EXCEEDED_*) al
            // middleware errori; fallback BOOKING_INVALID.
            e.code = validation.codes?.find((c) => !!c) || 'BOOKING_INVALID';
            throw e;
          }
          return Booking.create(
            {
              userId: owner.id,
              roomId,
              startTime,
              endTime,
              purpose: purpose || null,
              type: type || 'studio_individuale',
              notes: notes || null,
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
      // fire-and-forget email:
      //   - in attesa di approvazione: mail all'admin (non all'utente)
      //   - confermata: mail all'utente
      if (needsApproval) {
        notifyAdminsOfPendingBooking(full).catch(() => {});
      } else {
        sendBookingEmail({ user: full.user, booking: full, kind: 'confirmation' }).catch(() => {});
      }
      res.status(201).json({ booking: full });
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
      if (err.name === 'SequelizeForeignKeyConstraintError') {
        return res.status(400).json({
          error: 'Riferimento non valido (aula o utente inesistenti)',
          code: 'FK_CONSTRAINT',
        });
      }
      next(err);
    }
  },
);

// =====================================================
// POST /api/bookings/bulk-cancel — admin. Broadcast cancel multi-selezione.
// Body: { ids[], reason: string }. Aggiorna status='cancelled' + cancelReason
// e invia email kind='cancellation' a tutti i proprietari coinvolti.
// =====================================================
router.post('/bulk-cancel', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
    const reason =
      req.body?.reason && typeof req.body.reason === 'string'
        ? req.body.reason.trim().slice(0, 255)
        : "Cancellata dall'amministratore";

    const targets = await Booking.findAll({
      where: { id: { [Op.in]: ids }, status: 'confirmed' },
      attributes: ['id'],
    });
    const targetIds = targets.map((b) => b.id);
    if (targetIds.length === 0) {
      return res.json({ cancelled: 0, skipped: ids.length });
    }

    const now = new Date();
    await Booking.update(
      { status: 'cancelled', cancelledAt: now, cancelReason: reason },
      { where: { id: { [Op.in]: targetIds } } },
    );

    // Email fire-and-forget a ogni utente coinvolto
    const full = await Booking.findAll({
      where: { id: { [Op.in]: targetIds } },
      include: [
        {
          model: User,
          as: 'user',
          attributes: [
            'id',
            'firstName',
            'lastName',
            'role',
            'email',
            'emailNotifications',
            'notifyOnCancellation',
          ],
        },
        { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
      ],
    });
    for (const b of full) {
      sendBookingEmail({ user: b.user, booking: b, kind: 'cancellation' }).catch(() => {});
    }

    res.json({ cancelled: targetIds.length, skipped: ids.length - targetIds.length });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// Workflow approvazione prenotazioni high-impact (sale concerti, ecc).
// Solo admin. Le pending_approval non bloccano altri slot finché restano in
// attesa (vedi services/bookingValidator.js): l'admin sceglie quale richiesta
// confermare, ed eventuali concorrenti restano in attesa o vengono rifiutate.
// =====================================================

// GET /api/bookings/pending — lista in attesa (admin)
router.get('/pending', authenticate, requireRole('admin'), async (req, res) => {
  const bookings = await Booking.findAll({
    where: { status: 'pending_approval' },
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'matricola'],
      },
      { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
    ],
    order: [['createdAt', 'ASC']],
  });
  res.json({ bookings });
});

// GET /api/bookings/pending/count — solo conteggio per badge sidebar.
// Esposto a admin (l'utente normale non lo vede).
router.get('/pending/count', authenticate, requireRole('admin'), async (req, res) => {
  const count = await Booking.count({ where: { status: 'pending_approval' } });
  res.json({ count });
});

// GET /api/bookings/mine/pending — prenotazioni in attesa dell'utente loggato
router.get('/mine/pending', authenticate, async (req, res) => {
  const bookings = await Booking.findAll({
    where: { userId: req.user.id, status: 'pending_approval' },
    include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
    order: [['startTime', 'ASC']],
  });
  res.json({ bookings });
});

async function fetchBookingFull(id) {
  return Booking.findByPk(id, {
    include: [
      {
        model: User,
        as: 'user',
        attributes: [
          'id',
          'firstName',
          'lastName',
          'role',
          'email',
          'emailNotifications',
          'notifyOnConfirmation',
          'notifyOnCancellation',
        ],
      },
      { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
    ],
  });
}

// POST /api/bookings/:id/approve — admin approva richiesta pending.
// Verifica conflitti al momento dell'approvazione: se nel frattempo è nato
// un confirmed sovrapposto, l'approvazione fallisce con 409.
router.post('/:id/approve', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await sequelize.transaction({ isolationLevel: WRITE_ISOLATION }, async (t) => {
      const booking = await Booking.findByPk(req.params.id, { transaction: t });
      if (!booking) {
        const e = new Error('Prenotazione non trovata');
        e.status = 404;
        e.code = 'NOT_FOUND';
        throw e;
      }
      if (booking.status !== 'pending_approval') {
        const e = new Error('La prenotazione non è in attesa di approvazione');
        e.status = 400;
        e.code = 'BOOKING_INVALID_STATE';
        throw e;
      }
      // Conflict check: nessuna confirmed che si sovrapponga sullo stesso roomId.
      const conflict = await Booking.findOne({
        where: {
          roomId: booking.roomId,
          status: 'confirmed',
          id: { [Op.ne]: booking.id },
          [Op.and]: [
            { startTime: { [Op.lt]: booking.endTime } },
            { endTime: { [Op.gt]: booking.startTime } },
          ],
        },
        transaction: t,
      });
      if (conflict) {
        const e = new Error(
          "Slot non più disponibile: nel frattempo è stata confermata un'altra prenotazione",
        );
        e.status = 409;
        e.code = 'BOOKING_CONFLICT';
        throw e;
      }
      await booking.update({ status: 'confirmed' }, { transaction: t });
      return booking;
    });
    const full = await fetchBookingFull(result.id);
    sendBookingEmail({ user: full.user, booking: full, kind: 'booking_approved' }).catch(() => {});
    res.json({ booking: full });
  } catch (err) {
    next(err);
  }
});

// POST /api/bookings/:id/reject — admin rifiuta richiesta pending.
// Body opzionale: { reason: string } salvato in cancelReason per la mail.
router.post('/:id/reject', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const reason =
      req.body && typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 255) : null;
    const booking = await Booking.findByPk(req.params.id);
    if (!booking)
      return res.status(404).json({ error: 'Prenotazione non trovata', code: 'NOT_FOUND' });
    if (booking.status !== 'pending_approval') {
      return res.status(400).json({
        error: 'La prenotazione non è in attesa di approvazione',
        code: 'BOOKING_INVALID_STATE',
      });
    }
    await booking.update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason || 'Richiesta non approvata',
    });
    const full = await fetchBookingFull(booking.id);
    sendBookingEmail({ user: full.user, booking: full, kind: 'booking_rejected' }).catch(() => {});
    res.json({ booking: full });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// PUT /api/bookings/:id  - Modifica prenotazione
// =====================================================
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const updated = await sequelize.transaction({ isolationLevel: WRITE_ISOLATION }, async (t) => {
      const booking = await Booking.findByPk(req.params.id, { transaction: t });
      if (!booking) {
        const e = new Error('Prenotazione non trovata');
        e.status = 404;
        throw e;
      }
      const isAdmin = req.user.role === 'admin';
      if (booking.userId !== req.user.id && !isAdmin) {
        const e = new Error('Non autorizzato');
        e.status = 403;
        throw e;
      }
      if (booking.status !== 'confirmed') {
        const e = new Error('Prenotazione non modificabile (già cancellata o conclusa)');
        e.status = 400;
        throw e;
      }

      const newStart = req.body.startTime || booking.startTime;
      const newEnd = req.body.endTime || booking.endTime;
      const newRoomId = req.body.roomId || booking.roomId;

      // Riassegnazione owner: solo admin può cambiare `userId`. Se omesso o
      // uguale, owner resta l'attuale. Validazione usa l'owner risultante per
      // verificare permessi sull'aula (allowedRoles, allowedCourseIds).
      let newOwner = await User.findByPk(booking.userId, { transaction: t });
      const targetUserId = req.body.userId !== undefined ? Number(req.body.userId) : null;
      const isReassign =
        isAdmin && Number.isInteger(targetUserId) && targetUserId !== booking.userId;
      if (isReassign) {
        const candidate = await User.findByPk(targetUserId, { transaction: t });
        if (!candidate) {
          const e = new Error('Utente target non trovato');
          e.status = 400;
          e.code = 'USER_NOT_FOUND';
          throw e;
        }
        if (candidate.status !== 'approved' || candidate.isActive === false) {
          const e = new Error('Utente target non approvato o non attivo');
          e.status = 400;
          e.code = 'USER_NOT_AVAILABLE';
          throw e;
        }
        newOwner = candidate;
      }
      // Admin che agisce su prenotazione altrui (modifica o riassegnazione):
      // bypassa le quote del proprietario per permettere correzioni manuali.
      const adminActingOnOther = isAdmin && newOwner.id !== req.user.id;

      const validation = await validateBooking({
        user: newOwner,
        roomId: newRoomId,
        startTime: newStart,
        endTime: newEnd,
        type: req.body.type ?? booking.type,
        ignoreBookingId: booking.id,
        bypassQuotas: adminActingOnOther,
        transaction: t,
      });
      if (!validation.valid) {
        const e = new Error(validation.errors[0] || 'Modifica non valida');
        e.status = 400;
        e.issues = validation.errors;
        e.code = validation.codes?.find((c) => !!c) || 'BOOKING_INVALID';
        throw e;
      }

      await booking.update(
        {
          startTime: newStart,
          endTime: newEnd,
          roomId: newRoomId,
          userId: isReassign ? newOwner.id : booking.userId,
          purpose: req.body.purpose ?? booking.purpose,
          type: req.body.type ?? booking.type,
          notes: req.body.notes ?? booking.notes,
        },
        { transaction: t },
      );

      return booking;
    });

    res.json({ booking: updated });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: err.message,
        ...(err.code && { code: err.code }),
        ...(err.issues && { issues: err.issues }),
      });
    }
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Conflitto: prenotazione già esistente' });
    }
    next(err);
  }
});

// =====================================================
// DELETE /api/bookings/:id  - Cancella prenotazione
// =====================================================
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const booking = await sequelize.transaction(async (t) => {
      const b = await Booking.findByPk(req.params.id, { transaction: t });
      if (!b) {
        const e = new Error('Prenotazione non trovata');
        e.status = 404;
        throw e;
      }

      const check = await canCancel(req.user, b);
      if (!check.ok) {
        const e = new Error(check.reason);
        e.status = 403;
        throw e;
      }

      await b.update(
        {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: req.body.reason || null,
        },
        { transaction: t },
      );
      return b;
    });
    // Recupero esteso per inviare email
    const full = await Booking.findByPk(booking.id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstName', 'lastName', 'email', 'emailNotifications'],
        },
        { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
      ],
    });
    if (full?.user) {
      sendBookingEmail({ user: full.user, booking: full, kind: 'cancellation' }).catch(() => {});
    }
    res.json({ message: 'Prenotazione cancellata', booking });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// =====================================================
// GET /api/bookings/availability/:roomId?date=YYYY-MM-DD
// Restituisce gli slot occupati di un'aula in un giorno
// =====================================================
// =====================================================
// POST /api/bookings/recurring
// Body: { roomId, startTime, endTime, type, purpose, notes,
//         recurrence: { weeks: number } }
// Genera N prenotazioni a cadenza settimanale (stessa fascia oraria,
// +7gg ogni iterazione). Ogni prenotazione è validata individualmente:
// quelle in conflitto non vengono create ma riportate in "skipped".
// Vincolo: BookingRule.allowRecurring = true per il ruolo dell'utente.
// =====================================================
const { BookingRule } = require('../models');
router.post(
  '/recurring',
  authenticate,
  requireApproved,
  requireCompleteProfile,
  async (req, res, next) => {
    const { roomId, startTime, endTime, type, purpose, notes, recurrence } = req.body || {};
    const weeks = Number(recurrence?.weeks);
    if (!roomId || !startTime || !endTime) {
      return res
        .status(400)
        .json({ error: 'roomId, startTime e endTime obbligatori', code: 'VALIDATION_FAILED' });
    }
    if (!Number.isInteger(weeks) || weeks < 2 || weeks > 52) {
      return res.status(400).json({
        error: 'recurrence.weeks deve essere un intero tra 2 e 52',
        code: 'VALIDATION_FAILED',
      });
    }

    // Verifica se il ruolo permette ricorrenze
    const rule = await BookingRule.findOne({ where: { role: req.user.role } });
    if (rule && rule.allowRecurring === false) {
      return res.status(403).json({
        code: 'RECURRING_NOT_ALLOWED',
        error: 'Il tuo ruolo non può creare prenotazioni ricorrenti.',
      });
    }

    const created = [];
    const skipped = [];

    for (let i = 0; i < weeks; i++) {
      const offset = i * 7 * 24 * 60 * 60 * 1000;
      const s = new Date(new Date(startTime).getTime() + offset);
      const e = new Date(new Date(endTime).getTime() + offset);
      try {
        const booking = await sequelize.transaction(
          { isolationLevel: WRITE_ISOLATION },
          async (t) => {
            const validation = await validateBooking({
              user: req.user,
              roomId,
              startTime: s,
              endTime: e,
              type: type || 'studio_individuale',
              transaction: t,
            });
            if (!validation.valid) {
              const err = new Error((validation.errors || []).join('; ') || 'Validazione fallita');
              err.status = 400;
              err.code = validation.codes?.find((c) => !!c) || 'BOOKING_INVALID';
              throw err;
            }
            return Booking.create(
              {
                userId: req.user.id,
                roomId,
                startTime: s,
                endTime: e,
                purpose: purpose || null,
                type: type || 'studio_individuale',
                notes: notes || null,
                status: 'confirmed',
              },
              { transaction: t },
            );
          },
        );
        created.push(booking.id);
      } catch (err) {
        skipped.push({
          date: s.toISOString().slice(0, 10),
          reason: err.message || 'Errore',
        });
      }
    }

    // Email su ciascuna create (in batch, non bloccante)
    if (created.length > 0) {
      const list = await Booking.findAll({
        where: { id: created },
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstName', 'lastName', 'email', 'emailNotifications'],
          },
          { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
        ],
      });
      for (const b of list) {
        sendBookingEmail({ user: b.user, booking: b, kind: 'confirmation' }).catch(() => {});
      }
    }

    res.json({
      created: created.length,
      skipped,
      bookingIds: created,
    });
  },
);

// =====================================================
// GET /api/bookings/usage/me
// Restituisce ore prenotate / residue per l'utente corrente,
// settimanali e giornaliere (settimana ISO lun→dom, giorno odierno).
// =====================================================
router.get('/usage/me', authenticate, async (req, res, next) => {
  try {
    const rule = await BookingRule.findOne({ where: { role: req.user.role } });
    const weekStart = dayjs().startOf('isoWeek').toDate();
    const weekEnd = dayjs().endOf('isoWeek').toDate();
    const dayStart = dayjs().startOf('day').toDate();
    const dayEnd = dayjs().endOf('day').toDate();

    // Base: tutte le booking dell'utente nell'arco settimana / giorno con
    // l'aula caricata per poter raggrupare per scope. Una sola query per
    // periodo evita N+1.
    const [weekBookings, dayBookings] = await Promise.all([
      Booking.findAll({
        where: {
          userId: req.user.id,
          status: 'confirmed',
          startTime: { [Op.gte]: weekStart, [Op.lte]: weekEnd },
        },
        include: [{ model: Room, as: 'room', attributes: ['id', 'type'] }],
      }),
      Booking.findAll({
        where: {
          userId: req.user.id,
          status: 'confirmed',
          startTime: { [Op.gte]: dayStart, [Op.lte]: dayEnd },
        },
        include: [{ model: Room, as: 'room', attributes: ['id', 'type'] }],
      }),
    ]);

    const sumHours = (list) =>
      Math.round(
        list.reduce((acc, b) => acc + dayjs(b.endTime).diff(dayjs(b.startTime), 'minute'), 0) / 6,
      ) / 10;

    const weekUsed = sumHours(weekBookings);
    const dayUsed = sumHours(dayBookings);
    const isAdmin = req.user.role === 'admin';
    const weekMax = rule?.maxHoursPerWeek ?? null;
    const dayMax = rule?.maxHoursPerDay ?? null;

    // -------- Quote per risorsa: aggregazione consumi per scope --------
    // Recuperiamo le quote attive del ruolo e per ognuna calcoliamo il
    // consumo (settimanale + giornaliero) restringendo le booking alle
    // sole righe che ricadono nello scope.
    const { BookingQuota, Equipment } = require('../models');
    const quotas = await BookingQuota.findAll({
      where: { role: req.user.role, isActive: true },
    });

    // Pre-aggregazione: id stanza → set di equipment types presenti.
    // Usiamo un'unica query che copre tutti gli equipment di tutte le
    // stanze toccate dall'utente nei due periodi (settimana ∪ giorno).
    const touchedRoomIds = [
      ...new Set([...weekBookings.map((b) => b.roomId), ...dayBookings.map((b) => b.roomId)]),
    ];
    const equipByRoom = new Map();
    if (touchedRoomIds.length > 0) {
      const eqs = await Equipment.findAll({
        where: { roomId: { [Op.in]: touchedRoomIds } },
        attributes: ['roomId', 'type'],
      });
      for (const e of eqs) {
        if (!equipByRoom.has(e.roomId)) equipByRoom.set(e.roomId, new Set());
        equipByRoom.get(e.roomId).add(e.type);
      }
    }

    const matchesScope = (booking, quota) => {
      if (quota.scopeKind === 'global') return true;
      if (quota.scopeKind === 'roomType') return booking.room?.type === quota.scopeValue;
      if (quota.scopeKind === 'equipmentType') {
        return equipByRoom.get(booking.roomId)?.has(quota.scopeValue) ?? false;
      }
      return false;
    };

    const sumMatching = (list, quota) => sumHours(list.filter((b) => matchesScope(b, quota)));

    const quotaUsage = quotas.map((q) => {
      const usedWeek = q.maxHoursPerWeek > 0 ? sumMatching(weekBookings, q) : 0;
      const usedDay = q.maxHoursPerDay > 0 ? sumMatching(dayBookings, q) : 0;
      return {
        id: q.id,
        scopeKind: q.scopeKind,
        scopeValue: q.scopeKind === 'global' ? null : q.scopeValue,
        maxHoursPerWeek: q.maxHoursPerWeek,
        maxHoursPerDay: q.maxHoursPerDay,
        usedHoursWeek: usedWeek,
        usedHoursDay: usedDay,
        remainingHoursWeek:
          q.maxHoursPerWeek > 0
            ? Math.max(0, Math.round((q.maxHoursPerWeek - usedWeek) * 10) / 10)
            : null,
        remainingHoursDay:
          q.maxHoursPerDay > 0
            ? Math.max(0, Math.round((q.maxHoursPerDay - usedDay) * 10) / 10)
            : null,
      };
    });

    // Per comodità del frontend, separiamo le quote per scope in 3 array.
    // Gli admin sono "unlimited" rispetto a BookingRule ma le BookingQuota
    // del loro ruolo, se attive, vengono comunque applicate dal validator
    // (futura politica): le ritorniamo per trasparenza.
    const byRoomType = quotaUsage.filter((q) => q.scopeKind === 'roomType');
    const byEquipment = quotaUsage.filter((q) => q.scopeKind === 'equipmentType');
    const globalQuotas = quotaUsage.filter((q) => q.scopeKind === 'global');

    res.json({
      unlimited: isAdmin,
      // Backward-compat: i due blocchi `weekly` e `daily` non cambiano.
      weekly: {
        max: weekMax,
        usedHours: weekUsed,
        remainingHours:
          weekMax != null && !isAdmin
            ? Math.max(0, Math.round((weekMax - weekUsed) * 10) / 10)
            : null,
        periodFrom: dayjs(weekStart).format('YYYY-MM-DD'),
        periodTo: dayjs(weekEnd).format('YYYY-MM-DD'),
      },
      daily: {
        max: dayMax,
        usedHours: dayUsed,
        remainingHours:
          dayMax != null && !isAdmin ? Math.max(0, Math.round((dayMax - dayUsed) * 10) / 10) : null,
      },
      // Nuovo: aggregazione per quote dinamiche.
      global: globalQuotas,
      byRoomType,
      byEquipment,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/availability/:roomId', authenticate, async (req, res) => {
  const date = req.query.date ? dayjs(req.query.date) : dayjs();
  const dayStart = date.startOf('day').toDate();
  const dayEnd = date.endOf('day').toDate();

  const bookings = await Booking.findAll({
    where: {
      roomId: req.params.roomId,
      status: 'confirmed',
      startTime: { [Op.gte]: dayStart, [Op.lte]: dayEnd },
    },
    include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'role'] }],
    order: [['startTime', 'ASC']],
  });

  res.json({ date: date.format('YYYY-MM-DD'), bookings });
});

// POST /api/bookings/:id/checkin
//   Marca checkedInAt=now se:
//     - utente è il proprietario
//     - status === 'confirmed'
//     - now è in [startTime - CHECKIN_EARLY_MINUTES, startTime + GHOST_GRACE_MINUTES]
//     - non ancora confermato
//     - body.qrToken (se fornito) matcha Room.qrToken corrente — invalida i QR
//       stampati prima dell'ultima rigenerazione. Se assente, accettato per
//       compat con flow manuale (pulsante "Conferma presenza" senza scansione).
//     - se Institute.checkInRequireInstituteNetwork=true, l'IP del client deve
//       cadere in Institute.instituteNetworkCidrs.
router.post('/:id/checkin', authenticate, async (req, res) => {
  const booking = await Booking.findByPk(req.params.id);
  if (!booking) {
    return res.status(404).json({ error: 'Prenotazione non trovata', code: 'NOT_FOUND' });
  }
  if (booking.userId !== req.user.id) {
    return res.status(403).json({ error: 'Non autorizzato', code: 'FORBIDDEN' });
  }
  if (booking.checkedInAt) {
    return res.status(409).json({
      error: 'Check-in già effettuato',
      code: 'ALREADY_CHECKED_IN',
      checkedInAt: booking.checkedInAt,
    });
  }
  if (booking.status !== 'confirmed') {
    return res.status(400).json({
      error: 'La prenotazione non è confermata',
      code: 'CHECKIN_INVALID_STATUS',
    });
  }

  // Validazione token QR (se fornito): se il token non matcha quello corrente
  // dell'aula, il QR è obsoleto (rigenerato dopo la stampa).
  const providedToken =
    req.body && typeof req.body.qrToken === 'string' ? req.body.qrToken.trim() : null;
  if (providedToken) {
    const room = await Room.findByPk(booking.roomId, { attributes: ['id', 'qrToken'] });
    if (!room || !room.qrToken || room.qrToken !== providedToken) {
      return res.status(400).json({
        error: "QR-code non valido o scaduto: chiedere all'admin di stampare il QR aggiornato",
        code: 'CHECKIN_INVALID_QR_TOKEN',
      });
    }
  }

  // Validazione rete d'istituto (se abilitata).
  const institute = await Institute.findOne({
    attributes: ['checkInRequireInstituteNetwork', 'instituteNetworkCidrs'],
    order: [['id', 'ASC']],
  });
  if (institute && institute.checkInRequireInstituteNetwork) {
    const cidrs = Array.isArray(institute.instituteNetworkCidrs)
      ? institute.instituteNetworkCidrs
      : [];
    const clientIp = extractClientIp(req);
    if (cidrs.length === 0 || !isIpInCidrList(clientIp, cidrs)) {
      return res.status(403).json({
        error: "Check-in consentito solo dalla rete d'istituto",
        code: 'CHECKIN_NETWORK_RESTRICTED',
        clientIp: normalizeIp(clientIp),
      });
    }
  }

  const now = dayjs();
  const start = dayjs(booking.startTime);
  const minTime = start.subtract(CHECKIN_EARLY_MINUTES, 'minute');
  const maxTime = start.add(GHOST_GRACE_MINUTES, 'minute');

  if (now.isBefore(minTime)) {
    return res.status(400).json({
      error: `Il check-in apre ${CHECKIN_EARLY_MINUTES} minuti prima dell'inizio`,
      code: 'CHECKIN_TOO_EARLY',
      opensAt: minTime.toISOString(),
    });
  }
  if (now.isAfter(maxTime)) {
    return res.status(400).json({
      error: `Il check-in si chiude ${GHOST_GRACE_MINUTES} minuti dopo l'inizio`,
      code: 'CHECKIN_TOO_LATE',
      closedAt: maxTime.toISOString(),
    });
  }

  booking.checkedInAt = new Date();
  await booking.save();
  res.json({ booking, message: 'Check-in registrato' });
});

// =====================================================
// Scheda concerto (1:1 con Booking di tipo 'concerto')
// =====================================================
//
//   GET    /api/bookings/:id/concert         → leggi scheda (404 se non esiste)
//   PUT    /api/bookings/:id/concert         → upsert scheda (title obbligatorio)
//   DELETE /api/bookings/:id/concert         → cancella scheda + locandina
//   POST   /api/bookings/:id/concert/poster  → carica locandina (sharp 1200x675 webp)
//   DELETE /api/bookings/:id/concert/poster  → rimuovi locandina
//
// Permessi: owner della booking oppure admin.
// Vincolo: la booking deve avere type = 'concerto'.

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_POSTER_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
const POSTER_TARGET_WIDTH = 1200;
const POSTER_TARGET_HEIGHT = 1600; // 3:4 verticale (formato locandina)
const posterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_POSTER_MIME.includes(file.mimetype)) {
      return cb(new Error('Formato non supportato (usa PNG, JPG, WEBP o HEIC)'));
    }
    cb(null, true);
  },
});

function tryDeleteOldPoster(posterUrl) {
  if (!posterUrl || !posterUrl.startsWith('/storage/')) return;
  const file = path.basename(posterUrl);
  fs.unlink(path.join(UPLOADS_DIR, file), () => {});
}

async function loadConcertContext(bookingId, user) {
  const booking = await Booking.findByPk(bookingId, {
    include: [{ model: ConcertInfo, as: 'concertInfo' }],
  });
  if (!booking)
    return { error: { status: 404, code: 'NOT_FOUND', message: 'Prenotazione non trovata' } };
  if (booking.userId !== user.id && user.role !== 'admin') {
    return { error: { status: 403, code: 'FORBIDDEN', message: 'Non autorizzato' } };
  }
  if (booking.type !== 'concerto') {
    return {
      error: {
        status: 400,
        code: 'CONCERT_INVALID_TYPE',
        message: 'La prenotazione non è di tipo concerto',
      },
    };
  }
  return { booking };
}

router.get('/:id/concert', authenticate, async (req, res, next) => {
  try {
    const { booking, error } = await loadConcertContext(req.params.id, req.user);
    if (error) return res.status(error.status).json({ error: error.message, code: error.code });
    if (!booking.concertInfo)
      return res
        .status(404)
        .json({ error: 'Scheda concerto non presente', code: 'CONCERT_NOT_FOUND' });
    res.json({ concertInfo: booking.concertInfo });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/concert', authenticate, async (req, res, next) => {
  try {
    const { booking, error } = await loadConcertContext(req.params.id, req.user);
    if (error) return res.status(error.status).json({ error: error.message, code: error.code });

    const title = (req.body?.title || '').toString().trim();
    if (!title) {
      return res.status(400).json({ error: 'Titolo obbligatorio', code: 'CONCERT_TITLE_REQUIRED' });
    }
    const performers = (req.body?.performers ?? '').toString();
    const program = (req.body?.program ?? '').toString();

    if (booking.concertInfo) {
      await booking.concertInfo.update({ title, performers, program });
      return res.json({ concertInfo: booking.concertInfo });
    }
    const created = await ConcertInfo.create({
      bookingId: booking.id,
      title,
      performers,
      program,
      posterUrl: null,
    });
    res.status(201).json({ concertInfo: created });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/concert', authenticate, async (req, res, next) => {
  try {
    const { booking, error } = await loadConcertContext(req.params.id, req.user);
    if (error) return res.status(error.status).json({ error: error.message, code: error.code });
    if (!booking.concertInfo) return res.json({ message: 'Nessuna scheda da cancellare' });
    tryDeleteOldPoster(booking.concertInfo.posterUrl);
    await booking.concertInfo.destroy();
    res.json({ message: 'Scheda concerto cancellata' });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/concert/poster',
  authenticate,
  posterUpload.single('file'),
  async (req, res, next) => {
    try {
      const { booking, error } = await loadConcertContext(req.params.id, req.user);
      if (error) return res.status(error.status).json({ error: error.message, code: error.code });
      if (!booking.concertInfo) {
        return res
          .status(400)
          .json({ error: 'Crea prima la scheda concerto', code: 'CONCERT_NOT_FOUND' });
      }
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'Nessun file caricato', code: 'VALIDATION_FAILED' });
      }
      const processed = await sharp(req.file.buffer)
        .rotate()
        .resize({
          width: POSTER_TARGET_WIDTH,
          height: POSTER_TARGET_HEIGHT,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();

      const filename = `concert-${booking.id}-${Date.now()}.webp`;
      await fs.promises.writeFile(path.join(UPLOADS_DIR, filename), processed);
      tryDeleteOldPoster(booking.concertInfo.posterUrl);
      const newUrl = `/storage/${filename}`;
      await booking.concertInfo.update({ posterUrl: newUrl });
      res.json({ concertInfo: booking.concertInfo, posterUrl: newUrl });
    } catch (err) {
      if (err && err.message && /sharp|input|unsupported/i.test(err.message)) {
        return res.status(400).json({
          error: 'Immagine non valida o formato non supportato',
          code: 'FILE_FORMAT_UNSUPPORTED',
        });
      }
      next(err);
    }
  },
);

router.delete('/:id/concert/poster', authenticate, async (req, res, next) => {
  try {
    const { booking, error } = await loadConcertContext(req.params.id, req.user);
    if (error) return res.status(error.status).json({ error: error.message, code: error.code });
    if (!booking.concertInfo) return res.json({ message: 'Nessuna locandina' });
    tryDeleteOldPoster(booking.concertInfo.posterUrl);
    await booking.concertInfo.update({ posterUrl: null });
    res.json({ concertInfo: booking.concertInfo });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
