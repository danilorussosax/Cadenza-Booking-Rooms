'use strict';

/**
 * Integrazione: services/monteOreSlotService — rigenerazione slot dal pattern,
 * totali ore, toggle e snapshot.
 *
 * Calendario di prova: lezioni dal 2027-11-01 al 2027-11-30, schedule il lunedì
 * 09:00–10:00 → lunedì 1, 8, 15, 22, 29 novembre. Il 15 è sospeso (partial).
 */

const {
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSettings,
  MonteOreSlot,
  MonteOreSuspension,
} = require('../../models');
const { createUser, createRoom } = require('../factories');
const svc = require('../../services/monteOreSlotService');

const YEAR = '2027/2028';

describe('monteOreSlotService', () => {
  let proposal;

  beforeEach(async () => {
    await globalThis.resetDatabase();
    const room = await createRoom();
    const instituteId = (await room.getBuilding()).instituteId;
    await MonteOreSettings.create({
      instituteId,
      academicYear: YEAR,
      academicYearStart: '2027-11-01',
      academicYearEnd: '2028-10-31',
      lessonsStartDate: '2027-11-01',
      lessonsEndDate: '2027-11-30',
      submissionWindowStart: '2026-01-01',
      submissionWindowEnd: '2028-10-31',
      maxAmendmentsPerYear: 3,
    });
    await MonteOreSuspension.create({
      instituteId,
      academicYear: YEAR,
      name: 'Sessione',
      category: 'exam_session',
      kind: 'partial',
      dateFrom: '2027-11-15',
      dateTo: '2027-11-15',
    });
    const teacher = await createUser({ role: 'docente' });
    proposal = await MonteOreProposal.create({
      userId: teacher.id,
      academicYear: YEAR,
      validFrom: '2027-11-01',
      validTo: '2027-11-30',
      status: 'draft',
    });
    await MonteOreSchedule.create({
      proposalId: proposal.id,
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '10:00',
      roomId: room.id,
      bookingType: 'lezione',
    });
  });

  const slotOn = (date) => MonteOreSlot.findOne({ where: { proposalId: proposal.id, date } });
  const totalHours = async () => Number((await proposal.reload()).totalHoursPlanned);

  describe('regenerateSlotsFromPattern', () => {
    it('crea uno slot per ogni lunedì e blocca quello sospeso', async () => {
      const res = await svc.regenerateSlotsFromPattern(proposal.id);
      expect(res).toEqual({ created: 4, locked: 1, total: 5 });
      const locked = await slotOn('2027-11-15');
      expect(locked).toMatchObject({ isLocked: true, isActive: false });
      expect(locked.lockReason).toBe('Sessione');
      expect((await slotOn('2027-11-08')).isLocked).toBe(false);
      expect(await totalHours()).toBe(0);
    });

    it('è idempotente e conserva gli slot già attivati', async () => {
      await svc.regenerateSlotsFromPattern(proposal.id);
      await (await slotOn('2027-11-08')).update({ isActive: true });
      const res = await svc.regenerateSlotsFromPattern(proposal.id);
      expect(res.total).toBe(5);
      expect(await MonteOreSlot.count({ where: { proposalId: proposal.id } })).toBe(5);
      expect((await slotOn('2027-11-08')).isActive).toBe(true);
      expect(await totalHours()).toBe(1);
    });

    it('rispetta validFrom/validTo e rimuove gli slot inattivi fuori range', async () => {
      await svc.regenerateSlotsFromPattern(proposal.id);
      await proposal.update({ validTo: '2027-11-15' });
      const res = await svc.regenerateSlotsFromPattern(proposal.id);
      expect(res).toEqual({ created: 2, locked: 1, total: 3 });
      expect(await slotOn('2027-11-22')).toBeNull();
      expect(await slotOn('2027-11-29')).toBeNull();
    });

    it('chiede conferma se rimuoverebbe slot attivi e non tocca nulla', async () => {
      await svc.regenerateSlotsFromPattern(proposal.id);
      await (await slotOn('2027-11-22')).update({ isActive: true });
      await proposal.update({ validTo: '2027-11-15' });
      const res = await svc.regenerateSlotsFromPattern(proposal.id);
      expect(res).toMatchObject({ requiresConfirmation: true, created: 0, total: 5 });
      expect(res.removedActive).toEqual([
        { date: '2027-11-22', startTime: '09:00', endTime: '10:00' },
      ]);
      expect(await MonteOreSlot.count({ where: { proposalId: proposal.id } })).toBe(5);
    });

    it('con confirmRemoval rimuove gli slot attivi fuori range e ricalcola le ore', async () => {
      await svc.regenerateSlotsFromPattern(proposal.id);
      await (await slotOn('2027-11-22')).update({ isActive: true });
      await (await slotOn('2027-11-08')).update({ isActive: true });
      await svc.recomputeTotals(proposal.id);
      await proposal.update({ validTo: '2027-11-15' });
      await svc.regenerateSlotsFromPattern(proposal.id, { confirmRemoval: true });
      expect(await slotOn('2027-11-22')).toBeNull();
      expect(await totalHours()).toBe(1);
    });

    it('errori chiari per proposta o settings mancanti', async () => {
      await expect(svc.regenerateSlotsFromPattern(999999)).rejects.toThrow('Proposta non trovata');
      await proposal.update({ academicYear: '2040/2041' });
      await expect(svc.regenerateSlotsFromPattern(proposal.id)).rejects.toThrow(
        /Settings monte ore mancanti per AA 2040\/2041/,
      );
    });
  });

  describe('recomputeTotals / toggleSlot', () => {
    beforeEach(async () => {
      await svc.regenerateSlotsFromPattern(proposal.id);
    });

    it('somma solo gli slot attivi e non bloccati, con precisione al minuto', async () => {
      await (await slotOn('2027-11-01')).update({ isActive: true });
      await (await slotOn('2027-11-08')).update({ isActive: true, endTime: '10:30' });
      await (await slotOn('2027-11-15')).update({ isActive: true }); // bloccato: ignorato
      expect(await svc.recomputeTotals(proposal.id)).toBe(2.5);
      expect(await totalHours()).toBe(2.5);
    });

    it('toggleSlot inverte lo stato e aggiorna il totale', async () => {
      const slot = await slotOn('2027-11-01');
      await svc.toggleSlot(slot.id);
      expect(await totalHours()).toBe(1);
      await svc.toggleSlot(slot.id);
      expect(await totalHours()).toBe(0);
    });

    it('toggleSlot rifiuta gli slot bloccati salvo force', async () => {
      const locked = await slotOn('2027-11-15');
      await expect(svc.toggleSlot(locked.id)).rejects.toMatchObject({ code: 'SLOT_LOCKED' });
      await svc.toggleSlot(locked.id, { force: true });
      expect((await locked.reload()).isActive).toBe(true);
      expect(await totalHours()).toBe(0); // bloccato: non conta comunque
    });

    it('toggleSlot su slot inesistente → errore', async () => {
      await expect(svc.toggleSlot(999999)).rejects.toThrow('Slot non trovato');
    });
  });

  it('snapshotOriginalActive copia isActive in originalActive su tutti gli slot', async () => {
    await svc.regenerateSlotsFromPattern(proposal.id);
    await (await slotOn('2027-11-01')).update({ isActive: true });
    await svc.snapshotOriginalActive(proposal.id);
    expect((await slotOn('2027-11-01')).originalActive).toBe(true);
    expect((await slotOn('2027-11-08')).originalActive).toBe(false);
  });

  it('classifyAmendment: ogni variazione richiede decisione', () => {
    expect(svc.classifyAmendment()).toBe('pending');
  });
});
