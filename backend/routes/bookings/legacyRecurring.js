'use strict';

const { body, validationResult } = require('express-validator');
const { recurringBookingLimiter } = require('../../middleware/rateLimit');
const { sequelize, Booking, Room, User, Building } = require('../../models');
const { authenticate, requireCompleteProfile, requireApproved } = require('../../middleware/auth');
const { validateBooking, createValidationCache } = require('../../services/bookingValidator');
const { sendBookingEmail } = require('../../services/emailService');

const { BookingRule } = require('../../models');

// Endpoint storico mantenuto per compatibilità. Il percorso /recurring
// e la normalizzazione dei due formati sono gestiti in recurring.js.
module.exports = function registerLegacyRecurring(router) {
  router.post(
    '/recurring_LEGACY_DELETED',
    authenticate,
    requireApproved,
    requireCompleteProfile,
    recurringBookingLimiter,
    // Validazione schema input via express-validator (uniforme col resto del file).
    [
      body('roomId').isInt({ min: 1 }).withMessage('roomId deve essere un intero positivo'),
      body('startTime').isISO8601().withMessage('startTime deve essere ISO 8601'),
      body('endTime').isISO8601().withMessage('endTime deve essere ISO 8601'),
      body('type').optional().isString().isLength({ max: 40 }),
      body('purpose').optional({ nullable: true }).isString().isLength({ max: 255 }),
      body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
      body('recurrence.weeks')
        .isInt({ min: 2, max: 52 })
        .withMessage('recurrence.weeks deve essere un intero tra 2 e 52'),
    ],
    async (req, res, next) => {
      try {
        const errs = validationResult(req);
        if (!errs.isEmpty()) {
          return res.status(400).json({
            error: 'Validazione fallita',
            code: 'VALIDATION_FAILED',
            details: errs.array(),
          });
        }
        const { roomId, startTime, endTime, type, purpose, notes, recurrence } = req.body;
        const weeks = Number(recurrence.weeks);
        const baseStart = new Date(startTime);
        const baseEnd = new Date(endTime);
        if (baseStart >= baseEnd) {
          return res.status(400).json({
            error: 'startTime deve essere prima di endTime',
            code: 'VALIDATION_FAILED',
          });
        }

        // Verifica policy ruolo: ricorrenze abilitate. Una sola query.
        const rule = await BookingRule.findOne({ where: { role: req.user.role } });
        if (rule && rule.allowRecurring === false) {
          return res.status(403).json({
            code: 'RECURRING_NOT_ALLOWED',
            error: 'Il tuo ruolo non può creare prenotazioni ricorrenti.',
          });
        }

        const bookingType = type || 'studio_individuale';

        // FASE 1 — Validazione: SENZA transazione, in parallelo (5 alla volta
        // per evitare di saturare il pool DB con 52 chiamate in flight).
        // validateBooking è read-only, quindi è safe parallelizzare. Le booking
        // generate dentro questo batch NON si vedranno tra loro al validator,
        // ma weekly+7gg garantisce che non possano sovrapporsi tra di loro.
        const occurrences = [];
        for (let i = 0; i < weeks; i++) {
          const offset = i * 7 * 24 * 60 * 60 * 1000;
          occurrences.push({
            index: i,
            start: new Date(baseStart.getTime() + offset),
            end: new Date(baseEnd.getTime() + offset),
          });
        }

        // Cache request-scoped condivisa tra tutte le validate del batch:
        // BookingRule, BookingQuota[], BookingRuleException[], Room (e
        // Equipment per scopeKind=equipmentType) sono invarianti per la
        // singola request → recuperate UNA volta sola dopo la prima validate.
        // Senza cache: ~10 query × 52 = 520 query. Con cache: ~10 + 52 × 4 ≈ 220.
        const cache = createValidationCache();

        const CONCURRENCY = 5;
        const validationResults = new Array(occurrences.length);
        for (let i = 0; i < occurrences.length; i += CONCURRENCY) {
          const batch = occurrences.slice(i, i + CONCURRENCY);
          await Promise.all(
            batch.map(async (occ) => {
              try {
                const v = await validateBooking({
                  user: req.user,
                  roomId,
                  startTime: occ.start,
                  endTime: occ.end,
                  type: bookingType,
                  cache,
                });
                validationResults[occ.index] = { occ, validation: v };
              } catch (err) {
                validationResults[occ.index] = {
                  occ,
                  validation: {
                    valid: false,
                    errors: [err.message || 'Errore di validazione'],
                    codes: ['VALIDATION_ERROR'],
                  },
                };
              }
            }),
          );
        }

        const validPayloads = [];
        const skipped = [];
        for (const r of validationResults) {
          if (!r) continue; // safety
          if (r.validation.valid) {
            validPayloads.push({
              userId: req.user.id,
              roomId,
              startTime: r.occ.start,
              endTime: r.occ.end,
              purpose: purpose || null,
              type: bookingType,
              notes: notes || null,
              status: 'confirmed',
            });
          } else {
            skipped.push({
              date: r.occ.start.toISOString().slice(0, 10),
              reason: (r.validation.errors || []).join('; ') || 'Validazione fallita',
              code: r.validation.codes?.find((c) => !!c) || 'BOOKING_INVALID',
            });
          }
        }

        // FASE 2 — UNA SOLA transazione READ COMMITTED per tutti gli INSERT.
        // L'EXCLUDE constraint Postgres `bookings_no_overlap` (vedi
        // lib/preSyncMigrations.js) garantisce no-overlap a livello DB anche
        // sotto race condition. Su SQLite/MySQL test, il validator + check
        // applicativo sono sufficienti.
        // Inseriamo singolarmente per poter gestire fallimenti per-occorrenza
        // (race con altri utenti su EXCLUDE constraint) senza rollbackare tutto.
        const created = [];
        if (validPayloads.length > 0) {
          await sequelize.transaction(async (t) => {
            for (const payload of validPayloads) {
              try {
                const b = await Booking.create(payload, { transaction: t });
                created.push(b.id);
              } catch (err) {
                // Race con altro utente: EXCLUDE constraint o unique violato.
                // Sequelize wrapper sequelize.UniqueConstraintError o
                // SequelizeDatabaseError (Postgres EXCLUDE → 23P01).
                const isOverlapErr =
                  err?.name === 'SequelizeUniqueConstraintError' ||
                  err?.original?.code === '23P01' ||
                  /overlap|exclud/i.test(err?.message || '');
                if (isOverlapErr) {
                  skipped.push({
                    date: payload.startTime.toISOString().slice(0, 10),
                    reason: 'Conflitto rilevato a livello DB',
                    code: 'BOOKING_OVERLAP',
                  });
                } else {
                  throw err; // errore non recuperabile → rollback intera tx
                }
              }
            }
          });
        }

        // FASE 3 — Email post-commit (fire-and-forget, fuori transazione)
        if (created.length > 0) {
          Booking.findAll({
            where: { id: created },
            include: [
              {
                model: User,
                as: 'user',
                attributes: ['id', 'firstName', 'lastName', 'email', 'emailNotifications'],
              },
              { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
            ],
          })
            .then((list) => {
              for (const b of list) {
                sendBookingEmail({ user: b.user, booking: b, kind: 'confirmation' }).catch((e) => {
                  if (e) {
                    /* swallow: la booking è stata creata, l'email è best-effort */
                  }
                });
              }
            })
            .catch(() => {
              /* swallow: notifica via email è fire-and-forget */
            });
        }

        // Ordina skipped per data (può capitare out-of-order dai batch paralleli)
        skipped.sort((a, b) => a.date.localeCompare(b.date));

        res.json({
          created: created.length,
          skipped,
          bookingIds: created,
        });
      } catch (err) {
        next(err);
      }
    },
  );
};
