'use strict';

const { ContractType, MonteOreProposal } = require('../models');
const { fail } = require('./monteOreWorkflowService');

async function contractFields(body, user = null, transaction) {
  const code =
    body.contractType === undefined ? (user?.contractType ?? null) : body.contractType || null;
  const hours =
    body.monteOreAnnualHoursOverride === undefined
      ? (user?.monteOreAnnualHoursOverride ?? null)
      : body.monteOreAnnualHoursOverride === null || body.monteOreAnnualHoursOverride === ''
        ? null
        : Number(body.monteOreAnnualHoursOverride);
  const type = code && (await ContractType.findOne({ where: { code }, transaction }));
  if (
    code &&
    !type &&
    ![
      'titolare',
      'tempo_definito',
      'collaborazione',
      'contratto_orario',
      'supplente',
      'altro',
    ].includes(code)
  )
    fail('Contratto non trovato', 'INVALID_CONTRACT_TYPE');
  if ((code === 'collaborazione' || type?.requiresIndividualHours) && !(hours > 0))
    fail('Definisci le ore annuali della collaborazione', 'CONTRACT_HOURS_REQUIRED');
  if (
    hours != null &&
    (!Number.isFinite(hours) ||
      hours <= 0 ||
      hours > 1500 ||
      Math.abs(hours * 60 - Math.round(hours * 60)) > 0.00001)
  )
    fail('Ore contrattuali non valide', 'INVALID_HOURS');
  if (code === 'tempo_definito' && hours != null && hours > 162)
    fail('Tempo definito: massimo 162 ore', 'HOURS_ABOVE_LIMIT');
  if (code === 'titolare' && hours != null && hours !== 324)
    fail('Cattedra intera: 324 ore', 'HOURS_NOT_MATCHING_CONTRACT');
  return {
    contractType: code,
    monteOreAnnualHoursOverride: hours,
    monteOreBypassDayConstraint:
      body.monteOreBypassDayConstraint === undefined
        ? !!user?.monteOreBypassDayConstraint
        : !!body.monteOreBypassDayConstraint,
    monteOreOverrideReason:
      body.monteOreOverrideReason === undefined
        ? (user?.monteOreOverrideReason ?? null)
        : body.monteOreOverrideReason || null,
  };
}

async function flagChangedPlans(user, fields, transaction) {
  if (
    user.contractType === fields.contractType &&
    user.monteOreAnnualHoursOverride === fields.monteOreAnnualHoursOverride &&
    user.monteOreBypassDayConstraint === fields.monteOreBypassDayConstraint
  )
    return;
  await MonteOreProposal.update(
    {
      requiresRevalidation: true,
      revalidationReason:
        'Il contratto del docente è cambiato: il revisore deve rivalidare il piano.',
    },
    { where: { userId: user.id, status: ['submitted', 'approved', 'generated'] }, transaction },
  );
}

module.exports = { contractFields, flagChangedPlans };
