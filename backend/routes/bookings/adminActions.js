'use strict';

const { Op } = require('sequelize');
const { sequelize, Booking, Room, User, Building } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const { sendBookingEmail } = require('../../services/emailService');
const { fetchBookingFull } = require('./shared');

module.exports = function registerAdminActions(router) {
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
        { where: { id: { [Op.in]: targetIds }, status: 'confirmed' }, individualHooks: true },
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
  // POST /api/bookings/swap (admin)
  // Scambia atomicamente roomId/startTime/endTime tra due prenotazioni
  // confermate, future, non checked-in. Copre i 3 casi EasyRoom:
  //   - solo aule (stesso giorno+orario, aule diverse)
  //   - aula+orario (stessa giornata, durate uguali, orari diversi)
  //   - aula+giorno+orario (giorni diversi)
  // Body: { aId: number, bId: number }.
  // La constraint EXCLUDE su `bookings_no_overlap` garantisce che lo swap
  // non crei conflitti reali (rollback automatico). Per by-passare il
  // vincolo durante la fase intermedia (entrambe le prenotazioni con i
  // dati nuovi prima del commit) flippiamo temporaneamente status='cancelled'
  // sulla prima — la constraint è WHERE status='confirmed' AND deletedAt IS NULL
  // quindi cancelled non è considerata.
  // =====================================================
  router.post('/swap', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const aId = Number(req.body?.aId);
      const bId = Number(req.body?.bId);
      if (!aId || !bId || aId === bId) {
        return res.status(400).json({
          error: 'Servono due id distinti (aId e bId)',
          code: 'VALIDATION_FAILED',
        });
      }

      const result = await sequelize.transaction(async (t) => {
        const [a, b] = await Promise.all([
          Booking.findByPk(aId, { transaction: t, lock: t.LOCK.UPDATE }),
          Booking.findByPk(bId, { transaction: t, lock: t.LOCK.UPDATE }),
        ]);
        if (!a || !b) {
          const e = new Error('Prenotazione/i non trovate');
          e.status = 404;
          e.code = 'NOT_FOUND';
          throw e;
        }
        if (a.status !== 'confirmed' || b.status !== 'confirmed') {
          const e = new Error('Entrambe le prenotazioni devono essere confermate');
          e.status = 400;
          e.code = 'INVALID_STATE';
          throw e;
        }
        const now = new Date();
        if (new Date(a.startTime) <= now || new Date(b.startTime) <= now) {
          const e = new Error('Non puoi scambiare prenotazioni iniziate o passate');
          e.status = 400;
          e.code = 'PAST_BOOKING';
          throw e;
        }
        if (a.checkedInAt || b.checkedInAt) {
          const e = new Error('Non puoi scambiare prenotazioni con check-in');
          e.status = 400;
          e.code = 'CHECKED_IN';
          throw e;
        }

        const aOrig = { roomId: a.roomId, startTime: a.startTime, endTime: a.endTime };
        const bOrig = { roomId: b.roomId, startTime: b.startTime, endTime: b.endTime };

        // Step 1: parcheggia A in 'cancelled' temporaneamente (uscendo dalla
        // EXCLUDE constraint che filtra su status='confirmed').
        // Step 2: porta B sui dati di A (slot ora libero).
        // Step 3: riporta A su confirmed con i dati di B.
        // Se uno qualsiasi dei tre step viola constraint o validatori, la
        // tx fa rollback e nessuna delle due viene modificata.
        await a.update({ status: 'cancelled' }, { transaction: t });
        await b.update(aOrig, { transaction: t });
        await a.update({ ...bOrig, status: 'confirmed' }, { transaction: t });
        return { a, b };
      });

      // Reload con join per la response (utile lato UI)
      const [aFull, bFull] = await Promise.all([
        fetchBookingFull(result.a.id),
        fetchBookingFull(result.b.id),
      ]);
      res.json({ a: aFull, b: bFull });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      if (err.name === 'SequelizeExclusionConstraintError') {
        return res.status(409).json({
          error: "Lo scambio creerebbe un conflitto con un'altra prenotazione",
          code: 'BOOKING_CONFLICT',
        });
      }
      next(err);
    }
  });
};
