'use strict';

/**
 * Integrazione: services/monteOreThresholdService.resolveAnnualThreshold.
 *
 * Cascata: override utente → default tipo contratto → settings AA → 324,
 * con le eccezioni per titolare (324 esatto), tempo_definito (162 massimo)
 * e collaborazione (ore individuali obbligatorie).
 */

const { Institute, MonteOreSettings, ContractType } = require('../../models');
const { createUser } = require('../factories');
const {
  resolveAnnualThreshold,
  DEFAULT_MIN_HOURS,
} = require('../../services/monteOreThresholdService');

const YEAR = '2025/2026';

describe('resolveAnnualThreshold', () => {
  let institute;
  beforeEach(async () => {
    await globalThis.resetDatabase();
    institute = await Institute.create({ name: 'Test Inst', code: 'TI', city: 'X', country: 'IT' });
  });

  const teacher = (overrides = {}) => createUser({ role: 'docente', ...overrides });
  const settings = (minRequiredHours) =>
    MonteOreSettings.create({
      instituteId: institute.id,
      academicYear: YEAR,
      academicYearStart: '2025-11-01',
      academicYearEnd: '2026-10-31',
      lessonsStartDate: '2025-11-03',
      lessonsEndDate: '2026-06-26',
      submissionWindowStart: '2025-09-01',
      submissionWindowEnd: '2030-12-31',
      minRequiredHours,
      maxAmendmentsPerYear: 3,
    });
  const contractType = (over) =>
    ContractType.create({ instituteId: institute.id, hoursMode: 'minimum', ...over });

  it('utente inesistente → 404', async () => {
    await expect(resolveAnnualThreshold(999999, YEAR)).rejects.toMatchObject({ status: 404 });
  });

  it('senza settings né tipo contratto → fallback CCNL 324', async () => {
    const u = await teacher();
    expect(await resolveAnnualThreshold(u.id, YEAR)).toMatchObject({
      minHours: DEFAULT_MIN_HOURS,
      mode: 'minimum',
      source: 'default',
      bypassDayConstraint: false,
    });
  });

  it('usa minRequiredHours dei settings AA quando presenti', async () => {
    await settings(300);
    const u = await teacher();
    expect(await resolveAnnualThreshold(u.id, YEAR)).toMatchObject({
      minHours: 300,
      source: 'institute_settings',
    });
  });

  it('il default del tipo contratto vince sui settings', async () => {
    await settings(300);
    await contractType({ code: 'orario', label: 'Orario', defaultHours: 120 });
    const u = await teacher({ contractType: 'orario' });
    expect(await resolveAnnualThreshold(u.id, YEAR)).toMatchObject({
      minHours: 120,
      source: 'contract_type_default',
      contractType: 'orario',
      contractTypeLabel: 'Orario',
    });
  });

  it("l'override individuale vince su tutto e riporta il motivo", async () => {
    await settings(300);
    await contractType({ code: 'orario', label: 'Orario', defaultHours: 120 });
    const u = await teacher({
      contractType: 'orario',
      monteOreAnnualHoursOverride: 60,
      monteOreOverrideReason: 'Contratto ridotto',
    });
    expect(await resolveAnnualThreshold(u.id, YEAR)).toMatchObject({
      minHours: 60,
      source: 'user_override',
      reason: 'Contratto ridotto',
    });
  });

  it('titolare: 324 esatto anche con override o settings diversi', async () => {
    await settings(100);
    const plain = await teacher({ contractType: 'titolare' });
    expect(await resolveAnnualThreshold(plain.id, YEAR)).toMatchObject({
      mode: 'exact',
      minHours: 324,
    });
    const overridden = await teacher({ contractType: 'titolare', monteOreAnnualHoursOverride: 50 });
    expect(await resolveAnnualThreshold(overridden.id, YEAR)).toMatchObject({
      mode: 'exact',
      minHours: 324,
    });
  });

  it('tempo_definito: massimo 162, con override limitato a 162', async () => {
    const plain = await teacher({ contractType: 'tempo_definito' });
    expect(await resolveAnnualThreshold(plain.id, YEAR)).toMatchObject({
      mode: 'maximum',
      minHours: 162,
    });
    const high = await teacher({
      contractType: 'tempo_definito',
      monteOreAnnualHoursOverride: 400,
    });
    expect((await resolveAnnualThreshold(high.id, YEAR)).minHours).toBe(162);
    const low = await teacher({ contractType: 'tempo_definito', monteOreAnnualHoursOverride: 100 });
    expect((await resolveAnnualThreshold(low.id, YEAR)).minHours).toBe(100);
  });

  it('collaborazione senza ore individuali → 400 CONTRACT_HOURS_REQUIRED', async () => {
    const u = await teacher({ contractType: 'collaborazione' });
    await expect(resolveAnnualThreshold(u.id, YEAR)).rejects.toMatchObject({
      status: 400,
      code: 'CONTRACT_HOURS_REQUIRED',
    });
  });

  it('collaborazione con ore individuali → modalità exact con quelle ore', async () => {
    const u = await teacher({ contractType: 'collaborazione', monteOreAnnualHoursOverride: 60 });
    expect(await resolveAnnualThreshold(u.id, YEAR)).toMatchObject({ mode: 'exact', minHours: 60 });
  });

  it('tipo che richiede ore individuali senza override → 400', async () => {
    await contractType({ code: 'borsa', label: 'Borsa', requiresIndividualHours: true });
    const u = await teacher({ contractType: 'borsa' });
    await expect(resolveAnnualThreshold(u.id, YEAR)).rejects.toMatchObject({
      code: 'CONTRACT_HOURS_REQUIRED',
    });
  });

  it('bypass vincolo giorni: valore utente oppure default del tipo', async () => {
    await contractType({
      code: 'monoday',
      label: 'Monoday',
      defaultHours: 80,
      bypassDayConstraintDefault: true,
    });
    const byType = await teacher({ contractType: 'monoday' });
    expect((await resolveAnnualThreshold(byType.id, YEAR)).bypassDayConstraint).toBe(true);
    const byUser = await teacher({ monteOreBypassDayConstraint: true });
    expect((await resolveAnnualThreshold(byUser.id, YEAR)).bypassDayConstraint).toBe(true);
  });

  it('hoursMode del tipo contratto viene propagato come modalità', async () => {
    await contractType({ code: 'cap', label: 'Cap', defaultHours: 90, hoursMode: 'maximum' });
    const u = await teacher({ contractType: 'cap' });
    expect(await resolveAnnualThreshold(u.id, YEAR)).toMatchObject({
      mode: 'maximum',
      minHours: 90,
    });
  });
});
