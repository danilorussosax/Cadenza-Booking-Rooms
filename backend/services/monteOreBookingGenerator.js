'use strict';

/**
 * Monte Ore — unico generatore "slot del piano → prenotazioni".
 *
 * Usato da approvazione, decisione di variazione, sospensione calendario,
 * sblocco e dal percorso legacy per anni senza calendario configurato.
 *
 * Il legame slot ↔ prenotazione è `MonteOreSlot.bookingId` (fonte di verità).
 * La colonna JSON `MonteOreSchedule.generatedBookingIds` è LEGACY: non viene più
 * scritta; è letta solo da `releasePlan` (per prenotazioni create prima che
 * esistesse il legame sullo slot) e dalla migrazione di backfill dell'origine.
 *
 * Tutta la creazione/validazione delle prenotazioni passa da `checkSlot` e
 * `createBooking` (unico punto che chiama validateBooking / Booking.create).
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { Op } = require('sequelize');
const { Booking, MonteOreProposal, MonteOreSchedule, MonteOreSlot, User } = require('../models');
const { validateBooking } = require('./bookingValidator');
const { withTransaction } = require('../lib/withTransaction');

dayjs.extend(utc);
dayjs.extend(timezone);

const INSTITUTE_TZ = 'Europe/Rome';
const DEFAULT_ORIGIN = 'monte_ore';

function fail(message, code = 'VALIDATION_FAILED', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

/** Data YYYY-MM-DD + HH:MM (ora locale italiana) → istante UTC. */
function toInstant(date, hhmm) {
  const day = dayjs(date).format('YYYY-MM-DD');
  return dayjs.tz(`${day} ${hhmm}`, INSTITUTE_TZ).toDate();
}

function slotInstants(slot) {
  return {
    startTime: toInstant(slot.date, slot.startTime),
    endTime: toInstant(slot.date, slot.endTime),
  };
}

/** Aula / tipo / attività effettivi: l'override dello slot vince sul pattern. */
function resolveSlots(plan, slots) {
  const schedules = new Map(plan.schedules.map((s) => [s.id, s]));
  return slots.map((s) => {
    const row = s.toJSON ? s.toJSON() : { ...s };
    const schedule = schedules.get(s.scheduleId);
    return {
      ...row,
      roomId: row.roomId ?? schedule?.roomId ?? null,
      bookingType: row.bookingType ?? schedule?.bookingType ?? 'lezione',
      purpose: row.purpose ?? schedule?.purpose ?? null,
    };
  });
}

/** Itera le date in [from, to] del `dayOfWeek` indicato, escluse `excludeDates`. */
function* iterateOccurrences(from, to, dayOfWeek, excludeDates = []) {
  const exclude = new Set((excludeDates || []).map((d) => String(d).slice(0, 10)));
  let cursor = dayjs(from).startOf('day');
  const end = dayjs(to).endOf('day');
  while (cursor.day() !== dayOfWeek && cursor.isBefore(end)) cursor = cursor.add(1, 'day');
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    const iso = cursor.format('YYYY-MM-DD');
    if (!exclude.has(iso)) yield iso;
    cursor = cursor.add(7, 'day');
  }
}

/**
 * Valida (senza creare) la prenotazione di uno slot già risolto.
 * Ritorna { valid, reason, code, startTime, endTime }.
 */
async function checkSlot(plan, slot, transaction, opts = {}) {
  const {
    bypass = { quotas: true, advance: true, duration: true, pastDates: true },
    teacherOverlap = true,
  } = opts;
  const { startTime, endTime } = slotInstants(slot);
  const result = await validateBooking({
    user: plan.user,
    roomId: slot.roomId,
    startTime,
    endTime,
    type: slot.bookingType,
    ignoreBookingId: slot.bookingId,
    bypassQuotas: bypass.quotas,
    bypassAdvance: bypass.advance,
    bypassDuration: bypass.duration,
    bypassPastDates: bypass.pastDates,
    transaction,
  });
  if (!result.valid)
    return {
      valid: false,
      code: result.codes?.[0] || 'BOOKING_CONFLICT',
      reason: result.errors[0] || 'validation_failed',
      message: `${slot.date} ${slot.startTime}: ${result.errors.join('; ')}`,
    };
  if (teacherOverlap) {
    const overlap = await Booking.findOne({
      where: {
        userId: plan.user.id,
        status: 'confirmed',
        startTime: { [Op.lt]: endTime },
        endTime: { [Op.gt]: startTime },
        ...(slot.bookingId ? { id: { [Op.ne]: slot.bookingId } } : {}),
      },
      transaction,
    });
    if (overlap)
      return {
        valid: false,
        code: 'BOOKING_CONFLICT',
        reason: 'teacher_overlap',
        message: `${slot.date}: il docente ha già una lezione in questa fascia`,
      };
  }
  return { valid: true, startTime, endTime };
}

/** Unico punto di creazione delle prenotazioni del monte ore. */
async function createBooking(plan, slot, { startTime, endTime }, { origin, notes }, transaction) {
  return Booking.create(
    {
      userId: plan.user.id,
      roomId: slot.roomId,
      startTime,
      endTime,
      type: slot.bookingType,
      purpose: slot.purpose,
      ...(notes ? { notes } : {}),
      status: 'confirmed',
      origin,
    },
    { transaction },
  );
}

/**
 * Porta le prenotazioni in linea con gli slot del piano.
 *
 * - `slots`: righe già risolte (`resolveSlots`) da (ri)materializzare.
 * - `changedIds`: se valorizzato, solo questi slot; le prenotazioni passate o
 *   svolte richiedono rettifica amministrativa (PAST_SLOT).
 * - `onConflict: 'fail'` (default) interrompe al primo conflitto (tutto-o-niente
 *   grazie alla transazione); `'skip'` salta il conflitto e lo riporta nel
 *   risultato, lasciando lo slot attivo senza prenotazione.
 * - `cancelExisting` (default true): annulla prima le prenotazioni collegate, così
 *   gli scambi composti non collidono con sé stessi. Con false, uno slot già
 *   collegato a una prenotazione confermata viene lasciato com'è.
 *
 * Ritorna { created, bookingIds, skipped, errors }.
 */
async function reconcile(plan, slots, transaction, opts = {}) {
  const {
    changedIds = null,
    origin = DEFAULT_ORIGIN,
    onConflict = 'fail',
    cancelExisting = true,
    cancelReason = 'Revisione monte ore',
    check = {},
  } = opts;
  const lenient = onConflict === 'skip';
  const scheduleById = new Map(plan.schedules.map((s) => [s.id, s]));
  const changed = slots.filter((s) => !changedIds || changedIds.has(s.id));
  const result = { created: 0, bookingIds: [], skipped: [], errors: [] };

  if (cancelExisting) {
    for (const slot of changed) {
      if (!slot.bookingId) continue;
      const booking = await Booking.findByPk(slot.bookingId, { transaction });
      if (!booking || booking.userId !== plan.proposal.userId)
        fail('Collegamento prenotazione non valido');
      if (changedIds && (booking.checkedInAt || new Date(booking.startTime) < new Date()))
        fail('Una prenotazione svolta richiede rettifica amministrativa', 'PAST_SLOT');
      if (booking.status === 'confirmed' || booking.status === 'pending_approval') {
        await booking.update(
          { status: 'cancelled', cancelledAt: new Date(), cancelReason },
          { transaction },
        );
      }
    }
  }

  for (const slot of changed) {
    if (!slot.isActive) {
      await MonteOreSlot.update(
        { ...slot, isActive: false, bookingId: null },
        { where: { id: slot.id }, transaction },
      );
      continue;
    }
    if (!cancelExisting && slot.bookingId) {
      const kept = await Booking.findByPk(slot.bookingId, { transaction });
      if (kept?.status === 'confirmed') continue;
    }
    try {
      const verdict = await checkSlot(plan, slot, transaction, check);
      if (!verdict.valid) {
        if (!lenient) fail(verdict.message, verdict.code);
        result.skipped.push({
          date: slot.date,
          scheduleId: slot.scheduleId ?? null,
          slotId: slot.id,
          reason: verdict.reason,
        });
        continue;
      }
      const notes = scheduleById.get(slot.scheduleId)?.notes || null;
      const booking = await createBooking(plan, slot, verdict, { origin, notes }, transaction);
      await MonteOreSlot.update(
        { ...slot, bookingId: booking.id },
        { where: { id: slot.id }, transaction },
      );
      result.created++;
      result.bookingIds.push(booking.id);
    } catch (err) {
      if (!lenient) throw err;
      result.errors.push({ date: slot.date, slotId: slot.id, message: err.message });
    }
  }
  return result;
}

/**
 * Annulla le prenotazioni di slot sospesi dal calendario e ne azzera il legame.
 * Le prenotazioni già svolte/trascorse bloccano l'operazione (PAST_SLOT).
 */
async function cancelForSlots(slots, transaction, { reason }) {
  for (const slot of slots) {
    if (!slot.bookingId) continue;
    const booking = await Booking.findByPk(slot.bookingId, { transaction });
    if (booking && (booking.checkedInAt || new Date(booking.startTime) < new Date()))
      fail(
        `La modifica coinvolge una lezione già trascorsa (${slot.date}); limita il blocco alle date future`,
        'PAST_SLOT',
      );
    if (booking?.status === 'confirmed')
      await booking.update(
        { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
        { transaction },
      );
    await slot.update({ bookingId: null }, { transaction });
  }
}

/**
 * Sblocco: annulla le prenotazioni future, confermate e non svolte del piano e
 * azzera il legame degli slot annullati. Quelle passate/svolte restano collegate.
 * Considera anche gli id legacy in `generatedBookingIds`.
 */
async function releasePlan(
  proposalId,
  { transaction = null, reason = 'Rigenerazione monte ore' } = {},
) {
  const tx = transaction ? { transaction } : {};
  const slots = await MonteOreSlot.findAll({
    where: { proposalId, bookingId: { [Op.ne]: null } },
    ...tx,
  });
  const schedules = await MonteOreSchedule.findAll({ where: { proposalId }, ...tx });
  const legacyIds = schedules.flatMap((s) =>
    Array.isArray(s.generatedBookingIds) ? s.generatedBookingIds : [],
  );
  const allIds = [...new Set([...slots.map((s) => s.bookingId), ...legacyIds])];
  if (allIds.length === 0) return { cleared: 0 };

  const now = new Date();
  const [cleared] = await Booking.update(
    { status: 'cancelled', cancelledAt: now, cancelReason: reason },
    {
      where: {
        id: { [Op.in]: allIds },
        status: 'confirmed',
        checkedInAt: { [Op.is]: null },
        startTime: { [Op.gt]: now },
      },
      ...tx,
    },
  );
  const survivors = await Booking.findAll({
    where: { id: { [Op.in]: allIds }, status: 'confirmed' },
    attributes: ['id'],
    ...tx,
  });
  const alive = new Set(survivors.map((b) => b.id));
  const orphaned = slots.filter((s) => !alive.has(s.bookingId)).map((s) => s.id);
  if (orphaned.length)
    await MonteOreSlot.update(
      { bookingId: null },
      { where: { id: { [Op.in]: orphaned } }, validate: false, ...tx },
    );
  for (const s of schedules) {
    if (Array.isArray(s.generatedBookingIds) && s.generatedBookingIds.length)
      await s.update(
        { generatedBookingIds: s.generatedBookingIds.filter((id) => alive.has(id)) },
        { transaction },
      );
  }
  return { cleared: cleared || 0 };
}

/**
 * Percorso per anni senza calendario (MonteOreSettings) configurato: le righe
 * schedule vengono espanse in slot e passate al generatore con `onConflict:'skip'`
 * (i conflitti non sono fatali). Se la proposta ha già slot attivi si usano quelli.
 * Ritorna il riepilogo { created, skipped, errors, bookingIds }.
 */
async function generateFromPatterns(plan, transaction, { actorUser, includePast = false } = {}) {
  const { proposal, schedules } = plan;
  if (proposal.status === 'generated') await releasePlan(proposal.id, { transaction });

  let slots = await MonteOreSlot.findAll({
    where: { proposalId: proposal.id, isActive: true, isLocked: false },
    transaction,
  });
  if (slots.length === 0) {
    const existing = await MonteOreSlot.count({ where: { proposalId: proposal.id }, transaction });
    if (existing === 0) {
      for (const sched of schedules) {
        for (const date of iterateOccurrences(
          proposal.validFrom,
          proposal.validTo,
          sched.dayOfWeek,
          sched.excludeDates,
        )) {
          slots.push(
            await MonteOreSlot.create(
              {
                proposalId: proposal.id,
                scheduleId: sched.id,
                date,
                dayOfWeek: sched.dayOfWeek,
                startTime: sched.startTime,
                endTime: sched.endTime,
                isActive: true,
                isLocked: false,
                originalActive: true,
              },
              { transaction },
            ),
          );
        }
      }
    }
  }
  const admin = !!actorUser && actorUser.role === 'admin';
  return reconcile(plan, resolveSlots(plan, slots), transaction, {
    onConflict: 'skip',
    cancelExisting: false,
    check: {
      bypass: { quotas: admin, advance: admin, duration: admin, pastDates: includePast },
      teacherOverlap: false,
    },
  });
}

/**
 * Entry point del percorso "anno senza calendario" (POST /:id/generate):
 * precondizioni, transazione con retry, riepilogo sulla proposta.
 */
async function generateForProposal(proposalId, { actorUser, includePast = false } = {}) {
  const proposal = await MonteOreProposal.findByPk(proposalId, {
    include: [
      { model: User, as: 'user' },
      { model: MonteOreSchedule, as: 'schedules' },
    ],
  });
  if (!proposal) fail('Proposta non trovata', undefined, 404);
  if (!['approved', 'generated'].includes(proposal.status))
    fail(
      'La proposta deve essere approved (o generated) per generare prenotazioni',
      'MONTE_ORE_NOT_APPROVED',
    );
  if (!proposal.schedules || proposal.schedules.length === 0)
    fail('Nessuna riga schedule da generare');
  if (proposal.schedules.some((s) => !s.roomId))
    fail(
      "Tutte le righe devono avere un'aula assegnata prima di generare le prenotazioni",
      'MONTE_ORE_MISSING_ROOM',
    );

  let result;
  await withTransaction(async (t) => {
    const plan = { proposal, schedules: proposal.schedules, user: proposal.user };
    result = await generateFromPatterns(plan, t, { actorUser, includePast });
    await proposal.update(
      {
        status: 'generated',
        generatedAt: new Date(),
        approverId: actorUser?.id ?? proposal.approverId,
        generationSummary: {
          created: result.created,
          skipped: result.skipped.length,
          errors: result.errors.length,
          details: { skipped: result.skipped, errors: result.errors },
        },
      },
      { transaction: t },
    );
  });
  return {
    created: result.created,
    skipped: result.skipped,
    errors: result.errors,
    bookingIds: result.bookingIds,
  };
}

module.exports = {
  generateForProposal,
  INSTITUTE_TZ,
  toInstant,
  slotInstants,
  resolveSlots,
  iterateOccurrences,
  checkSlot,
  reconcile,
  cancelForSlots,
  releasePlan,
  generateFromPatterns,
};
