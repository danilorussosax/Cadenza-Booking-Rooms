'use strict';

const { Op, Transaction } = require('sequelize');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const {
  sequelize,
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSlot,
  MonteOreAmendment,
  MonteOreSettings,
  MonteOreSuspension,
  User,
  Booking,
  MailOutbox,
  Room,
} = require('../models');
const { resolveAnnualThreshold } = require('./monteOreThresholdService');
const { validateDailyConstraints } = require('./monteOreDailyValidator');
const { validateBooking } = require('./bookingValidator');
const { withSerializableRetry } = require('../lib/serializableTx');

function fail(message, code = 'VALIDATION_FAILED', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function transact(fn) {
  return withSerializableRetry(
    sequelize,
    sequelize.getDialect() === 'postgres'
      ? { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }
      : {},
    fn,
  );
}

async function loadPlan(id, transaction, lock = false) {
  const proposal = await MonteOreProposal.findByPk(id, {
    transaction,
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!proposal) fail('Proposta non trovata', 'NOT_FOUND', 404);
  const schedules = await MonteOreSchedule.findAll({ where: { proposalId: id }, transaction });
  const slots = await MonteOreSlot.findAll({ where: { proposalId: id }, transaction });
  const settings = await MonteOreSettings.findOne({
    where: { academicYear: proposal.academicYear },
    transaction,
  });
  const suspensions = await MonteOreSuspension.findAll({
    where: { academicYear: proposal.academicYear },
    transaction,
  });
  const user = await User.findByPk(proposal.userId, { transaction });
  return { proposal, schedules, slots, settings, suspensions, user };
}

function minuteOf(time) {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    fail('Orario non valido');
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutes(slots) {
  return slots
    .filter((s) => s.isActive && !s.isLocked)
    .reduce((total, s) => total + minuteOf(s.endTime) - minuteOf(s.startTime), 0);
}

function checkHours(totalMinutes, rule) {
  const required = Math.round(rule.minHours * 60);
  if (totalMinutes <= 0 && rule.mode === 'maximum')
    fail('Seleziona almeno una data di didattica', 'EMPTY_PLAN');
  if (rule.mode === 'maximum' && totalMinutes > required) {
    fail(`Il contratto consente al massimo ${rule.minHours} ore annuali`, 'HOURS_ABOVE_LIMIT');
  }
  if (rule.mode === 'exact' && totalMinutes !== required) {
    fail(
      `Il piano deve contenere esattamente ${rule.minHours} ore annuali (attuali: ${(totalMinutes / 60).toFixed(2)})`,
      'HOURS_NOT_MATCHING_CONTRACT',
    );
  }
  if ((!rule.mode || rule.mode === 'minimum') && totalMinutes < required) {
    fail(
      `Il piano deve contenere almeno ${rule.minHours} ore annuali${rule.source === 'user_override' ? ': soglia personalizzata' : ''}`,
      'HOURS_BELOW_THRESHOLD',
    );
  }
}

function validateCalendar(slot, plan) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(slot.date) ||
    !dayjs(slot.date).isValid() ||
    dayjs(slot.date).format('YYYY-MM-DD') !== slot.date
  )
    fail('Data non valida');
  if (minuteOf(slot.endTime) <= minuteOf(slot.startTime))
    fail('La fine deve essere successiva all’inizio');
  if (slot.date < plan.proposal.validFrom || slot.date > plan.proposal.validTo)
    fail('Data fuori dalla validità del piano', 'DATE_OUTSIDE_PLAN');
  if (dayjs(slot.date).day() === 0) fail('La domenica non è un giorno di didattica');
  if (
    plan.settings &&
    (slot.date < plan.settings.lessonsStartDate || slot.date > plan.settings.lessonsEndDate)
  )
    fail('Data fuori dal calendario didattico', 'DATE_OUTSIDE_CALENDAR');
  if (
    slot.isLocked ||
    plan.suspensions.some((s) => slot.date >= s.dateFrom && slot.date <= s.dateTo)
  )
    fail(`Didattica sospesa il ${slot.date}`, 'SLOT_LOCKED');
}

async function validatePlan(
  plan,
  slots,
  { transaction, snapshot = true, requireRooms = false } = {},
) {
  const rule =
    snapshot && !plan.proposal.requiresRevalidation && plan.proposal.contractSnapshot
      ? plan.proposal.contractSnapshot
      : await resolveAnnualThreshold(plan.proposal.userId, plan.proposal.academicYear, {
          transaction,
        });
  const totalMinutes = minutes(slots);
  // Unconfigured legacy calendars retain their historical pattern-only workflow.
  if (plan.settings) {
    if (!rule.bypassDayConstraint) {
      const days = new Set(plan.schedules.map((s) => s.dayOfWeek));
      if (days.size < 2 || days.size > 4)
        fail('Il piano richiede da 2 a 4 giorni settimanali', 'WORKING_DAYS_OUT_OF_RANGE');
    }
    checkHours(totalMinutes, rule);
  }
  const active = slots.filter((s) => s.isActive);
  for (const slot of active) {
    validateCalendar(slot, plan);
    if (requireRooms && !slot.roomId)
      fail(`Assegna l’aula definitiva per il ${slot.date}`, 'MONTE_ORE_MISSING_ROOM');
  }
  const byDate = new Map();
  for (const slot of active) {
    const entries = byDate.get(slot.date) || [];
    if (entries.some((s) => s.startTime < slot.endTime && s.endTime > slot.startTime))
      fail(`Fasce sovrapposte il ${slot.date}`, 'BOOKING_CONFLICT');
    entries.push(slot);
    byDate.set(slot.date, entries);
  }
  for (const entries of byDate.values()) {
    const daily = validateDailyConstraints(entries, plan.settings || {});
    if (!daily.ok) fail('Il piano non rispetta i vincoli giornalieri', daily.violations[0].code);
  }
  return { rule, totalMinutes };
}

function expandRooms(plan, slots) {
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

async function checkBooking(plan, slot, transaction) {
  const startTime = dayjs.tz(`${slot.date} ${slot.startTime}`, 'Europe/Rome').toDate();
  const endTime = dayjs.tz(`${slot.date} ${slot.endTime}`, 'Europe/Rome').toDate();
  const result = await validateBooking({
    user: plan.user,
    roomId: slot.roomId,
    startTime,
    endTime,
    type: slot.bookingType,
    ignoreBookingId: slot.bookingId,
    bypassQuotas: true,
    bypassAdvance: true,
    bypassDuration: true,
    bypassPastDates: true,
    transaction,
  });
  if (!result.valid)
    fail(
      `${slot.date} ${slot.startTime}: ${result.errors.join('; ')}`,
      result.codes?.[0] || 'BOOKING_CONFLICT',
    );
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
    fail(`${slot.date}: il docente ha già una lezione in questa fascia`, 'BOOKING_CONFLICT');
  return { startTime, endTime };
}

async function materialize(plan, slots, transaction, changedIds = null) {
  const changed = slots.filter((s) => !changedIds || changedIds.has(s.id));
  // Cancel all affected bookings first so compound swaps do not collide with themselves.
  for (const slot of changed) {
    if (!slot.bookingId) continue;
    const booking = await Booking.findByPk(slot.bookingId, { transaction });
    if (!booking || booking.userId !== plan.proposal.userId)
      fail('Collegamento prenotazione non valido');
    if (changedIds && (booking.checkedInAt || new Date(booking.startTime) < new Date()))
      fail('Una prenotazione svolta richiede rettifica amministrativa', 'PAST_SLOT');
    if (booking.status === 'confirmed' || booking.status === 'pending_approval') {
      await booking.update(
        { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Revisione monte ore' },
        { transaction },
      );
    }
  }
  let created = 0;
  for (const slot of changed) {
    if (!slot.isActive) {
      await MonteOreSlot.update(
        { ...slot, isActive: false, bookingId: null },
        { where: { id: slot.id }, transaction },
      );
      continue;
    }
    const times = await checkBooking(plan, slot, transaction);
    const booking = await Booking.create(
      {
        userId: plan.user.id,
        roomId: slot.roomId,
        ...times,
        type: slot.bookingType,
        purpose: slot.purpose,
        status: 'confirmed',
      },
      { transaction },
    );
    await MonteOreSlot.update(
      { ...slot, bookingId: booking.id },
      { where: { id: slot.id }, transaction },
    );
    created++;
  }
  // Keep legacy clear/unlock compatible with bookings created by this workflow.
  for (const schedule of plan.schedules) {
    const linked = await MonteOreSlot.findAll({
      where: {
        proposalId: plan.proposal.id,
        scheduleId: schedule.id,
        bookingId: { [Op.ne]: null },
      },
      transaction,
    });
    await schedule.update({ generatedBookingIds: linked.map((s) => s.bookingId) }, { transaction });
  }
  return created;
}

async function preview(id, assignments = []) {
  if (!Array.isArray(assignments) || assignments.length > 5000) fail('Assegnazioni non valide');
  const plan = await loadPlan(id);
  const slots = expandRooms(plan, plan.slots);
  for (const a of assignments) {
    const slot = slots.find((s) => s.id === a.slotId);
    if (!slot || !Number.isInteger(a.roomId) || a.roomId <= 0) fail('Assegnazione non valida');
    slot.roomId = a.roomId;
  }
  const issues = [];
  try {
    await validatePlan(plan, slots, { requireRooms: true });
  } catch (e) {
    issues.push({ message: e.message, code: e.code });
  }
  for (const slot of slots.filter((s) => s.isActive && s.roomId)) {
    try {
      await checkBooking(plan, slot);
    } catch (e) {
      issues.push({ date: slot.date, message: e.message, code: e.code });
    }
  }
  return {
    totalHours: minutes(slots) / 60,
    activeCount: slots.filter((s) => s.isActive).length,
    issues,
    slots,
  };
}

async function approvePlan(id, actor, assignments = []) {
  if (!Array.isArray(assignments) || assignments.length > 5000) fail('Assegnazioni non valide');
  return transact(async (transaction) => {
    const plan = await loadPlan(id, transaction, true);
    if (!['submitted', 'approved'].includes(plan.proposal.status))
      fail('Proposta non approvabile', 'INVALID_STATE');
    if (!plan.settings) {
      await plan.proposal.update(
        { status: 'approved', approvedAt: new Date(), approverId: actor.id },
        { transaction },
      );
      return plan.proposal;
    }
    for (const assignment of assignments) {
      if (
        !plan.slots.some((s) => s.id === assignment.slotId) ||
        !Number.isInteger(assignment.roomId)
      )
        fail('Assegnazione aula non valida');
      await MonteOreSlot.update(
        { roomId: assignment.roomId },
        { where: { id: assignment.slotId, proposalId: id }, transaction, validate: false },
      );
    }
    if (assignments.length)
      plan.slots = await MonteOreSlot.findAll({ where: { proposalId: id }, transaction });
    const slots = expandRooms(plan, plan.slots);
    const { rule, totalMinutes } = await validatePlan(plan, slots, {
      transaction,
      requireRooms: true,
    });
    const created = await materialize(plan, slots, transaction);
    await MonteOreSlot.update(
      { originalActive: true },
      { where: { proposalId: id, isActive: true }, transaction, validate: false },
    );
    await plan.proposal.update(
      {
        status: 'generated',
        approvedAt: new Date(),
        generatedAt: new Date(),
        approverId: actor.id,
        rejectedAt: null,
        rejectionReason: null,
        requiresRevalidation: false,
        revalidationReason: null,
        contractSnapshot: rule,
        totalHoursPlanned: totalMinutes / 60,
        totalHoursRequested: totalMinutes / 60,
        revision: plan.proposal.revision + 1,
        generationSummary: { created, skipped: 0, errors: 0 },
      },
      { transaction },
    );
    return plan.proposal;
  });
}

function applyOperations(plan, original, operations, { checkPast = true } = {}) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 100)
    fail('Inserisci da 1 a 100 modifiche');
  const slots = original.map((s) => ({ ...s }));
  const changed = new Set();
  for (const [index, op] of operations.entries()) {
    if (
      !op ||
      typeof op !== 'object' ||
      Array.isArray(op) ||
      typeof op.kind !== 'string' ||
      (op.payload != null && (typeof op.payload !== 'object' || Array.isArray(op.payload)))
    )
      fail('Operazione non valida');
    if (op.kind === 'add_new_day') {
      const slot = {
        id: -(index + 1),
        scheduleId: null,
        isActive: true,
        isLocked: false,
        originalActive: false,
        bookingId: null,
        date: op.payload?.date,
        startTime: op.payload?.startTime,
        endTime: op.payload?.endTime,
        roomId: op.payload?.roomId || null,
        bookingType: op.payload?.bookingType || 'lezione',
        purpose: op.payload?.purpose || null,
        dayOfWeek: dayjs(op.payload?.date).day(),
      };
      validateCalendar(slot, plan);
      if (
        checkPast &&
        dayjs.tz(`${slot.date} ${slot.startTime}`, 'Europe/Rome').toDate() <= new Date()
      )
        fail('Non puoi modificare date già trascorse', 'PAST_SLOT');
      if (slot.roomId != null && !Number.isInteger(slot.roomId)) fail('Aula non valida');
      slots.push(slot);
      changed.add(slot.id);
      continue;
    }
    if (!Number.isInteger(op.slotId) || op.slotId <= 0) fail('Occorrenza non valida');
    const slot = slots.find((s) => s.id === op.slotId);
    if (!slot) fail('Occorrenza non appartenente alla proposta', 'NOT_FOUND');
    validateCalendar(slot, plan);
    if (
      checkPast &&
      dayjs.tz(`${slot.date} ${slot.startTime}`, 'Europe/Rome').toDate() <= new Date()
    )
      fail('Non puoi modificare date già trascorse', 'PAST_SLOT');
    if (op.kind === 'toggle_off') slot.isActive = false;
    else if (op.kind === 'toggle_on') slot.isActive = true;
    else if (op.kind === 'change_time') {
      slot.startTime = op.payload?.startTime ?? slot.startTime;
      slot.endTime = op.payload?.endTime ?? slot.endTime;
    } else if (op.kind === 'change_room') {
      if (!Number.isInteger(op.payload?.roomId) || op.payload.roomId <= 0) fail('Aula non valida');
      slot.roomId = op.payload.roomId;
    } else if (op.kind === 'move_to') {
      const target = slots.find((s) => s.id === op.payload?.targetSlotId);
      if (!slot.isActive || !target || target.isActive) fail('Scegli una destinazione libera');
      validateCalendar(target, plan);
      if (
        checkPast &&
        dayjs.tz(`${target.date} ${target.startTime}`, 'Europe/Rome').toDate() <= new Date()
      )
        fail('Destinazione già trascorsa', 'PAST_SLOT');
      slot.isActive = false;
      target.isActive = true;
      changed.add(target.id);
    } else fail('Tipo di variazione non valido');
    validateCalendar(slot, plan);
    changed.add(slot.id);
  }
  return { slots, changed };
}

async function requestAmendment(id, userId, { operations, notes, requestKey }) {
  if (!requestKey || typeof requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(requestKey))
    fail('Identificatore richiesta obbligatorio');
  return transact(async (transaction) => {
    const plan = await loadPlan(id, transaction, true);
    if (plan.proposal.userId !== userId) fail('Non autorizzato', 'FORBIDDEN', 403);
    const key = `${id}:${requestKey}`;
    const previous = await MonteOreAmendment.findOne({
      where: { idempotencyKey: key },
      transaction,
    });
    if (previous) {
      if (JSON.stringify(previous.operations) !== JSON.stringify(operations))
        fail('Identificatore già usato per una richiesta diversa', 'REQUEST_KEY_REUSED', 409);
      return previous;
    }
    if (!['approved', 'generated'].includes(plan.proposal.status))
      fail('La proposta non è approvata', 'INVALID_STATE');
    if (plan.proposal.requiresRevalidation)
      fail('Il piano deve essere rivalidato dal revisore', 'REVALIDATION_REQUIRED');
    const { slots, changed } = applyOperations(plan, expandRooms(plan, plan.slots), operations);
    await validatePlan(plan, slots, { transaction });
    const pending = await MonteOreAmendment.findAll({
      where: { proposalId: id, status: 'pending' },
      transaction,
    });
    for (const a of pending) {
      const old = a.operations || [{ kind: a.kind, slotId: a.slotId, payload: a.payload }];
      if (
        old.some(
          (op) =>
            op.kind === 'add_new_day' &&
            slots.some(
              (s) =>
                changed.has(s.id) &&
                s.isActive &&
                s.date === op.payload?.date &&
                s.startTime < op.payload.endTime &&
                s.endTime > op.payload.startTime,
            ),
        )
      )
        fail('Una richiesta per questa data è già in attesa', 'AMENDMENT_PENDING');
      if (old.some((op) => changed.has(op.slotId) || changed.has(op.payload?.targetSlotId)))
        fail('Una variazione per questa data è già in attesa', 'AMENDMENT_PENDING');
    }
    const maximum = plan.settings?.maxAmendmentsPerYear ?? 3;
    const [updated] = await MonteOreProposal.update(
      { requestCount: sequelize.literal('"requestCount" + 1') },
      { where: { id, requestCount: { [Op.lt]: maximum } }, transaction },
    );
    if (!updated)
      fail(`Limite di ${maximum} richieste annuali raggiunto`, 'AMENDMENT_LIMIT_REACHED');
    const first = operations[0];
    return MonteOreAmendment.create(
      {
        proposalId: id,
        requesterId: userId,
        slotId: first.slotId || null,
        kind: first.kind,
        payload: first.payload || {},
        operations,
        status: 'pending',
        requestNotes: notes ? String(notes).slice(0, 2000) : null,
        baseRevision: plan.proposal.revision,
        idempotencyKey: key,
        beforeSnapshot: expandRooms(plan, plan.slots).filter((s) => changed.has(s.id)),
      },
      { transaction },
    );
  });
}

async function enqueueDecision(plan, amendment, before, after, transaction) {
  const { getTemplate, render, renderText } = require('./emailService');
  const modified =
    amendment.finalOperations &&
    JSON.stringify(amendment.finalOperations) !== JSON.stringify(amendment.operations);
  const outcome =
    amendment.status === 'rejected'
      ? 'rifiutata'
      : modified
        ? 'modificata e approvata'
        : 'approvata';
  const rooms = await Room.findAll({ transaction });
  const names = new Map(rooms.map((r) => [r.id, r.name]));
  const describe = (slots) =>
    slots
      .filter((s) => s.isActive)
      .map(
        (s) =>
          `${s.date} ${s.startTime}–${s.endTime}, ${names.get(s.roomId) || 'aula da assegnare'}`,
      )
      .join('\n');
  const kind =
    amendment.status === 'rejected'
      ? 'monte_ore_rejected'
      : modified
        ? 'monte_ore_modified'
        : 'monte_ore_approved';
  const template = await getTemplate(kind);
  const maximum = plan.settings?.maxAmendmentsPerYear ?? 3;
  const context = {
    firstName: plan.user.firstName,
    academicYear: plan.proposal.academicYear,
    outcome,
    reason: amendment.decisionNotes || amendment.rejectionReason || '—',
    before: describe(before),
    after: describe(after),
    hours: Number(plan.proposal.totalHoursPlanned).toFixed(2),
    remaining: Math.max(0, maximum - plan.proposal.requestCount),
    url: `${process.env.FRONTEND_URL || ''}/monte-ore?request=${amendment.id}`,
  };
  const subject = renderText(template.subject, context);
  const html = render(template.bodyHtml, context);
  await MailOutbox.create(
    {
      kind,
      to: plan.user.email,
      subject,
      bodyHtml: html,
      idempotencyKey: `monte-ore:${amendment.id}:decision`,
      priority: 4,
    },
    { transaction },
  );
}

async function decideAmendment(
  id,
  aid,
  actor,
  { reject = false, reason, operations, administrative = false } = {},
) {
  return transact(async (transaction) => {
    const plan = await loadPlan(id, transaction, true);
    if (administrative && actor.role !== 'admin') fail('Non autorizzato', 'FORBIDDEN', 403);
    if (administrative && (!operations?.length || !String(reason || '').trim()))
      fail('Inserisci modifiche e motivazione della rivalidazione');
    const amendment = administrative
      ? await MonteOreAmendment.create(
          {
            proposalId: id,
            requesterId: actor.id,
            slotId: operations[0].slotId || null,
            kind: operations[0].kind,
            payload: operations[0].payload || {},
            operations,
            status: 'pending',
            requestNotes: 'Rettifica amministrativa; non consuma il limite docente',
            baseRevision: plan.proposal.revision,
          },
          { transaction },
        )
      : await MonteOreAmendment.findOne({
          where: { id: aid, proposalId: id },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
    if (!amendment) fail('Variazione non trovata', 'NOT_FOUND', 404);
    if (amendment.status !== 'pending') fail('Variazione già decisa', 'INVALID_STATE');
    const before = expandRooms(plan, plan.slots);
    if (reject) {
      if (!String(reason || '').trim()) fail('Inserisci il motivo del rifiuto');
      await amendment.update(
        {
          status: 'rejected',
          rejectionReason: String(reason).slice(0, 2000),
          decisionNotes: String(reason).slice(0, 2000),
          decidedAt: new Date(),
          decidedBy: actor.id,
        },
        { transaction },
      );
      await enqueueDecision(plan, amendment, before, before, transaction);
      return amendment;
    }
    if (!['approved', 'generated'].includes(plan.proposal.status))
      fail('Piano non operativo', 'INVALID_STATE');
    if (!administrative && plan.proposal.requiresRevalidation)
      fail('Rivalida il piano prima di approvare variazioni', 'REVALIDATION_REQUIRED');
    if (amendment.baseRevision != null && amendment.baseRevision !== plan.proposal.revision)
      fail('Il piano è cambiato: rifiuta e richiedi una nuova variazione', 'STALE_AMENDMENT', 409);
    const requested = amendment.operations || [
      { kind: amendment.kind, slotId: amendment.slotId, payload: amendment.payload },
    ];
    const final = operations || requested;
    if (JSON.stringify(final) !== JSON.stringify(requested) && !String(reason || '').trim())
      fail('Motiva la modifica del revisore');
    const { slots, changed } = applyOperations(plan, before, final);
    const { totalMinutes, rule } = await validatePlan(plan, slots, {
      transaction,
      requireRooms: true,
      snapshot: !administrative,
    });
    for (const slot of slots.filter((s) => s.id < 0)) {
      const created = await MonteOreSlot.create(
        { ...slot, id: undefined, proposalId: id },
        { transaction },
      );
      changed.delete(slot.id);
      slot.id = created.id;
      changed.add(slot.id);
    }
    if (plan.proposal.status === 'generated') await materialize(plan, slots, transaction, changed);
    else
      for (const slot of slots.filter((s) => changed.has(s.id))) {
        if (slot.isActive) await checkBooking(plan, slot, transaction);
        await MonteOreSlot.update(slot, { where: { id: slot.id }, transaction });
      }
    await plan.proposal.update(
      {
        totalHoursPlanned: totalMinutes / 60,
        totalHoursRequested: totalMinutes / 60,
        revision: plan.proposal.revision + 1,
        ...(administrative
          ? { requiresRevalidation: false, revalidationReason: null, contractSnapshot: rule }
          : {}),
      },
      { transaction },
    );
    await amendment.update(
      {
        status: 'approved',
        beforeSnapshot: amendment.beforeSnapshot || before.filter((s) => changed.has(s.id)),
        afterSnapshot: slots.filter((s) => changed.has(s.id)),
        finalOperations: final,
        decisionNotes: reason ? String(reason).slice(0, 2000) : null,
        decidedAt: new Date(),
        decidedBy: actor.id,
      },
      { transaction },
    );
    await enqueueDecision(
      plan,
      amendment,
      before.filter((s) => changed.has(s.id)),
      slots.filter((s) => changed.has(s.id)),
      transaction,
    );
    return amendment;
  });
}

module.exports = {
  transact,
  loadPlan,
  minuteOf,
  minutes,
  checkHours,
  validatePlan,
  expandRooms,
  preview,
  approvePlan,
  requestAmendment,
  decideAmendment,
  fail,
};
