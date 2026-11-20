'use strict';

/**
 * Ciclo di vita della prenotazione: `book`, `bookSeries`, `move`, `approve`,
 * `cancel`, `cancelMany`.
 *
 * Possiede, in un unico punto:
 *   - transazione SERIALIZABLE + retry (lib/serializableTx);
 *   - validazione (validateBooking) con adattatore errors[]/codes[] -> issues;
 *   - stato iniziale (bookingStatus) e origine ('manual' di default, 'monte_ore'
 *     ammesso come parametro);
 *   - mappatura degli errori di vincolo DB -> BookingError con codici stabili;
 *   - effetti DOPO il commit: mail di conferma / notifica admin / mail di
 *     annullo / promozione della lista d'attesa. Gli effetti sono best-effort:
 *     un errore SMTP o waitlist non fallisce mai l'operazione.
 *
 * Promozione lista d'attesa: l'hook `Booking.afterUpdate` in models/index.js
 * resta come rete di sicurezza per i chiamanti non migrati (monte ore, swap),
 * ma questo modulo aggiorna le righe con `hooks: false` e promuove ESPLICITAMENTE
 * (dopo il commit), cosi' non c'e' doppio dispatch.
 *
 * Interfaccia pensata per i servizi monte ore: `origin`, `bypass`, `transaction`
 * (tx esterna: niente retry, effetti su afterCommit), `before`/`within` come
 * punti di collegamento (es. `within: (t, b) => slot.update({ bookingId: b.id })`).
 */

const { Op, Transaction } = require('sequelize');
const { sequelize, Booking, Room, User, Building } = require('../models');
const { validateBooking, createValidationCache, canCancel } = require('./bookingValidator');
const bookingPolicy = require('./bookingPolicy');
// Riferimento via oggetto-modulo (non destrutturato): i test possono spiare i metodi.
const emailService = require('./emailService');
const { withSerializableRetry } = require('../lib/serializableTx');
const logger = require('../lib/logger');
const { isAdmin, can } = require('../lib/access');

// SERIALIZABLE: valutazione conflitti + insert come una sola unita' logica.
// (Duplicato di routes/bookings/shared.js#WRITE_ISOLATION: un servizio non
// deve dipendere dalle route.)
const WRITE_ISOLATION = Transaction.ISOLATION_LEVELS.SERIALIZABLE;

const ORIGINS = Object.freeze(['manual', 'monte_ore']);

// =====================================================
// Errori
// =====================================================

class BookingError extends Error {
  constructor(message, { status = 400, code = 'BOOKING_INVALID', issues } = {}) {
    super(message);
    this.name = 'BookingError';
    this.status = status;
    this.code = code;
    if (issues) this.issues = issues;
  }
}

/**
 * Converte gli errori di vincolo Sequelize in BookingError con codice stabile.
 * Gli altri errori (inclusi TOO_MUCH_CONTENTION) tornano invariati.
 */
function toBookingError(err) {
  if (err instanceof BookingError) return err;
  switch (err?.name) {
    case 'SequelizeUniqueConstraintError':
      return new BookingError('Conflitto: prenotazione già esistente', {
        status: 409,
        code: 'BOOKING_CONFLICT',
      });
    case 'SequelizeExclusionConstraintError':
      return new BookingError('Aula già occupata in questa fascia oraria', {
        status: 409,
        code: 'BOOKING_CONFLICT',
      });
    case 'SequelizeForeignKeyConstraintError':
      return new BookingError('Riferimento non valido (aula o utente inesistenti)', {
        status: 400,
        code: 'FK_CONSTRAINT',
      });
    default:
      return err;
  }
}

// =====================================================
// Validazione: adattatore del risultato di validateBooking
// =====================================================

/**
 * `validateBooking` restituisce già `issues: [{ message, code|null }]`. Per
 * input legacy (solo `errors[]`/`codes[]` paralleli, anche senza `codes`) li
 * allineiamo qui.
 */
function normalizeValidation(v) {
  const issues = (
    v?.issues || (v?.errors || []).map((message, i) => ({ message, code: v?.codes?.[i] }))
  ).map(({ message, code }) => ({ message, code: code || null }));
  const errors = issues.map((i) => i.message);
  const firstCode = issues.find((i) => i.code)?.code || null;
  return {
    valid: !!v?.valid,
    issues,
    messages: errors,
    // Stesso comportamento storico: primo codice strutturato presente.
    code: firstCode,
  };
}

function throwInvalid(
  norm,
  { status = 400, message = 'Prenotazione non valida', code = 'BOOKING_INVALID' } = {},
) {
  throw new BookingError(norm.messages[0] || message, {
    status,
    code: norm.code || code,
    issues: norm.messages,
  });
}

/**
 * Pre-validazione read-only di N occorrenze (fuori transazione), con cache.
 * Ritorna [{ occ, valid, message, code }].
 */
async function checkOccurrences({ user, roomId, type, occurrences }) {
  const cache = createValidationCache();
  const out = [];
  for (const occ of occurrences) {
    const v = normalizeValidation(
      await validateBooking({
        user,
        roomId,
        startTime: occ.startTime,
        endTime: occ.endTime,
        type,
        cache,
      }),
    );
    out.push({ occ, valid: v.valid, message: v.messages[0] || null, code: v.code });
  }
  return out;
}

// =====================================================
// Effetti post-commit
// =====================================================

function runAfterCommit(transaction, fn) {
  const safe = async () => {
    try {
      await fn();
    } catch (err) {
      logger.warn({ err: err.message, scope: 'bookingLifecycle' }, 'booking effect failed');
    }
  };
  if (transaction && typeof transaction.afterCommit === 'function') {
    // Fire-and-forget (come l'hook storico): attendere qui terrebbe occupata la
    // connessione del commit mentre gli effetti aprono nuove transazioni.
    transaction.afterCommit(() => {
      void safe();
    });
    return Promise.resolve();
  }
  return safe();
}

/** Booking con utente (incluse le preferenze di notifica) + aula/sede. */
function loadFull(id) {
  return Booking.findByPk(id, {
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
          'notifyOnConfirmation',
          'notifyOnCancellation',
        ],
      },
      { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
    ],
  });
}

/** Promuove il primo in lista d'attesa sullo slot liberato (best-effort). */
async function promoteWaitlist(booking) {
  const { notifyNextOnSlot } = require('./waitlistService');
  await notifyNextOnSlot({
    roomId: booking.roomId,
    startTime: booking.startTime,
    endTime: booking.endTime,
  });
}

/** Effetti di una nuova prenotazione: admin se pending, altrimenti mail all'utente. */
async function deliverCreationEffects(bookingId, { status, notifyOwner, notifyAdmins }) {
  const full = await loadFull(bookingId);
  if (!full) return null;
  if (status === 'pending_approval') {
    if (notifyAdmins) await bookingPolicy.notifyAdminsOfPendingBooking(full);
  } else if (notifyOwner) {
    await emailService.sendBookingEmail({ user: full.user, booking: full, kind: 'confirmation' });
  }
  return full;
}

// =====================================================
// book
// =====================================================

/**
 * Valida e crea una prenotazione dentro la transazione `t`. Primitiva usata
 * da `book` e `bookSeries`. Ritorna la Booking, oppure `null` se
 * `onInvalid: 'skip'` e la validazione fallisce.
 */
async function placeBooking(t, p) {
  const ctx = p.before ? (await p.before(t)) || {} : {};
  const owner = ctx.owner || p.owner || p.actor;
  const actor = ctx.actor || (ctx.owner ? ctx.owner : p.actor);
  const room =
    ctx.room !== undefined ? ctx.room : await Room.findByPk(p.roomId, { transaction: t });
  const type = p.type || 'studio_individuale';

  const validation = normalizeValidation(
    await validateBooking({
      user: owner,
      roomId: p.roomId,
      startTime: p.startTime,
      endTime: p.endTime,
      type: p.type,
      ignoreBookingId: p.ignoreBookingId,
      bypassQuotas: !!p.bypass?.quotas,
      bypassAdvance: !!p.bypass?.advance,
      bypassPastDates: !!p.bypass?.pastDates,
      bypassDuration: !!p.bypass?.duration,
      cache: p.cache || null,
      transaction: t,
    }),
  );
  if (!validation.valid) {
    if (p.onInvalid === 'skip') {
      logger.warn(
        { start: p.startTime, error: validation.messages[0], scope: 'bookingLifecycle' },
        'race conflict skipped',
      );
      return null;
    }
    throwInvalid(validation, {
      status: p.invalidStatus,
      message: p.invalidMessage,
      code: p.invalidCode,
    });
  }

  const origin = p.origin || 'manual';
  if (!ORIGINS.includes(origin)) {
    throw new BookingError(`Origine non valida: ${origin}`, { code: 'BOOKING_INVALID' });
  }
  const status = p.status || bookingPolicy.bookingStatus(room, actor);
  const booking = await Booking.create(
    {
      userId: owner.id,
      roomId: p.roomId,
      startTime: p.startTime,
      endTime: p.endTime,
      purpose: p.purpose || null,
      type,
      notes: p.notes || null,
      status,
      origin,
      ...(p.recurrenceId ? { recurrenceId: p.recurrenceId } : {}),
    },
    { transaction: t },
  );
  if (p.within) await p.within(t, booking);
  return booking;
}

/**
 * Prenota una singola occorrenza.
 *
 * @param {object} p
 * @param {object} p.actor        chi agisce (decide lo stato iniziale: gli admin bypassano l'approvazione)
 * @param {object} [p.owner]      proprietario della prenotazione (default: actor)
 * @param {number} p.roomId
 * @param {Date|string} p.startTime
 * @param {Date|string} p.endTime
 * @param {string} [p.type] [p.purpose] [p.notes]
 * @param {'manual'|'monte_ore'} [p.origin='manual']
 * @param {object} [p.bypass]     { quotas, advance, pastDates, duration }
 * @param {number} [p.invalidStatus=400] HTTP status della validazione fallita
 * @param {string} [p.invalidMessage] [p.invalidCode] fallback se il validatore non da' un codice (default BOOKING_INVALID)
 * @param {Function} [p.before]   async (t) => ({ owner?, actor?, room? }) primo passo dentro la tx
 * @param {Function} [p.within]   async (t, booking) dopo la insert, stessa tx (collegamenti: slot monte ore, coda...)
 * @param {object} [p.transaction] tx esterna: niente tx/retry propri, effetti su afterCommit
 * @param {number} [p.ignoreBookingId] prenotazione da ignorare nel controllo conflitti
 * @param {boolean} [p.notifyOwner=true] [p.notifyAdmins=true]
 *        Con `notifyOwner:false` non parte la mail di conferma; la notifica admin
 *        riguarda solo lo stato pending_approval. Per prenotazioni 'confirmed'
 *        generate in blocco (monte ore, bot) `notifyOwner:false` basta a
 *        silenziare TUTTO: gli effetti post-commit vengono saltati.
 *        `cancel`/`cancelMany` non inviano mail se `mail` non e' indicato.
 * @returns {Promise<{ booking, status, full }>}
 * @throws {BookingError} validazione / conflitto / FK
 */
async function book(p) {
  let booking;
  try {
    if (p.transaction) {
      booking = await placeBooking(p.transaction, p);
    } else {
      booking = await withSerializableRetry(sequelize, { isolationLevel: WRITE_ISOLATION }, (t) =>
        placeBooking(t, p),
      );
    }
  } catch (err) {
    throw toBookingError(err);
  }

  const effects = {
    status: booking.status,
    notifyOwner: p.notifyOwner !== false,
    notifyAdmins: p.notifyAdmins !== false,
  };
  let full = null;
  const hasEffects =
    effects.notifyOwner || (effects.status === 'pending_approval' && effects.notifyAdmins);
  if (hasEffects)
    await runAfterCommit(p.transaction, async () => {
      full = await deliverCreationEffects(booking.id, effects);
    });
  // Con tx esterna `full` non e' ancora disponibile (gli effetti partono dopo
  // il commit): il chiamante ricarica se serve.
  if (!p.transaction && !full) full = await loadFull(booking.id);
  return { booking, status: booking.status, full };
}

/**
 * Crea una serie ricorrente: `createSeries(t)` crea la riga serie, poi ogni
 * occorrenza viene ri-validata nella tx e inserita; le occorrenze che perdono
 * una race vengono saltate (non fanno fallire la serie).
 * Effetti: UNA sola notifica admin per l'intera serie se pending.
 *
 * @returns {Promise<{ series, created, status }>}
 */
async function bookSeries(p) {
  let result;
  try {
    result = await withSerializableRetry(
      sequelize,
      { isolationLevel: WRITE_ISOLATION },
      async (t) => {
        const series = await p.createSeries(t);
        const room = await Room.findByPk(p.roomId, { transaction: t });
        const cache = createValidationCache();
        const created = [];
        for (const occ of p.occurrences) {
          const b = await placeBooking(t, {
            ...p,
            startTime: occ.startTime,
            endTime: occ.endTime,
            recurrenceId: series.id,
            cache,
            onInvalid: 'skip',
          });
          if (b) created.push(b);
        }
        return { series, created, room };
      },
    );
  } catch (err) {
    throw toBookingError(err);
  }
  const status = bookingPolicy.bookingStatus(result.room, p.actor);
  if (result.created.length > 0 && status === 'pending_approval' && p.notifyAdmins !== false) {
    await runAfterCommit(null, async () => {
      const sample = await loadFull(result.created[0].id);
      await bookingPolicy.notifyAdminsOfPendingBooking(sample);
    });
  }
  return { series: result.series, created: result.created, status };
}

// =====================================================
// move
// =====================================================

/**
 * Modifica una prenotazione confermata (orari, aula, tipo, note; l'admin puo'
 * anche riassegnare il proprietario). Rivalida, ricalcola lo stato
 * (aula high-impact => torna pending_approval per i non-admin) e notifica gli
 * admin se serve.
 */
async function move({ bookingId, actor, changes = {} }) {
  let updated;
  try {
    updated = await withSerializableRetry(
      sequelize,
      { isolationLevel: WRITE_ISOLATION },
      async (t) => {
        const booking = await Booking.findByPk(bookingId, { transaction: t });
        if (!booking)
          throw new BookingError('Prenotazione non trovata', { status: 404, code: null });
        if (!can(actor, 'booking:modify', booking)) {
          throw new BookingError('Non autorizzato', { status: 403, code: null });
        }
        if (booking.status !== 'confirmed') {
          throw new BookingError('Prenotazione non modificabile (già cancellata o conclusa)', {
            status: 400,
            code: null,
          });
        }

        const newStart = changes.startTime || booking.startTime;
        const newEnd = changes.endTime || booking.endTime;
        const newRoomId = changes.roomId || booking.roomId;

        // Riassegnazione owner: solo admin. La validazione usa l'owner
        // risultante (permessi su aula: allowedRoles, allowedCourseIds).
        let newOwner = await User.findByPk(booking.userId, { transaction: t });
        const targetUserId = changes.userId !== undefined ? Number(changes.userId) : null;
        const isReassign =
          isAdmin(actor) && Number.isInteger(targetUserId) && targetUserId !== booking.userId;
        if (isReassign) {
          const candidate = await User.findByPk(targetUserId, { transaction: t });
          if (!candidate) {
            throw new BookingError('Utente target non trovato', {
              status: 400,
              code: 'USER_NOT_FOUND',
            });
          }
          if (candidate.status !== 'approved' || candidate.isActive === false) {
            throw new BookingError('Utente target non approvato o non attivo', {
              status: 400,
              code: 'USER_NOT_AVAILABLE',
            });
          }
          newOwner = candidate;
        }
        // Admin su prenotazione altrui: bypassa le quote del proprietario.
        const adminActingOnOther = isAdmin(actor) && newOwner.id !== actor.id;

        const validation = normalizeValidation(
          await validateBooking({
            user: newOwner,
            roomId: newRoomId,
            startTime: newStart,
            endTime: newEnd,
            type: changes.type ?? booking.type,
            ignoreBookingId: booking.id,
            bypassQuotas: adminActingOnOther,
            transaction: t,
          }),
        );
        if (!validation.valid) throwInvalid(validation, { message: 'Modifica non valida' });

        const destination = await Room.findByPk(newRoomId, { transaction: t });
        await booking.update(
          {
            status: bookingPolicy.bookingStatus(destination, actor),
            startTime: newStart,
            endTime: newEnd,
            roomId: newRoomId,
            userId: isReassign ? newOwner.id : booking.userId,
            purpose: changes.purpose ?? booking.purpose,
            type: changes.type ?? booking.type,
            notes: changes.notes ?? booking.notes,
          },
          { transaction: t },
        );
        return booking;
      },
    );
  } catch (err) {
    throw toBookingError(err);
  }

  if (updated.status === 'pending_approval') {
    await runAfterCommit(null, async () => {
      await bookingPolicy.notifyAdminsOfPendingBooking(await loadFull(updated.id));
    });
  }
  return { booking: updated };
}

// =====================================================
// approve
// =====================================================

/** Conferma una richiesta pending_approval (verifica conflitti al momento). */
async function approve({ bookingId }) {
  let booking;
  try {
    booking = await withSerializableRetry(
      sequelize,
      { isolationLevel: WRITE_ISOLATION },
      async (t) => {
        const b = await Booking.findByPk(bookingId, { transaction: t });
        if (!b)
          throw new BookingError('Prenotazione non trovata', { status: 404, code: 'NOT_FOUND' });
        if (b.status !== 'pending_approval') {
          throw new BookingError('La prenotazione non è in attesa di approvazione', {
            status: 400,
            code: 'BOOKING_INVALID_STATE',
          });
        }
        const conflict = await Booking.findOne({
          where: {
            roomId: b.roomId,
            status: 'confirmed',
            id: { [Op.ne]: b.id },
            [Op.and]: [
              { startTime: { [Op.lt]: b.endTime } },
              { endTime: { [Op.gt]: b.startTime } },
            ],
          },
          transaction: t,
        });
        if (conflict) {
          throw new BookingError(
            "Slot non più disponibile: nel frattempo è stata confermata un'altra prenotazione",
            { status: 409, code: 'BOOKING_CONFLICT' },
          );
        }
        await b.update({ status: 'confirmed' }, { transaction: t });
        return b;
      },
    );
  } catch (err) {
    throw toBookingError(err);
  }
  const full = await loadFull(booking.id);
  await runAfterCommit(null, () =>
    emailService.sendBookingEmail({ user: full.user, booking: full, kind: 'booking_approved' }),
  );
  return { booking: full };
}

// =====================================================
// cancel
// =====================================================

/**
 * Annulla una prenotazione (status 'cancelled').
 *
 * @param {object} p
 * @param {Booking} [p.booking]   istanza gia' caricata
 * @param {number}  [p.id]        oppure id (404 BookingError se assente)
 * @param {object}  [p.actor]     richiesto con `checkPermission`
 * @param {boolean} [p.checkPermission=false] applica canCancel(actor, booking) -> 403
 * @param {string|null} [p.reason]
 * @param {string[]} [p.expectStatuses] update condizionale: se lo stato e' cambiato
 *                                      (race) ritorna { cancelled: false }
 * @param {object}  [p.onlyIf]    condizioni extra sull'update condizionale (es. { userId })
 * @param {object}  [p.fields]    campi extra (es. autoCancelledAt)
 * @param {string|null} [p.mail]  kind mail all'utente ('cancellation' | 'booking_rejected' | 'ghost_cancellation')
 * @param {boolean} [p.promote=true] promuove la lista d'attesa dopo il commit
 * @param {object}  [p.transaction] tx esterna (effetti su afterCommit)
 * @returns {Promise<{ cancelled: boolean, booking }>}
 */
async function cancel(p) {
  const work = async (t) => {
    const b = p.booking || (await Booking.findByPk(p.id, { transaction: t }));
    if (!b) throw new BookingError('Prenotazione non trovata', { status: 404, code: null });
    if (p.checkPermission) {
      const check = await canCancel(p.actor, b);
      if (!check.ok) throw new BookingError(check.reason, { status: 403, code: null });
    }
    const wasCancelled = b.status === 'cancelled';
    const fields = {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: p.reason ?? null,
      ...(p.fields || {}),
    };
    if (p.expectStatuses) {
      const [affected] = await Booking.update(fields, {
        where: { id: b.id, ...(p.onlyIf || {}), status: { [Op.in]: p.expectStatuses } },
        transaction: t,
        hooks: false,
      });
      if (affected === 0) return { cancelled: false, booking: b };
      await b.reload({ transaction: t });
    } else {
      await b.update(fields, { transaction: t, hooks: false });
    }
    // Come l'hook afterUpdate storico: niente promozione se era gia' annullata.
    return { cancelled: true, booking: b, wasCancelled };
  };

  const result = p.transaction ? await work(p.transaction) : await sequelize.transaction(work);
  if (!result.cancelled) return result;

  const b = result.booking;
  await runAfterCommit(p.transaction, async () => {
    if (p.mail) {
      const full = await loadFull(b.id);
      if (full?.user)
        await emailService.sendBookingEmail({ user: full.user, booking: full, kind: p.mail });
    }
    if (p.promote !== false && !result.wasCancelled) await promoteWaitlist(b);
  });
  return result;
}

/**
 * Annulla piu' prenotazioni in un'unica transazione (bulk admin, serie, GDPR).
 * Ritorna le istanze annullate.
 */
async function cancelMany({
  bookings,
  reason = null,
  fields,
  mail = null,
  promote = true,
  transaction,
}) {
  const work = async (t) => {
    const done = [];
    for (const b of bookings) {
      const r = await cancel({
        booking: b,
        reason,
        fields,
        mail: null,
        promote: false,
        transaction: t,
      });
      if (r.cancelled) done.push({ booking: r.booking, wasCancelled: r.wasCancelled });
    }
    return done;
  };
  const done = transaction ? await work(transaction) : await sequelize.transaction(work);

  await runAfterCommit(transaction, async () => {
    for (const { booking: b, wasCancelled } of done) {
      try {
        if (mail) {
          const full = await loadFull(b.id);
          if (full?.user)
            await emailService.sendBookingEmail({ user: full.user, booking: full, kind: mail });
        }
        if (promote && !wasCancelled) await promoteWaitlist(b);
      } catch (err) {
        logger.warn(
          { err: err.message, bookingId: b.id, scope: 'bookingLifecycle' },
          'cancel effect failed',
        );
      }
    }
  });
  return done.map((d) => d.booking);
}

module.exports = {
  ORIGINS,
  BookingError,
  toBookingError,
  normalizeValidation,
  checkOccurrences,
  loadFull,
  book,
  bookSeries,
  move,
  approve,
  cancel,
  cancelMany,
  promoteWaitlist,
};
