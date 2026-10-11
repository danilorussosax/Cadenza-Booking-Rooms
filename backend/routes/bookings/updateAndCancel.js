'use strict';

const { sequelize, Booking, Room, User, Building } = require('../../models');
const { authenticate, requireCompleteProfile, requireApproved } = require('../../middleware/auth');
const { validateBooking, canCancel } = require('../../services/bookingValidator');
const { sendBookingEmail } = require('../../services/emailService');

/**
 * Notifica gli admin attivi di una richiesta in attesa di approvazione.
 * Fire-and-forget: errori SMTP non bloccano la creazione della booking.
 */
const { bookingStatus, notifyAdminsOfPendingBooking } = require('../../services/bookingPolicy');
const { withSerializableRetry } = require('../../lib/serializableTx');
const { WRITE_ISOLATION } = require('./shared');

module.exports = function registerUpdateAndCancel(router) {
  // =====================================================
  // PUT /api/bookings/:id  - Modifica prenotazione
  // =====================================================
  router.put(
    '/:id',
    authenticate,
    requireApproved,
    requireCompleteProfile,
    async (req, res, next) => {
      try {
        const updated = await withSerializableRetry(
          sequelize,
          { isolationLevel: WRITE_ISOLATION },
          async (t) => {
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

            const destination = await Room.findByPk(newRoomId, { transaction: t });
            const status = bookingStatus(destination, req.user);
            await booking.update(
              {
                status,
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
          },
        );

        if (updated.status === 'pending_approval') {
          const full = await Booking.findByPk(updated.id, {
            include: [
              { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'email'] },
              { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
            ],
          });
          notifyAdminsOfPendingBooking(full).catch(() => {});
        }
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
    },
  );

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
};
