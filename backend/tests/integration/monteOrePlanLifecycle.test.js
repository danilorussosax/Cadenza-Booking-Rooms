'use strict';

const {
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSlot,
  MonteOreSettings,
} = require('../../models');
const { createAuthedUser, createAdmin, createRoom } = require('../factories');
const workflow = require('../../services/monteOreWorkflowService');
const rules = require('../../services/monteOrePlanRules');

const STATES = ['draft', 'submitted', 'approved', 'generated', 'rejected'];

describe('Monte Ore — ciclo di vita del piano (stato x azione x attore)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function setup(status) {
    const teacher = await createAuthedUser({
      role: 'docente',
      contractType: 'collaborazione',
      monteOreAnnualHoursOverride: 2,
      monteOreBypassDayConstraint: true,
    });
    const admin = await createAdmin();
    const room = await createRoom();
    const instituteId = (await room.getBuilding()).instituteId;
    await MonteOreSettings.create({
      instituteId,
      academicYear: '2027/2028',
      academicYearStart: '2027-11-01',
      academicYearEnd: '2028-10-31',
      lessonsStartDate: '2027-11-01',
      lessonsEndDate: '2028-06-30',
      submissionWindowStart: '2026-01-01',
      submissionWindowEnd: '2028-10-31',
    });
    const proposal = await MonteOreProposal.create({
      userId: teacher.user.id,
      academicYear: '2027/2028',
      validFrom: '2027-11-01',
      validTo: '2028-06-30',
      status,
      requiresRevalidation: true,
    });
    const schedule = await MonteOreSchedule.create({
      proposalId: proposal.id,
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '10:00',
      roomId: room.id,
      bookingType: 'lezione',
    });
    await MonteOreSlot.bulkCreate(
      ['2027-11-01', '2027-11-08'].map((date) => ({
        proposalId: proposal.id,
        scheduleId: schedule.id,
        date,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00',
        isActive: true,
        isLocked: false,
      })),
    );
    return { teacher, admin, proposal };
  }

  const expectInvalid = (promise) =>
    expect(promise).rejects.toMatchObject({ code: 'INVALID_STATE', status: 400 });

  describe.each(STATES)('stato %s', (status) => {
    it('invio docente: ammesso solo da draft/rejected', async () => {
      const { teacher } = await setup(status);
      const run = workflow.submitPlan(teacher.user.id, '2027/2028');
      if (rules.isTeacherEditable(status)) {
        const proposal = await run;
        expect(proposal.status).toBe('submitted');
        expect(proposal.requiresRevalidation).toBe(false);
        expect(proposal.workingDaysCount).toBeNull(); // bypass vincolo giorni
        expect(proposal.totalHoursPlanned).toBe(2);
        expect(proposal.contractSnapshot).toMatchObject({ minHours: 2 });
      } else await expectInvalid(run);
    });

    it('respingi (admin): ammesso solo da submitted', async () => {
      const { admin, proposal } = await setup(status);
      const run = workflow.rejectPlan(proposal.id, admin.user, 'Motivo');
      if (status === 'submitted') {
        const updated = await run;
        expect(updated).toMatchObject({ status: 'rejected', rejectionReason: 'Motivo' });
        expect(updated.approverId).toBe(admin.user.id);
      } else await expectInvalid(run);
    });

    it('riporta in bozza (admin): ammesso da submitted/approved', async () => {
      const { proposal } = await setup(status);
      const run = workflow.revertToDraft(proposal.id, '  Rivedi le fasce ');
      if (['submitted', 'approved'].includes(status)) {
        const updated = await run;
        expect(updated).toMatchObject({
          status: 'draft',
          requiresRevalidation: true,
          revalidationReason: 'Rivedi le fasce',
          submittedAt: null,
        });
      } else await expectInvalid(run);
    });

    it('sblocca (admin): ammesso solo da generated', async () => {
      const { proposal } = await setup(status);
      const run = workflow.unlockPlan(proposal.id);
      if (status === 'generated') {
        const { proposal: updated } = await run;
        expect(updated.status).toBe('approved');
        expect(updated.generatedAt).toBeNull();
      } else await expectInvalid(run);
    });

    it('riapri: rejected diventa draft, gli altri stati restano invariati', async () => {
      const { proposal } = await setup(status);
      await workflow.reopenIfRejected(proposal);
      expect(proposal.status).toBe(status === 'rejected' ? 'draft' : status);
    });

    it('describePlan riflette la tabella degli stati', async () => {
      const { proposal } = await setup(status);
      const plan = await workflow.loadPlan(proposal.id);
      const described = await workflow.describePlan(plan);
      const editable = rules.isTeacherEditable(status);
      expect(described.status).toBe(status);
      expect(described.ready).toBe(editable);
      expect(described.blockers).toEqual([]);
      expect(described.actions.teacher).toEqual({
        editPattern: editable,
        selectDates: editable,
        submit: editable,
        requestAmendment: false, // requiresRevalidation = true
        viewAmendments: ['approved', 'generated'].includes(status),
      });
      expect(described.actions.admin).toEqual({
        approve: ['submitted', 'approved'].includes(status),
        reject: status === 'submitted',
        revertToDraft: ['submitted', 'approved'].includes(status),
        unlock: status === 'generated',
        editSchedules: status !== 'generated',
        reviewAmendments: ['approved', 'generated'].includes(status),
        revalidate: status === 'generated', // requiresRevalidation = true
      });
    });
  });

  describe.each(STATES)('azioni di variazione in stato %s', (status) => {
    it.each([false, true])('requiresRevalidation=%s', async (requiresRevalidation) => {
      const { proposal } = await setup(status);
      await proposal.update({ requiresRevalidation });
      const { actions } = await workflow.describePlan(await workflow.loadPlan(proposal.id));
      const amendable = ['approved', 'generated'].includes(status);
      expect(actions.teacher.requestAmendment).toBe(amendable && !requiresRevalidation);
      expect(actions.teacher.viewAmendments).toBe(amendable);
      expect(actions.admin.reviewAmendments).toBe(amendable);
      expect(actions.admin.revalidate).toBe(status === 'generated' && requiresRevalidation);
    });
  });

  it('proposta inesistente: NOT_FOUND 404 per le transizioni admin', async () => {
    const { admin } = await setup('submitted');
    await expect(workflow.rejectPlan(99999, admin.user)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await expect(workflow.unlockPlan(99999)).rejects.toMatchObject({ status: 404 });
  });

  it('describePlan espone i blocchi: pattern vuoto, griglia obsoleta e finestra chiusa', async () => {
    const { proposal } = await setup('draft');
    await MonteOreSchedule.update({ startTime: '10:00', endTime: '11:00' }, { where: {} });
    const stale = await workflow.describePlan(await workflow.loadPlan(proposal.id), {
      windowOpen: false,
    });
    expect(stale.ready).toBe(false);
    expect(stale.actions.teacher.submit).toBe(false);
    expect(stale.blockers.map((b) => b.code)).toEqual(['OUTSIDE_SUBMISSION_WINDOW', 'STALE_GRID']);
    await MonteOreSchedule.destroy({ where: {} });
    const empty = await workflow.describePlan(await workflow.loadPlan(proposal.id));
    expect(empty.blockers.map((b) => b.code)).toEqual(['EMPTY_PATTERN']);
  });

  it('regole pure: minuti attivi e decoder della forma legacy', () => {
    const slots = [
      { isActive: true, isLocked: false, startTime: '09:00', endTime: '10:30' },
      { isActive: false, isLocked: false, startTime: '09:00', endTime: '10:00' },
      { isActive: true, isLocked: true, startTime: '09:00', endTime: '10:00' },
    ];
    expect(rules.activeMinutes(slots)).toBe(90);
    expect(workflow.minutes).toBe(rules.activeMinutes);
    expect(rules.amendmentOperations({ operations: [{ kind: 'toggle_on', slotId: 1 }] })).toEqual([
      { kind: 'toggle_on', slotId: 1 },
    ]);
    expect(
      rules.amendmentOperations({ operations: null, kind: 'toggle_off', slotId: 2, payload: {} }),
    ).toEqual([{ kind: 'toggle_off', slotId: 2, payload: {} }]);
  });
});
