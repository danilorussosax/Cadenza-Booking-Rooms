'use strict';

const { Op } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { Booking, User } = require('../../models');
const { authenticate, requireCompleteProfile, requireApproved } = require('../../middleware/auth');
const { findAlternativesWithTimeout } = require('../../services/bookingSuggestions');
const { book, BookingError } = require('../../services/bookingLifecycle');

// =====================================================
// Helper: arricchisce la response di conflitto con `suggestions` e
// `conflictsWith`. Read-only, hard timeout (vedi findAlternativesWithTimeout),
// fail-soft: in caso di errore restituisce `{ suggestions: [] }`.
//
// Privacy:
//   - studente NON vede mai il nome del proprietario (`ownerLabel: null`)
//   - docente/admin vedono `ownerLabel` per coordinarsi
// =====================================================
async function buildConflictExtras({ req, owner, roomId, startTime, endTime, type }) {
  try {
    const candidateUser = owner || req.user;
    const suggestions = await findAlternativesWithTimeout({
      roomId: Number(roomId),
      startTime,
      endTime,
      type: type || null,
      user: candidateUser,
    });

    let conflictsWith = null;
    try {
      const existing = await Booking.findOne({
        where: {
          roomId: Number(roomId),
          status: 'confirmed',
          [Op.and]: [
            { startTime: { [Op.lt]: new Date(endTime) } },
            { endTime: { [Op.gt]: new Date(startTime) } },
          ],
        },
        attributes: ['id', 'userId'],
      });
      if (existing) {
        const callerRole = req.user?.role;
        const showOwner = callerRole === 'admin' || callerRole === 'docente';
        let ownerLabel = null;
        if (showOwner && existing.userId) {
          const ownerUser = await User.findByPk(existing.userId, {
            attributes: ['firstName', 'lastName'],
          });
          if (ownerUser) {
            ownerLabel = `${ownerUser.firstName ?? ''} ${ownerUser.lastName ?? ''}`.trim() || null;
          }
        }
        conflictsWith = { bookingId: existing.id, ownerLabel };
      }
    } catch {
      conflictsWith = null;
    }

    return { suggestions, conflictsWith };
  } catch {
    return { suggestions: [] };
  }
}

module.exports = function registerCreate(router) {
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
      // `owner` dichiarato fuori dal try così resta disponibile nel catch
      // (serve a buildConflictExtras per valutare le suggestion contro il
      // ruolo/permessi dell'utente target nelle prenotazioni on-behalf-of).
      let owner = req.user;

      try {
        // Risolve il proprietario della prenotazione: se admin specifica
        // `onBehalfOfUserId` differente dal proprio id, prenota PER quell'utente.
        // Per gli utenti non-admin il campo viene ignorato silenziosamente.
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

        // Il ciclo di vita decide stato iniziale (aula high-impact: pending per i
        // non-admin, anche quando l'admin prenota per conto di altri), validazione
        // contro l'owner (quote bypassate se on-behalf), retry serializzabile ed
        // effetti post-commit (mail conferma all'utente / notifica admin).
        const { full } = await book({
          actor: req.user,
          owner,
          roomId,
          startTime,
          endTime,
          purpose,
          type,
          notes,
          bypass: { quotas: isOnBehalf },
        });
        res.status(201).json({ booking: full });
      } catch (err) {
        if (err instanceof BookingError) {
          // Conflitto (validatore o vincolo DB): arricchisce con alternative.
          const extras =
            err.code === 'BOOKING_CONFLICT'
              ? await buildConflictExtras({ req, owner, roomId, startTime, endTime, type })
              : {};
          return res.status(err.status).json({
            error: err.message,
            ...(err.issues && { issues: err.issues }),
            code: err.code || 'BOOKING_INVALID',
            ...extras,
          });
        }
        next(err);
      }
    },
  );
};
