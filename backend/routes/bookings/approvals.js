'use strict';

const { Op } = require('sequelize');
const { sequelize, Booking, Room, Building } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const { sendBookingEmail } = require('../../services/emailService');
const { withSerializableRetry } = require('../../lib/serializableTx');
const { WRITE_ISOLATION, fetchBookingFull } = require('./shared');

module.exports = function registerApprovals(router) {
  // =====================================================
  // Workflow approvazione prenotazioni high-impact (sale concerti, ecc).
  // Solo admin. Le pending_approval non bloccano altri slot finché restano in
  // attesa (vedi services/bookingValidator.js): l'admin sceglie quale richiesta
  // confermare, ed eventuali concorrenti restano in attesa o vengono rifiutate.
  // GET /pending viene registrata in read.js prima di /:id.
  // =====================================================

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

  // POST /api/bookings/:id/approve — admin approva richiesta pending.
  // Verifica conflitti al momento dell'approvazione: se nel frattempo è nato
  // un confirmed sovrapposto, l'approvazione fallisce con 409.
  router.post('/:id/approve', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const result = await withSerializableRetry(
        sequelize,
        { isolationLevel: WRITE_ISOLATION },
        async (t) => {
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
        },
      );
      const full = await fetchBookingFull(result.id);
      sendBookingEmail({ user: full.user, booking: full, kind: 'booking_approved' }).catch(
        () => {},
      );
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
        req.body && typeof req.body.reason === 'string'
          ? req.body.reason.trim().slice(0, 255)
          : null;
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
      sendBookingEmail({ user: full.user, booking: full, kind: 'booking_rejected' }).catch(
        () => {},
      );
      res.json({ booking: full });
    } catch (err) {
      next(err);
    }
  });
};
