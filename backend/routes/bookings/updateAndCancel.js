'use strict';

const { authenticate, requireCompleteProfile, requireApproved } = require('../../middleware/auth');
const { move, cancel, BookingError } = require('../../services/bookingLifecycle');

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
        // Permessi, riassegnazione owner, validazione, stato (pending se aula
        // high-impact) e notifica admin sono nel ciclo di vita.
        const { booking } = await move({
          bookingId: req.params.id,
          actor: req.user,
          changes: req.body,
        });
        res.json({ booking });
      } catch (err) {
        if (err.status) {
          return res.status(err.status).json({
            error: err.message,
            ...(err.code && { code: err.code }),
            ...(err.issues && { issues: err.issues }),
          });
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
      // Permesso (canCancel), update, mail di annullo e promozione della lista
      // d'attesa (dopo il commit) sono nel ciclo di vita.
      const { booking } = await cancel({
        id: req.params.id,
        actor: req.user,
        checkPermission: true,
        reason: req.body.reason || null,
        mail: 'cancellation',
      });
      res.json({ message: 'Prenotazione cancellata', booking });
    } catch (err) {
      if (err instanceof BookingError) return res.status(err.status).json({ error: err.message });
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  });
};
