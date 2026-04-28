'use strict';

const express = require('express');
const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { sequelize, BookingWaitlist, Booking, Room, Building, User } = require('../models');
const { authenticate, requireApproved, requireCompleteProfile } = require('../middleware/auth');
const { validateBooking } = require('../services/bookingValidator');
const { sendBookingEmail } = require('../services/emailService');

const router = express.Router();

// =====================================================
// GET /api/bookings/waitlist/me
// Le code attive dell'utente: in coda + notificate (non ancora claim/cancel).
// =====================================================
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const entries = await BookingWaitlist.findAll({
      where: {
        userId: req.user.id,
        claimedAt: null,
        cancelledAt: null,
      },
      include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
      order: [['startTime', 'ASC']],
    });
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// POST /api/bookings/waitlist
// Body: { roomId, startTime, endTime, type?, purpose? }
// Iscrive l'utente alla coda d'attesa per uno slot in conflitto. Calcola
// la `position` come max+1 nella stessa room.
//
// Vincoli:
//   - lo slot deve essere effettivamente in conflitto (oppure si tratterebbe
//     di una booking valida che andava creata direttamente)
//   - lo stesso utente non può iscriversi due volte allo stesso slot (idempotenza)
//   - lo slot deve essere nel futuro
// =====================================================
router.post('/', authenticate, requireApproved, requireCompleteProfile, async (req, res, next) => {
  try {
    const { roomId, startTime, endTime, type, purpose } = req.body || {};
    if (!roomId || !startTime || !endTime) {
      return res
        .status(400)
        .json({ error: 'roomId, startTime e endTime obbligatori', code: 'VALIDATION_FAILED' });
    }
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ error: 'Date non valide', code: 'VALIDATION_FAILED' });
    }
    if (start < new Date()) {
      return res
        .status(400)
        .json({ error: 'Lo slot deve essere nel futuro', code: 'WAITLIST_PAST' });
    }

    // Verifica esistenza/permessi della stanza riusando il validator
    // standard (capacità, ruoli, corso). Lo slot ATTUALE deve essere
    // confliggente: se non lo fosse, l'utente potrebbe semplicemente
    // creare la booking. Riconosciamo questo caso e rispondiamo 409
    // BOOKING_AVAILABLE per dirgli "non serve la coda, prenota direttamente".
    const validation = await validateBooking({
      user: req.user,
      roomId,
      startTime: start,
      endTime: end,
      type: type || 'studio_individuale',
    });
    const conflictMsg = (validation.errors || []).find(
      (m) => typeof m === 'string' && /già prenotata/i.test(m),
    );
    if (validation.valid || !conflictMsg) {
      return res.status(409).json({
        error: 'Lo slot è disponibile, prenota direttamente',
        code: 'WAITLIST_NOT_NEEDED',
      });
    }

    // Idempotenza: stessa coppia (user, room, slot) → ritorna l'entry esistente
    const existing = await BookingWaitlist.findOne({
      where: {
        userId: req.user.id,
        roomId,
        startTime: start,
        endTime: end,
        cancelledAt: null,
        claimedAt: null,
      },
      include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
    });
    if (existing) {
      return res.status(200).json({ entry: existing, message: 'Già in coda' });
    }

    // Posizione = max(position) + 1 sulla room (entries non chiuse)
    const entry = await sequelize.transaction(async (t) => {
      const max = await BookingWaitlist.max('position', {
        where: {
          roomId,
          cancelledAt: null,
          claimedAt: null,
        },
        transaction: t,
      });
      const position = typeof max === 'number' ? max + 1 : 0;
      const created = await BookingWaitlist.create(
        {
          userId: req.user.id,
          roomId,
          startTime: start,
          endTime: end,
          position,
          type: type || 'studio_individuale',
          purpose: purpose ? String(purpose).trim() : null,
        },
        { transaction: t },
      );
      return created;
    });

    // Reload con room+building per la response
    const full = await BookingWaitlist.findByPk(entry.id, {
      include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
    });
    res.status(201).json({ entry: full });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// POST /api/bookings/waitlist/:id/claim
// Riscatta una notifica waitlist: tenta di creare la booking dallo slot
// in coda. Vincoli:
//   - solo l'owner della entry può richiamarla
//   - deve essere stata notificata e non ancora scaduta/usata/cancellata
//   - lo slot deve essere ancora libero (potrebbe essersi ricreato un
//     conflict nel frattempo se altre operazioni concorrenti)
// =====================================================
router.post(
  '/:id/claim',
  authenticate,
  requireApproved,
  requireCompleteProfile,
  async (req, res, next) => {
    try {
      const entry = await BookingWaitlist.findByPk(req.params.id, {
        include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
      });
      if (!entry) return res.status(404).json({ error: 'Coda non trovata', code: 'NOT_FOUND' });
      if (entry.userId !== req.user.id) {
        return res
          .status(403)
          .json({ error: 'Non sei il proprietario della coda', code: 'FORBIDDEN' });
      }
      if (entry.claimedAt) {
        return res
          .status(409)
          .json({ error: 'Coda già riscattata', code: 'WAITLIST_ALREADY_CLAIMED' });
      }
      if (entry.cancelledAt) {
        return res.status(409).json({ error: 'Coda annullata', code: 'WAITLIST_CANCELLED' });
      }
      if (!entry.notifiedAt) {
        return res
          .status(409)
          .json({ error: 'Non sei ancora il prossimo in coda', code: 'WAITLIST_NOT_YOUR_TURN' });
      }
      if (entry.expiresAt && entry.expiresAt < new Date()) {
        return res
          .status(409)
          .json({ error: 'Tempo per il claim scaduto', code: 'WAITLIST_EXPIRED' });
      }

      // Crea la booking + chiude la entry in una transazione SERIALIZABLE
      const result = await sequelize.transaction(
        {
          isolationLevel: sequelize.Transaction?.ISOLATION_LEVELS?.SERIALIZABLE,
        },
        async (t) => {
          const validation = await validateBooking({
            user: req.user,
            roomId: entry.roomId,
            startTime: entry.startTime,
            endTime: entry.endTime,
            type: entry.type || 'studio_individuale',
            transaction: t,
          });
          if (!validation.valid) {
            const e = new Error(validation.errors[0] || 'Slot non più disponibile');
            e.status = 409;
            e.code = validation.codes?.find((c) => !!c) || 'BOOKING_CONFLICT';
            throw e;
          }
          const booking = await Booking.create(
            {
              userId: req.user.id,
              roomId: entry.roomId,
              startTime: entry.startTime,
              endTime: entry.endTime,
              type: entry.type || 'studio_individuale',
              purpose: entry.purpose,
              status: 'confirmed',
            },
            { transaction: t },
          );
          await entry.update({ claimedAt: new Date() }, { transaction: t });
          // Sposta in giù le posizioni successive (la entry esce dalla coda)
          await BookingWaitlist.decrement('position', {
            by: 1,
            where: {
              roomId: entry.roomId,
              position: { [Op.gt]: entry.position },
              cancelledAt: null,
              claimedAt: null,
            },
            transaction: t,
          });
          return booking;
        },
      );

      // Reload con utente per email confirmation
      const full = await Booking.findByPk(result.id, {
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'emailNotifications'],
          },
          { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
        ],
      });
      sendBookingEmail({ user: full.user, booking: full, kind: 'confirmation' }).catch(() => {});
      res.status(201).json({ booking: full, message: 'Coda riscattata, prenotazione confermata' });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      next(err);
    }
  },
);

// =====================================================
// DELETE /api/bookings/waitlist/:id
// Cancella la propria iscrizione alla coda. Decrementa le posizioni
// dei successivi nella stessa room. Soft delete via paranoid.
// =====================================================
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const entry = await BookingWaitlist.findByPk(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Coda non trovata', code: 'NOT_FOUND' });
    if (entry.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Non autorizzato', code: 'FORBIDDEN' });
    }
    await sequelize.transaction(async (t) => {
      await entry.update(
        {
          cancelledAt: new Date(),
          cancelReason: 'manual cancel',
        },
        { transaction: t },
      );
      await BookingWaitlist.decrement('position', {
        by: 1,
        where: {
          roomId: entry.roomId,
          position: { [Op.gt]: entry.position },
          cancelledAt: null,
          claimedAt: null,
        },
        transaction: t,
      });
    });
    res.json({ message: 'Iscrizione alla coda cancellata' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
