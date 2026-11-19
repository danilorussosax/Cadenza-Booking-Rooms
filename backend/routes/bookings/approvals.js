'use strict';

const { Booking, Room, Building } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const { approve, cancel } = require('../../services/bookingLifecycle');
const { fetchBookingFull } = require('./shared');

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
      // Verifica stato + conflitti, conferma e mail 'booking_approved'.
      const { booking } = await approve({ bookingId: req.params.id });
      res.json({ booking });
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
      // Rifiuto = annullo con mail 'booking_rejected'. Update condizionale: se
      // nel frattempo lo stato e' cambiato (race) non annulla due volte.
      const { cancelled } = await cancel({
        booking,
        reason: reason || 'Richiesta non approvata',
        expectStatuses: ['pending_approval'],
        mail: 'booking_rejected',
      });
      if (!cancelled) {
        return res.status(400).json({
          error: 'La prenotazione non è in attesa di approvazione',
          code: 'BOOKING_INVALID_STATE',
        });
      }
      const full = await fetchBookingFull(booking.id);
      res.json({ booking: full });
    } catch (err) {
      next(err);
    }
  });
};
