'use strict';

const { Op } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { sequelize, Booking, Room, User, Building } = require('../../models');
const { authenticate, requireCompleteProfile, requireApproved } = require('../../middleware/auth');
const { validateBooking } = require('../../services/bookingValidator');
const { findAlternativesWithTimeout } = require('../../services/bookingSuggestions');
const { sendBookingEmail } = require('../../services/emailService');

/**
 * Notifica gli admin attivi di una richiesta in attesa di approvazione.
 * Fire-and-forget: errori SMTP non bloccano la creazione della booking.
 */
const { bookingStatus, notifyAdminsOfPendingBooking } = require('../../services/bookingPolicy');
const { withSerializableRetry } = require('../../lib/serializableTx');

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

const { WRITE_ISOLATION } = require('./shared');

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

        // Aula "high-impact" (sala concerti, auditorium): per i non-admin la
        // prenotazione nasce in 'pending_approval' e richiede l'ok di un admin.
        // Gli admin bypassano (creano direttamente 'confirmed') anche quando
        // prenotano per conto di un altro utente.
        const room = await Room.findByPk(roomId);
        const needsApproval = room && room.requiresApproval === true && req.user.role !== 'admin';
        const initialStatus = bookingStatus(room, req.user);

        const booking = await withSerializableRetry(
          sequelize,
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
          sendBookingEmail({ user: full.user, booking: full, kind: 'confirmation' }).catch(
            () => {},
          );
        }
        res.status(201).json({ booking: full });
      } catch (err) {
        if (err.status === 400) {
          const isConflict = err.code === 'BOOKING_CONFLICT';
          const extras = isConflict
            ? await buildConflictExtras({ req, owner, roomId, startTime, endTime, type })
            : {};
          return res.status(400).json({
            error: err.message,
            issues: err.issues,
            code: err.code || 'BOOKING_INVALID',
            ...extras,
          });
        }
        if (err.name === 'SequelizeUniqueConstraintError') {
          const extras = await buildConflictExtras({
            req,
            owner,
            roomId,
            startTime,
            endTime,
            type,
          });
          return res.status(409).json({
            error: 'Conflitto: prenotazione già esistente',
            code: 'BOOKING_CONFLICT',
            ...extras,
          });
        }
        if (err.name === 'SequelizeExclusionConstraintError') {
          const extras = await buildConflictExtras({
            req,
            owner,
            roomId,
            startTime,
            endTime,
            type,
          });
          return res.status(409).json({
            error: 'Aula già occupata in questa fascia oraria',
            code: 'BOOKING_CONFLICT',
            ...extras,
          });
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
};
