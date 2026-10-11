'use strict';

const { Op } = require('sequelize');
const { body, validationResult } = require('express-validator');
const { recurringBookingLimiter } = require('../../middleware/rateLimit');
const { sequelize, Booking, Room, User, Building, BookingRecurrence } = require('../../models');
const recurrenceExpander = require('../../services/recurrenceExpander');
const { authenticate, requireCompleteProfile, requireApproved } = require('../../middleware/auth');
const { validateBooking, createValidationCache } = require('../../services/bookingValidator');

/**
 * Notifica gli admin attivi di una richiesta in attesa di approvazione.
 * Fire-and-forget: errori SMTP non bloccano la creazione della booking.
 */
const { bookingStatus, notifyAdminsOfPendingBooking } = require('../../services/bookingPolicy');
const { withSerializableRetry } = require('../../lib/serializableTx');

const { BookingRule } = require('../../models');

// =====================================================
// Prenotazioni ricorrenti — POST /bookings/recurring + DELETE serie
// MRBS-style: pattern "eager + group". La richiesta espande la regola in N
// booking individuali, ognuno validato per conflitti, tutti legati alla
// stessa BookingRecurrence row. Cancellazione singola via DELETE /:id come
// per le booking normali; cancellazione di tutta la serie via DELETE su
// /recurrences/:id (cascade).
// =====================================================

/**
 * Helper: notifica admin di creazione serie ricorrente in pending_approval
 * — fire-and-forget come le booking singole. Una sola email per serie.
 */
function notifyAdminsRecurringPending(recurrence, sampleBookingFull) {
  notifyAdminsOfPendingBooking(sampleBookingFull).catch((err) => {
    console.warn('[recurring] notify admins failed:', err.message);
  });
}

/**
 * Shim retro-compat per il formato legacy `recurrence: { weeks: N }`
 * (UI esistente: BookingFormDialog). Lo traduciamo nel formato nuovo
 * MRBS-style PRIMA della validazione, così il resto del handler usa
 * un solo path.
 */
function normalizeRecurrenceInput(recurrence, startTime) {
  if (!recurrence) return null;
  // Formato nuovo: già pronto
  if (recurrence.frequency) return recurrence;
  // Formato legacy weeks=N → weekly per N settimane partendo da startTime
  if (recurrence.weeks) {
    const n = Number(recurrence.weeks);
    // Convenzione legacy: "ripetizione" implica almeno 2 occorrenze
    if (!Number.isInteger(n) || n < 2 || n > 52) return null;
    const start = dayjs(startTime);
    if (!start.isValid()) return null;
    return {
      frequency: 'weekly',
      interval: 1,
      // byWeekday null → recurrenceExpander dedurrà da startDate
      byWeekday: null,
      startDate: start.format('YYYY-MM-DD'),
      endDate: start.add((n - 1) * 7, 'day').format('YYYY-MM-DD'),
    };
  }
  return null;
}

const { dayjs, WRITE_ISOLATION } = require('./shared');

module.exports = function registerRecurring(router) {
  router.post(
    '/recurring',
    authenticate,
    requireApproved,
    requireCompleteProfile,
    recurringBookingLimiter,
    // Normalizza il payload PRIMA della validazione schema: copre sia il
    // formato legacy (recurrence.weeks) sia il nuovo (recurrence.frequency).
    (req, _res, next) => {
      const normalized = normalizeRecurrenceInput(req.body.recurrence, req.body.startTime);
      if (normalized) req.body.recurrence = normalized;
      next();
    },
    [
      body('roomId').isInt(),
      body('startTime').isISO8601(),
      body('endTime').isISO8601(),
      body('type').optional().isIn(['studio_individuale', 'lezione', 'prova', 'concerto', 'altro']),
      body('purpose').optional().trim(),
      body('recurrence.frequency').isIn(['daily', 'weekly']),
      body('recurrence.interval').optional().isInt({ min: 1, max: 12 }),
      body('recurrence.byWeekday').optional({ nullable: true }).isArray(),
      body('recurrence.startDate').isISO8601(),
      body('recurrence.endDate').isISO8601(),
      body('recurrence.excludeDates').optional().isArray(),
      body('skipConflicts').optional().isBoolean(),
    ],
    async (req, res, next) => {
      const errs = validationResult(req);
      if (!errs.isEmpty()) {
        return res.status(400).json({
          error: 'Validazione fallita',
          code: 'VALIDATION_FAILED',
          details: errs.array(),
        });
      }
      const {
        roomId,
        startTime,
        endTime,
        type,
        purpose,
        notes,
        recurrence,
        skipConflicts = false,
      } = req.body;

      try {
        // Validazione regola + espansione occorrenze. RecurrenceError viene
        // catturato qui sotto e trasformato in 400 con `code` strutturato.
        const rule = recurrenceExpander.validateRule(recurrence);

        // Gate per ruolo: BookingRule.allowRecurring=false → 403
        const userRule = await BookingRule.findOne({ where: { role: req.user.role } });
        if (userRule && userRule.allowRecurring === false) {
          return res.status(403).json({
            error: 'Il tuo ruolo non può creare prenotazioni ricorrenti.',
            code: 'RECURRING_NOT_ALLOWED',
          });
        }

        const occurrences = recurrenceExpander.expandOccurrences(rule, startTime, endTime);
        if (occurrences.length === 0) {
          return res.status(400).json({
            error: 'La regola di ricorrenza non produce alcuna occorrenza',
            code: 'RECURRENCE_EMPTY',
          });
        }

        const room = await Room.findByPk(roomId);
        if (!room)
          return res.status(400).json({ error: 'Aula non trovata', code: 'ROOM_NOT_FOUND' });
        const initialStatus = bookingStatus(room, req.user);

        // Pre-validazione: lanciamo validateBooking per OGNI occorrenza FUORI
        // dalla transazione (read-only check). Se troviamo conflitti e
        // skipConflicts=false, ritorniamo 409 con lista per UX. Se
        // skipConflicts=true, droppiamo le occorrenze in conflitto e
        // procediamo con le altre.
        const validations = [];
        const cache = createValidationCache();
        for (const occ of occurrences) {
          const v = await validateBooking({
            user: req.user,
            roomId,
            startTime: occ.startTime,
            endTime: occ.endTime,
            type,
            cache,
          });
          validations.push({ occ, valid: v.valid, errors: v.errors, codes: v.codes });
        }

        const conflicts = validations
          .filter((v) => !v.valid)
          .map((v) => ({
            startTime: v.occ.startTime,
            endTime: v.occ.endTime,
            error: v.errors?.[0] || 'Conflitto',
            code: v.codes?.find((c) => !!c) || 'BOOKING_INVALID',
          }));
        const validOccurrences = validations.filter((v) => v.valid).map((v) => v.occ);

        if (conflicts.length > 0 && !skipConflicts) {
          return res.status(409).json({
            error: `${conflicts.length} occorrenze in conflitto`,
            code: 'RECURRENCE_CONFLICTS',
            conflicts,
            validCount: validOccurrences.length,
          });
        }

        if (validOccurrences.length === 0) {
          return res.status(409).json({
            error: 'Tutte le occorrenze sono in conflitto, nessuna creata',
            code: 'RECURRENCE_ALL_CONFLICT',
            conflicts,
          });
        }

        // Crea la serie + tutti i booking in una transazione SERIALIZABLE.
        // Re-validiamo dentro la transazione per chiudere la race window tra
        // la pre-validazione e la insert (qualcuno potrebbe aver prenotato
        // nel frattempo). Se trovo conflitti qui, abort.
        const result = await withSerializableRetry(
          sequelize,
          { isolationLevel: WRITE_ISOLATION },
          async (t) => {
            const series = await BookingRecurrence.create(
              {
                userId: req.user.id,
                roomId,
                frequency: rule.frequency,
                interval: rule.interval,
                byWeekday: rule.byWeekday,
                startDate: rule.startDate,
                endDate: rule.endDate,
                excludeDates: rule.excludeDates,
              },
              { transaction: t },
            );

            const created = [];
            const tCache = createValidationCache();
            for (const occ of validOccurrences) {
              const v = await validateBooking({
                user: req.user,
                roomId,
                startTime: occ.startTime,
                endTime: occ.endTime,
                type,
                cache: tCache,
                transaction: t,
              });
              if (!v.valid) {
                // Race window: skip questa occorrenza, NON falliamo l'intera
                // serie. Logghiamo per visibilità.
                console.warn(
                  `[recurring] race conflict skipped: ${occ.startTime.toISOString()} — ${v.errors?.[0]}`,
                );
                continue;
              }
              const b = await Booking.create(
                {
                  userId: req.user.id,
                  roomId,
                  startTime: occ.startTime,
                  endTime: occ.endTime,
                  purpose: purpose || null,
                  type: type || 'studio_individuale',
                  notes: notes || null,
                  status: initialStatus,
                  recurrenceId: series.id,
                },
                { transaction: t },
              );
              created.push(b);
            }

            return { series, created };
          },
        );

        // Email: una conferma per il proprietario riferita alla PRIMA occorrenza
        // (no spam di N email). L'admin riceve UNA notifica di pending se applicabile.
        if (result.created.length > 0) {
          const sample = await Booking.findByPk(result.created[0].id, {
            include: [
              { model: User, as: 'user' },
              { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
            ],
          });
          if (initialStatus === 'pending_approval') {
            notifyAdminsRecurringPending(result.series, sample);
          }
        }

        return res.status(201).json({
          recurrenceId: result.series.id,
          createdCount: result.created.length,
          requestedCount: occurrences.length,
          skipped: conflicts.length,
          conflicts: skipConflicts ? conflicts : [],
          bookingIds: result.created.map((b) => b.id),
          status: initialStatus,
        });
      } catch (err) {
        // RecurrenceError → 400 strutturato (no 500)
        if (err && err.code && /^RECURRENCE_/.test(err.code)) {
          return res.status(400).json({ error: err.message, code: err.code });
        }
        next(err);
      }
    },
  );

  /**
   * DELETE /bookings/recurrences/:id
   *
   * Cancella la serie e tutte le occorrenze FUTURE (>= now). Le occorrenze
   * passate restano in DB con `recurrenceId` valorizzato per storia/audit
   * (la serie viene comunque eliminata: il valore `recurrenceId` punterà
   * a una riga inesistente — accettabile, è solo storia).
   *
   * Solo il proprietario o un admin possono cancellare.
   */
  router.delete('/recurrences/:id', authenticate, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });

      const series = await BookingRecurrence.findByPk(id);
      if (!series) return res.status(404).json({ error: 'Serie non trovata' });

      if (series.userId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Non autorizzato' });
      }

      const now = new Date();
      const futureBookings = await Booking.findAll({
        where: { recurrenceId: id, startTime: { [Op.gte]: now } },
      });
      const cancelledCount = futureBookings.length;

      await sequelize.transaction(async (t) => {
        // Soft-cancel le future occorrenze (status='cancelled') invece di
        // hard-destroy: l'audit/iCal/reminders esistenti devono poterle
        // ancora referenziare per coerenza con il flusso DELETE /:id singolo.
        for (const b of futureBookings) {
          await b.update(
            {
              status: 'cancelled',
              cancelledAt: now,
              cancelReason: 'Cancellazione serie ricorrente',
            },
            { transaction: t },
          );
        }
        // Hard-destroy della serie: non serve più (occorrenze già marcate)
        await series.destroy({ transaction: t });
      });

      return res.json({ ok: true, cancelledCount });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /bookings/recurrences/:id
   *
   * Dettaglio della serie + lista delle occorrenze (per la pagina dettaglio
   * "La mia serie ricorrente"). Solo proprietario o admin.
   */
  router.get('/recurrences/:id', authenticate, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });

      const series = await BookingRecurrence.findByPk(id, {
        include: [
          { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
          {
            model: Booking,
            as: 'occurrences',
            order: [['startTime', 'ASC']],
            attributes: ['id', 'startTime', 'endTime', 'status', 'cancelledAt'],
          },
        ],
      });
      if (!series) return res.status(404).json({ error: 'Serie non trovata' });
      if (series.userId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Non autorizzato' });
      }

      return res.json(series);
    } catch (err) {
      next(err);
    }
  });
};
