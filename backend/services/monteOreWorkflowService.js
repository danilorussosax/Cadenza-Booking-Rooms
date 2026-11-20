'use strict';

const { Op, Transaction } = require('sequelize');
const dayjs = require('dayjs');
const {
  sequelize,
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSlot,
  MonteOreAmendment,
  MonteOreSettings,
  MonteOreSuspension,
  User,
  Room,
} = require('../models');
const { resolveAnnualThreshold } = require('./monteOreThresholdService');
const { validateDailyConstraints } = require('./monteOreDailyValidator');
const generator = require('./monteOreBookingGenerator');
const { withSerializableRetry } = require('../lib/serializableTx');
const institutionTime = require('../lib/institutionTime');
const mailContext = require('./mailContext');
const rules = require('./monteOrePlanRules');

const { STATUS, fail, minuteOf, activeMinutes, amendmentOperations } = rules;

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
  if (lock && settings && settings.status !== 'published')
    fail('Anno non pubblicato per la compilazione', 'ACADEMIC_YEAR_NOT_PUBLISHED', 409);
  const suspensions = await MonteOreSuspension.findAll({
    where: { academicYear: proposal.academicYear },
    transaction,
  });
  const user = await User.findByPk(proposal.userId, { transaction });
  return { proposal, schedules, slots, settings, suspensions, user };
}

const minutes = activeMinutes;

function checkHours(totalMinutes, rule) {
  const required = Math.round(rule.minHours * 60);
  if (totalMinutes <= 0 && rule.mode === 'maximum')
    fail('Seleziona almeno una data di didattica', 'EMPTY_PLAN');
  if (rule.mode === 'maximum' && totalMinutes > required) {
    fail(
      `Il contratto consente al massimo ${rule.minHours} ore annuali`,
      'HOURS_ABOVE_LIMIT',
      400,
      {
        hours: rule.minHours,
      },
    );
  }
  if (rule.mode === 'exact' && totalMinutes !== required) {
    fail(
      `Il piano deve contenere esattamente ${rule.minHours} ore annuali (attuali: ${(totalMinutes / 60).toFixed(2)})`,
      'HOURS_NOT_MATCHING_CONTRACT',
      400,
      { hours: rule.minHours, current: Number((totalMinutes / 60).toFixed(2)) },
    );
  }
  if ((!rule.mode || rule.mode === 'minimum') && totalMinutes < required) {
    fail(
      `Il piano deve contenere almeno ${rule.minHours} ore annuali${rule.source === 'user_override' ? ': soglia personalizzata' : ''}`,
      'HOURS_BELOW_THRESHOLD',
      400,
      { hours: rule.minHours },
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

const expandRooms = generator.resolveSlots;

async function checkBooking(plan, slot, transaction) {
  const verdict = await generator.checkSlot(plan, slot, transaction);
  if (!verdict.valid) fail(verdict.message, verdict.code);
  return verdict;
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
    if (!rules.isApprovable(plan.proposal.status))
      fail('Proposta non approvabile', 'INVALID_STATE');
    if (!plan.settings) {
      await plan.proposal.update(
        { status: STATUS.APPROVED, approvedAt: new Date(), approverId: actor.id },
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
    const { created } = await generator.reconcile(plan, slots, transaction);
    await MonteOreSlot.update(
      { originalActive: true },
      { where: { proposalId: id, isActive: true }, transaction, validate: false },
    );
    await plan.proposal.update(
      {
        status: STATUS.GENERATED,
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
      if (checkPast && generator.slotInstants(slot).startTime <= institutionTime.now())
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
    if (checkPast && generator.slotInstants(slot).startTime <= institutionTime.now())
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
      if (checkPast && generator.slotInstants(target).startTime <= institutionTime.now())
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
    if (!rules.isAmendable(plan.proposal.status))
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
      const old = amendmentOperations(a);
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
      fail(`Limite di ${maximum} richieste annuali raggiunto`, 'AMENDMENT_LIMIT_REACHED', 400, {
        maximum,
      });
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
  const maximum = plan.settings?.maxAmendmentsPerYear ?? 3;
  await mailContext.renderAndQueue(
    kind,
    {
      firstName: plan.user.firstName,
      academicYear: plan.proposal.academicYear,
      outcome,
      reason: amendment.decisionNotes || amendment.rejectionReason || '—',
      before: describe(before),
      after: describe(after),
      hours: Number(plan.proposal.totalHoursPlanned).toFixed(2),
      remaining: Math.max(0, maximum - plan.proposal.requestCount),
      url: `${process.env.FRONTEND_URL || ''}/monte-ore?request=${amendment.id}`,
    },
    {
      to: plan.user.email,
      transaction,
      priority: 4,
      idempotencyKey: `monte-ore:${amendment.id}:decision`,
    },
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
    if (!rules.isAmendable(plan.proposal.status)) fail('Piano non operativo', 'INVALID_STATE');
    if (!administrative && plan.proposal.requiresRevalidation)
      fail('Rivalida il piano prima di approvare variazioni', 'REVALIDATION_REQUIRED');
    if (amendment.baseRevision != null && amendment.baseRevision !== plan.proposal.revision)
      fail('Il piano è cambiato: rifiuta e richiedi una nuova variazione', 'STALE_AMENDMENT', 409);
    const requested = amendmentOperations(amendment);
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
    if (plan.proposal.status === 'generated')
      await generator.reconcile(plan, slots, transaction, { changedIds: changed });
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

// ============================================================
// Transizioni di stato del piano (invia, importa, respingi, riporta in bozza,
// sblocca, riapri) e risposta calcolata "pronto? cosa blocca? cosa si può fare".
// Le route fanno solo auth + parse + chiamata + mappatura errori.
// ============================================================

/** Messaggio italiano per una violazione di vincolo giornaliero. */
function formatDailyViolationMessage(v, totalViolations) {
  const dayLabels = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  const dayName = dayLabels[v.dayOfWeek] || `Giorno ${v.dayOfWeek}`;
  const suffix = totalViolations > 1 ? ` (e altre ${totalViolations - 1} violazioni)` : '';
  if (v.code === 'DAILY_HOURS_EXCEEDED') {
    return `${dayName}: ${v.totalHours}h totali superano il massimo di ${v.limit}h giornaliere${suffix}`;
  }
  if (v.code === 'BREAK_REQUIRED') {
    return `${dayName}: ${v.consecutiveHours}h consecutive richiedono una pausa di almeno ${v.breakNeeded} minuti dopo ${v.threshold}h${suffix}`;
  }
  return `Violazione vincolo giornaliero${suffix}`;
}

/** Proposta del docente per l'anno, bloccata e in uno stato modificabile direttamente. */
async function findOwnEditableProposal(userId, year, transaction = null) {
  const settings = await MonteOreSettings.findOne({ where: { academicYear: year }, transaction });
  if (settings && settings.status !== 'published')
    fail('Anno non pubblicato per la compilazione', 'ACADEMIC_YEAR_NOT_PUBLISHED', 409);
  const proposal = await MonteOreProposal.findOne({
    where: { userId, academicYear: year },
    transaction,
    ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!proposal) fail("Nessuna proposta per l'anno corrente", 'NOT_FOUND', 404);
  if (!rules.isTeacherEditable(proposal.status))
    fail('Proposta non modificabile (stato: ' + proposal.status + ')', 'INVALID_STATE');
  return proposal;
}

async function lockProposal(id, transaction) {
  const proposal = await MonteOreProposal.findByPk(id, {
    transaction,
    ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!proposal) fail('Proposta non trovata', 'NOT_FOUND', 404);
  return proposal;
}

/** rejected → draft quando il docente rimette mano a una proposta respinta. */
async function reopenIfRejected(proposal, transaction) {
  if (proposal.status !== STATUS.REJECTED) return proposal;
  return proposal.update(
    { status: STATUS.DRAFT, rejectedAt: null, rejectionReason: null },
    { transaction },
  );
}

/**
 * Regole di invio: pattern presente, vincoli giornalieri, griglia allineata e
 * piano valido. Lancia al primo blocco; ritorna null per i piani legacy senza
 * calendario, altrimenti { rule, totalMinutes }.
 */
async function assertSubmittable(plan, { transaction } = {}) {
  if (!plan.schedules.length)
    fail('Imposta il pattern settimanale prima di inviare', 'EMPTY_PATTERN');
  if (!plan.settings) return null;
  const daily = validateDailyConstraints(plan.schedules, plan.settings);
  if (!daily.ok) {
    const error = new Error(
      formatDailyViolationMessage(daily.violations[0], daily.violations.length),
    );
    error.status = 400;
    error.code = daily.violations[0].code;
    error.violations = daily.violations;
    throw error;
  }
  // Detect pattern edits not yet propagated to the grid.
  for (const slot of plan.slots.filter((s) => s.isActive)) {
    const schedule = plan.schedules.find((s) => s.id === slot.scheduleId);
    if (
      !schedule ||
      schedule.dayOfWeek !== slot.dayOfWeek ||
      schedule.startTime !== slot.startTime ||
      schedule.endTime !== slot.endTime
    )
      fail('Rigenera la griglia dopo aver modificato il pattern', 'STALE_GRID');
  }
  return validatePlan(plan, expandRooms(plan, plan.slots), { transaction, snapshot: false });
}

/** Campi di snapshot scritti ogni volta che un piano diventa "submitted". */
function submissionFields(plan, validated) {
  const distinctDays = new Set(plan.schedules.map((s) => s.dayOfWeek));
  return {
    workingDaysCount: validated.rule.bypassDayConstraint ? null : distinctDays.size,
    totalHoursRequested: validated.totalMinutes / 60,
    totalHoursPlanned: validated.totalMinutes / 60,
    minRequiredHoursSnapshot: validated.rule.minHours,
    contractSnapshot: validated.rule,
    requiresRevalidation: false,
    revalidationReason: null,
  };
}

/** draft|rejected → submitted (docente). */
async function submitPlan(userId, year) {
  return transact(async (transaction) => {
    const proposal = await findOwnEditableProposal(userId, year, transaction);
    const plan = await loadPlan(proposal.id, transaction);
    const validated = await assertSubmittable(plan, { transaction });
    await proposal.update(
      {
        status: STATUS.SUBMITTED,
        submittedAt: new Date(),
        ...(validated ? submissionFields(plan, validated) : {}),
      },
      { transaction },
    );
    return proposal;
  });
}

/**
 * import Excel → submitted (admin). Stessi campi di snapshot dell'invio a
 * mano. Il piano importato è validato solo per i contratti exact/maximum: un
 * import sotto soglia 'minimum' resta ammesso e lo corregge la revisione.
 */
async function importPlanAsSubmitted({
  teacher,
  academicYear,
  actor,
  schedules,
  purpose,
  coordinatorNotes,
  sourceRef,
  range,
  totalHoursPattern,
  overwrite = true,
  force = false,
}) {
  const slotService = require('./monteOreSlotService');
  return transact(async (t) => {
    const now = new Date();
    const importFields = {
      status: STATUS.SUBMITTED,
      source: 'admin_import',
      importedAt: now,
      importedById: actor.id,
      importSourceRef: sourceRef,
      submittedAt: now,
      coordinatorNotes: coordinatorNotes || null,
      totalHoursRequested: Number(totalHoursPattern.toFixed(2)),
    };
    const [proposal, created] = await MonteOreProposal.findOrCreate({
      where: { userId: teacher.id, academicYear },
      defaults: {
        userId: teacher.id,
        academicYear,
        validFrom: range.validFrom,
        validTo: range.validTo,
        ...importFields,
      },
      transaction: t,
    });
    if (!created) {
      if (!overwrite) fail('Proposta già esistente per questo docente e AA', 'ALREADY_EXISTS', 409);
      if (proposal.status === STATUS.GENERATED)
        fail('Annulla la generazione prima di sostituire il piano via import', 'INVALID_STATE');
      // Oltre draft/submitted/rejected serve force=true per non sovrascrivere lavoro approvato.
      if (!rules.isImportReplaceable(proposal.status) && !force)
        fail(
          `Proposta in stato '${proposal.status}': passa force=true per sovrascrivere`,
          'INVALID_STATE_FOR_OVERWRITE',
          409,
        );
      await MonteOreSchedule.destroy({ where: { proposalId: proposal.id }, transaction: t });
      await proposal.update(
        { ...importFields, rejectedAt: null, rejectionReason: null },
        { transaction: t },
      );
    }
    // roomId=null: l'admin assegnerà l'aula prima di approvare la proposta.
    const payloads = schedules.map((s) => ({
      proposalId: proposal.id,
      roomId: null,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      bookingType: s.bookingType || 'lezione',
      purpose: purpose || null,
      notes: s.notes || null,
      excludeDates: [],
    }));
    if (payloads.length > 0)
      await MonteOreSchedule.bulkCreate(payloads, { transaction: t, validate: true });
    await slotService.regenerateSlotsFromPattern(proposal.id, {
      transaction: t,
      confirmRemoval: true,
    });
    await MonteOreSlot.update(
      { isActive: true },
      { where: { proposalId: proposal.id, isLocked: false }, transaction: t, validate: false },
    );
    await slotService.recomputeTotals(proposal.id, { transaction: t });
    const plan = await loadPlan(proposal.id, t);
    const rule = await resolveAnnualThreshold(teacher.id, academicYear, { transaction: t });
    const validated =
      rule.mode === 'exact' || rule.mode === 'maximum'
        ? await validatePlan(plan, expandRooms(plan, plan.slots), {
            transaction: t,
            snapshot: false,
          })
        : { rule, totalMinutes: activeMinutes(plan.slots) };
    await proposal.update(submissionFields(plan, validated), { transaction: t });
    return MonteOreProposal.findByPk(proposal.id, {
      include: [{ model: MonteOreSchedule, as: 'schedules' }],
      transaction: t,
    });
  });
}

/** submitted → rejected (admin). */
async function rejectPlan(id, actor, reason) {
  return transact(async (transaction) => {
    const proposal = await lockProposal(id, transaction);
    if (proposal.status !== STATUS.SUBMITTED)
      fail('Solo submitted può essere rifiutata', 'INVALID_STATE');
    await proposal.update(
      {
        status: STATUS.REJECTED,
        rejectedAt: new Date(),
        approverId: actor.id,
        rejectionReason: reason ? String(reason).slice(0, 1024) : null,
      },
      { transaction },
    );
    return proposal;
  });
}

/** submitted|approved → draft (admin); generated richiede prima unlockPlan. */
async function revertToDraft(id, reason) {
  return transact(async (transaction) => {
    const proposal = await lockProposal(id, transaction);
    if (!rules.isRevertible(proposal.status)) {
      if (proposal.status === STATUS.GENERATED)
        fail(
          'Esegui prima "Annulla generazione" per riportare la proposta in draft',
          'INVALID_STATE',
        );
      fail('Solo submitted o approved possono tornare in draft', 'INVALID_STATE');
    }
    await proposal.update(
      {
        status: STATUS.DRAFT,
        submittedAt: null,
        approvedAt: null,
        rejectedAt: null,
        approverId: null,
        rejectionReason: null,
        coordinatorNotes: null,
        requiresRevalidation: true,
        revalidationReason: reason
          ? String(reason).trim().slice(0, 500)
          : "Richiesta modifica dall'amministrazione",
      },
      { transaction },
    );
    return proposal;
  });
}

/** generated → approved (admin): cancella le prenotazioni generate in modo atomico. */
async function unlockPlan(id) {
  return transact(async (transaction) => {
    const proposal = await lockProposal(id, transaction);
    if (proposal.status !== STATUS.GENERATED)
      fail('Solo generated può essere unlocked', 'INVALID_STATE');
    const cleared = await generator.releasePlan(id, { transaction });
    await proposal.update(
      { status: STATUS.APPROVED, generatedAt: null, generationSummary: null },
      { transaction },
    );
    return { proposal, cleared };
  });
}

/**
 * Risposta calcolata dal server: stato, pronto all'invio, cosa blocca e cosa
 * possono fare ora docente e admin. `windowOpen` arriva dalla route (la regola
 * di finestra non appartiene a questo modulo).
 */
async function describePlan(plan, { windowOpen = true } = {}) {
  const status = plan.proposal.status;
  const editable = rules.isTeacherEditable(status);
  const blockers = [];
  if (editable) {
    if (!windowOpen)
      blockers.push({
        code: 'OUTSIDE_SUBMISSION_WINDOW',
        message: 'Sei fuori dalla finestra di inserimento del monte ore',
      });
    try {
      await assertSubmittable(plan);
    } catch (e) {
      if (!e.code) throw e;
      blockers.push({
        code: e.code,
        message: e.message,
        ...(e.violations ? { violations: e.violations } : {}),
      });
    }
  }
  return {
    status,
    ready: editable && blockers.length === 0,
    blockers,
    actions: {
      teacher: {
        editPattern: editable,
        selectDates: editable,
        submit: editable && blockers.length === 0,
        requestAmendment: rules.isAmendable(status) && !plan.proposal.requiresRevalidation,
        // Storico variazioni consultabile anche con rivalidazione pendente.
        viewAmendments: rules.isAmendable(status),
      },
      admin: {
        approve: rules.isApprovable(status),
        reject: status === STATUS.SUBMITTED,
        revertToDraft: rules.isRevertible(status),
        unlock: status === STATUS.GENERATED,
        editSchedules: status !== STATUS.GENERATED,
        reviewAmendments: rules.isAmendable(status),
        revalidate: status === STATUS.GENERATED && Boolean(plan.proposal.requiresRevalidation),
      },
    },
  };
}

module.exports = {
  STATUS,
  transact,
  loadPlan,
  minuteOf,
  minutes,
  activeMinutes,
  checkHours,
  validatePlan,
  expandRooms,
  preview,
  approvePlan,
  requestAmendment,
  decideAmendment,
  findOwnEditableProposal,
  reopenIfRejected,
  assertSubmittable,
  submitPlan,
  importPlanAsSubmitted,
  rejectPlan,
  revertToDraft,
  unlockPlan,
  describePlan,
  amendmentOperations,
  applyOperations,
  fail,
};
