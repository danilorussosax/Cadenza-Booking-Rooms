'use strict';

const { MonteOreProposal, MonteOreAmendment, Booking, MailOutbox, User } = require('../models');
const workflow = require('./monteOreWorkflowService');
const { render } = require('./templateRenderer');

// Evaluate a calendar mutation in its own transaction. A preview is rolled back.
async function updateCalendar(year, actor, confirmed, mutate) {
  return workflow.transact(async (transaction) => {
    const proposals = await MonteOreProposal.findAll({
      where: { academicYear: year },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const result = await mutate(transaction);
    const impacted = [];
    for (const proposal of proposals) {
      const plan = await workflow.loadPlan(proposal.id, transaction);
      const isBlocked = (slot) =>
        slot.date < proposal.validFrom ||
        slot.date > proposal.validTo ||
        (plan.settings &&
          (slot.date < plan.settings.lessonsStartDate ||
            slot.date > plan.settings.lessonsEndDate)) ||
        plan.suspensions.some((s) => slot.date >= s.dateFrom && slot.date <= s.dateTo);
      const affected = plan.slots.filter((slot) => slot.isActive && isBlocked(slot));
      // Reopening dates only unlocks them; cancelled lessons stay inactive.
      for (const slot of plan.slots.filter((s) => !s.isActive)) {
        const locked = Boolean(isBlocked(slot));
        if (locked !== slot.isLocked)
          await slot.update(
            { isLocked: locked, lockReason: locked ? 'Calendario aggiornato dal revisore' : null },
            { transaction },
          );
      }
      if (affected.length) impacted.push({ proposal, affected });
    }
    if (impacted.length && !confirmed) {
      workflow.fail(
        `La modifica coinvolge ${impacted.length} piani e ${impacted.reduce((n, i) => n + i.affected.length, 0)} lezioni: ${impacted.map((i) => `docente #${i.proposal.userId}: ${i.affected.map((s) => s.date).join(', ')}`).join('; ')}. Conferma per sospendere le lezioni interessate e richiedere la rivalidazione.`,
        'CALENDAR_IMPACT_CONFIRMATION',
        409,
      );
    }
    for (const { proposal, affected } of impacted) {
      const beforeSnapshot = affected.map((slot) => slot.toJSON());
      for (const slot of affected) {
        if (slot.bookingId) {
          const booking = await Booking.findByPk(slot.bookingId, { transaction });
          if (booking && (booking.checkedInAt || new Date(booking.startTime) < new Date()))
            workflow.fail(
              `La modifica coinvolge una lezione già trascorsa (${slot.date}); limita il blocco alle date future`,
              'PAST_SLOT',
            );
          if (booking?.status === 'confirmed')
            await booking.update(
              {
                status: 'cancelled',
                cancelledAt: new Date(),
                cancelReason: 'Sospensione didattica amministrativa',
              },
              { transaction },
            );
        }
        await slot.update(
          {
            isActive: false,
            isLocked: true,
            lockReason: 'Calendario aggiornato dal revisore',
            bookingId: null,
          },
          { transaction },
        );
      }
      const total = await require('./monteOreSlotService').recomputeTotals(proposal.id, {
        transaction,
      });
      await proposal.update(
        {
          requiresRevalidation: true,
          revalidationReason: 'Calendario didattico aggiornato: rivedere le date sospese.',
          revision: proposal.revision + 1,
          totalHoursRequested: total,
        },
        { transaction },
      );
      const operations = affected.map((s) => ({ kind: 'toggle_off', slotId: s.id, payload: {} }));
      const amendment = await MonteOreAmendment.create(
        {
          proposalId: proposal.id,
          requesterId: actor.id,
          kind: 'toggle_off',
          slotId: affected[0].id,
          payload: {},
          operations,
          finalOperations: operations,
          beforeSnapshot,
          afterSnapshot: affected.map((slot) => slot.toJSON()),
          status: 'approved',
          decidedBy: actor.id,
          decidedAt: new Date(),
          decisionNotes: 'Sospensione didattica amministrativa; non consuma richieste docente.',
        },
        { transaction },
      );
      const user = await User.findByPk(proposal.userId, { transaction });
      await MailOutbox.create(
        {
          kind: 'monte_ore_calendar',
          to: user.email,
          subject: `Monte ore ${year}: calendario aggiornato`,
          bodyHtml: render(
            '<p>Gentile {{name}}, il revisore ha sospeso queste lezioni: {{dates}}.</p><p>Il piano deve essere rivalidato. La modifica non consuma il limite delle tue richieste.</p>',
            {
              name: user.firstName,
              dates: affected.map((s) => `${s.date} ${s.startTime}–${s.endTime}`).join(', '),
            },
          ),
          priority: 4,
          idempotencyKey: `monte-ore:${amendment.id}:calendar`,
        },
        { transaction },
      );
    }
    return result;
  });
}

module.exports = { updateCalendar };
