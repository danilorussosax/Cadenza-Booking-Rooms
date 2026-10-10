'use strict';

/**
 * Risoluzione della soglia di monte ore applicabile a un docente.
 *
 * Cascata 4 livelli (priorità decrescente):
 *   1. user.monteOreAnnualHoursOverride (se non null)        → 'user_override'
 *   2. ContractType.defaultHours per user.contractType       → 'contract_type_default'
 *   3. settings.minRequiredHours per l'AA                    → 'institute_settings'
 *   4. fallback storico CCNL (324)                           → 'default'
 *
 * Stesso pattern per `bypassDayConstraint`:
 *   1. user.monteOreBypassDayConstraint (esplicito true/false)
 *   2. ContractType.bypassDayConstraintDefault
 *   3. false
 *
 * Restituisce anche `contractType` (code) e `contractTypeLabel` per la UI.
 */

const { MonteOreSettings, User, ContractType } = require('../models');

const DEFAULT_MIN_HOURS = 324;

async function resolveAnnualThreshold(userId, academicYear, { transaction } = {}) {
  const user = await User.findByPk(userId, {
    transaction,
    attributes: [
      'id',
      'role',
      'contractType',
      'monteOreAnnualHoursOverride',
      'monteOreBypassDayConstraint',
      'monteOreOverrideReason',
      'monteOreOverrideSetAt',
      'monteOreOverrideSetBy',
    ],
  });
  if (!user) {
    const e = new Error('Utente non trovato');
    e.status = 404;
    throw e;
  }

  // Carico il record ContractType per code (se esiste e attivo): serve sia
  // per il default ore sia per il bypass day-constraint sia per la label UI.
  let contractTypeRow = null;
  if (user.contractType) {
    contractTypeRow = await ContractType.findOne({
      where: { code: user.contractType },
      transaction,
      attributes: [
        'id',
        'code',
        'label',
        'defaultHours',
        'bypassDayConstraintDefault',
        'isActive',
        'hoursMode',
        'requiresIndividualHours',
      ],
    });
  }

  // Bypass day-constraint: l'utente con override esplicito vince. La colonna
  // è BOOLEAN NOT NULL DEFAULT false, quindi non riesco a distinguere
  // "default" da "esplicitamente false". Convenzione: se il tipo contratto
  // dichiara `bypassDayConstraintDefault=true`, lo onoriamo a meno che
  // l'utente non abbia un override individuale (esplicito).
  // Per ora: user true → true; user false + tipo true → tipo wins.
  const userBypassExplicit = !!user.monteOreBypassDayConstraint;
  const typeBypass = !!contractTypeRow?.bypassDayConstraintDefault;
  const bypassDayConstraint = userBypassExplicit || typeBypass;

  const mode =
    user.contractType === 'titolare' || user.contractType === 'collaborazione'
      ? 'exact'
      : user.contractType === 'tempo_definito'
        ? 'maximum'
        : contractTypeRow?.hoursMode || 'minimum';
  if (
    (user.contractType === 'collaborazione' || contractTypeRow?.requiresIndividualHours) &&
    !(Number(user.monteOreAnnualHoursOverride) > 0)
  ) {
    const e = new Error(
      'Definisci le ore annuali del contratto di collaborazione nell’utenza docente',
    );
    e.status = 400;
    e.code = 'CONTRACT_HOURS_REQUIRED';
    throw e;
  }

  // 1) User override esplicito sulle ore
  if (user.monteOreAnnualHoursOverride != null) {
    return {
      mode,
      minHours:
        user.contractType === 'titolare'
          ? 324
          : user.contractType === 'tempo_definito'
            ? Math.min(162, Number(user.monteOreAnnualHoursOverride))
            : Number(user.monteOreAnnualHoursOverride),
      bypassDayConstraint,
      contractType: user.contractType || null,
      contractTypeLabel: contractTypeRow?.label || null,
      reason: user.monteOreOverrideReason || null,
      source: 'user_override',
    };
  }

  // 2) Default del tipo contratto (se valorizzato)
  if (contractTypeRow && contractTypeRow.defaultHours != null) {
    return {
      mode,
      minHours:
        user.contractType === 'titolare'
          ? 324
          : user.contractType === 'tempo_definito'
            ? 162
            : Number(contractTypeRow.defaultHours),
      bypassDayConstraint,
      contractType: user.contractType || null,
      contractTypeLabel: contractTypeRow.label,
      reason: user.monteOreOverrideReason || null,
      source: 'contract_type_default',
    };
  }

  // 3) Settings istituzionali per AA
  const settings = await MonteOreSettings.findOne({ where: { academicYear }, transaction });
  return {
    mode,
    minHours:
      user.contractType === 'tempo_definito'
        ? 162
        : user.contractType === 'titolare'
          ? 324
          : (settings?.minRequiredHours ?? DEFAULT_MIN_HOURS),
    bypassDayConstraint,
    contractType: user.contractType || null,
    contractTypeLabel: contractTypeRow?.label || null,
    reason: user.monteOreOverrideReason || null,
    source: settings ? 'institute_settings' : 'default',
  };
}

module.exports = { resolveAnnualThreshold, DEFAULT_MIN_HOURS };
