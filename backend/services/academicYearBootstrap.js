'use strict';

/**
 * Bootstrap di un anno accademico: crea (idempotente) i settings e le
 * festività deterministiche per l'AA richiesto.
 *
 * Convenzione AA conservatorio: l'AA "Y/Y+1" inizia il 1° novembre dell'anno
 * Y e finisce il 31 ottobre dell'anno Y+1.
 *
 * Festività generate (mode='default'):
 *   - Immacolata                (8 dic  Y)        — partial
 *   - Vacanze di Natale         (24 dic Y → 6 gen Y+1) — full_week
 *   - Vacanze di Pasqua         (Pasqua-2 → Pasqua+2 di Y+1) — full_week
 *   - Festa della Liberazione   (25 apr Y+1)      — partial
 *   - Festa dei Lavoratori      (1 mag  Y+1)      — partial
 *   - Festa della Repubblica    (2 giu  Y+1)      — partial
 *
 * Tutte queste righe sono `category='holiday'`.
 *
 * In mode='from_previous' si comporta come default per le festività + copia
 * dall'AA precedente le sospensioni `custom` ed `exam_session` traslate
 * in base alla distanza fra gli anni; il calendario è verificabile in anteprima.
 */

const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { sequelize, MonteOreSettings, MonteOreSuspension, Institute } = require('../models');
const {
  computeEaster,
  currentAcademicYear,
  nextAcademicYear,
} = require('./monteOreCalendarService');

const {
  invalid,
  validateYear,
  validateSettings,
  firstMondayFrom,
  defaultSettingsFor,
} = require('./academicYearConfig');

function isoDate(year, month, day) {
  return dayjs(new Date(year, month - 1, day)).format('YYYY-MM-DD');
}

/**
 * Calcola le date di Venerdì Santo (Pasqua-2gg) e martedì dopo Pasqua
 * (Pasqua+2gg) per le "Vacanze di Pasqua" come full_week.
 */
function easterHolidayRange(yearForEaster) {
  const e = computeEaster(yearForEaster);
  const easter = dayjs(new Date(e.year, e.month - 1, e.day));
  return {
    dateFrom: easter.subtract(2, 'day').format('YYYY-MM-DD'),
    dateTo: easter.add(2, 'day').format('YYYY-MM-DD'),
  };
}

/**
 * Lista deterministica delle festività per l'AA `academicYear` ("Y/Y+1").
 * Ogni entry ha `{ name, dateFrom, dateTo, kind, category, notes }`.
 */
function defaultHolidaysFor(academicYear) {
  const [Y0] = academicYear.split('/').map(Number);
  const Y = Y0;
  const Y1 = Y0 + 1;
  const easter = easterHolidayRange(Y1);
  return [
    {
      name: 'Immacolata',
      dateFrom: isoDate(Y, 12, 8),
      dateTo: isoDate(Y, 12, 8),
      kind: 'partial',
    },
    {
      name: 'Vacanze di Natale',
      dateFrom: isoDate(Y, 12, 24),
      dateTo: isoDate(Y1, 1, 6),
      kind: 'full_week',
    },
    {
      name: 'Vacanze di Pasqua',
      dateFrom: easter.dateFrom,
      dateTo: easter.dateTo,
      kind: 'full_week',
    },
    {
      name: 'Festa della Liberazione',
      dateFrom: isoDate(Y1, 4, 25),
      dateTo: isoDate(Y1, 4, 25),
      kind: 'partial',
    },
    {
      name: 'Festa dei Lavoratori',
      dateFrom: isoDate(Y1, 5, 1),
      dateTo: isoDate(Y1, 5, 1),
      kind: 'partial',
    },
    {
      name: 'Festa della Repubblica',
      dateFrom: isoDate(Y1, 6, 2),
      dateTo: isoDate(Y1, 6, 2),
      kind: 'partial',
    },
  ].map((h) => ({ ...h, category: 'holiday', notes: null }));
}

async function resolveInstituteId(instituteId) {
  if (instituteId) return instituteId;
  const inst = await Institute.findOne({ order: [['id', 'ASC']] });
  if (!inst) {
    const e = new Error('Nessun istituto configurato');
    e.status = 400;
    throw e;
  }
  return inst.id;
}

/** Build the exact preview without writes; creation uses the same plan. */
async function previewAcademicYear({
  academicYear,
  instituteId = null,
  mode = 'default',
  previousYear = null,
  copyRules = true,
  copyCalendar = true,
  copyCustom = true,
  copyExamSessions = true,
  settings: overrides = {},
  transaction = null,
} = {}) {
  const targetStart = validateYear(academicYear);
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
    invalid('Impostazioni non valide');
  for (const option of [copyRules, copyCalendar, copyCustom, copyExamSessions]) {
    if (typeof option !== 'boolean') invalid('Le opzioni di copia devono essere booleane');
  }
  if (!['default', 'from_previous'].includes(mode)) invalid('Origine dati non valida');
  const realInstituteId = await resolveInstituteId(instituteId);
  const settings = {
    instituteId: realInstituteId,
    academicYear,
    ...defaultSettingsFor(academicYear),
    status: 'draft',
  };
  const suspensions = defaultHolidaysFor(academicYear);
  const warnings = [];
  if (mode === 'from_previous') {
    const sourceStart = validateYear(previousYear);
    if (sourceStart >= targetStart)
      invalid("Scegli un anno sorgente precedente all'anno da creare");
    const source = await MonteOreSettings.findOne({
      where: { instituteId: realInstituteId, academicYear: previousYear },
      transaction,
    });
    if (!source) invalid('Anno sorgente non trovato');
    const delta = targetStart - sourceStart;
    const shift = (date) => dayjs(date).add(delta, 'year').format('YYYY-MM-DD');
    if (copyRules) {
      for (const field of [
        'minRequiredHours',
        'maxAmendmentsPerYear',
        'maxHoursPerDay',
        'dailyBreakAfterHours',
        'dailyBreakMinutes',
      ])
        settings[field] = source[field];
    }
    if (copyCalendar) {
      for (const field of [
        'lessonsStartDate',
        'lessonsEndDate',
        'submissionWindowStart',
        'submissionWindowEnd',
      ])
        settings[field] = shift(source[field]);
    }
    const categories = [copyCustom && 'custom', copyExamSessions && 'exam_session'].filter(Boolean);
    if (categories.length) {
      const rows = await MonteOreSuspension.findAll({
        where: {
          instituteId: realInstituteId,
          academicYear: previousYear,
          category: { [Op.in]: categories },
        },
        transaction,
      });
      for (const row of rows)
        suspensions.push({
          name: row.name,
          dateFrom: shift(row.dateFrom),
          dateTo: shift(row.dateTo),
          kind: row.kind,
          category: row.category,
          notes: row.notes,
        });
    }
    warnings.push(
      'Le date copiate mantengono giorno e mese, non il giorno della settimana. Il 29 febbraio diventa 28 febbraio negli anni non bisestili. Verifica ponti e sessioni.',
    );
  }
  const allowed = Object.keys(defaultSettingsFor(academicYear));
  for (const field of allowed)
    if (overrides[field] !== undefined) settings[field] = overrides[field];
  validateSettings(settings);
  await MonteOreSettings.build(settings).validate();
  for (const row of suspensions) {
    if (
      row.dateFrom < settings.academicYearStart ||
      row.dateTo > settings.academicYearEnd ||
      row.dateFrom > row.dateTo
    )
      invalid(`Sospensione fuori anno: ${row.name}`);
  }
  const overlaps = [];
  for (let i = 0; i < suspensions.length; i++) {
    for (let j = i + 1; j < suspensions.length; j++) {
      if (
        suspensions[i].dateFrom <= suspensions[j].dateTo &&
        suspensions[j].dateFrom <= suspensions[i].dateTo
      )
        overlaps.push(`${suspensions[i].name} / ${suspensions[j].name}`);
    }
  }
  if (overlaps.length) warnings.push(`Sospensioni sovrapposte: ${overlaps.join(', ')}`);
  const availableDays = [0, 0, 0, 0, 0, 0, 0];
  for (
    let d = dayjs(settings.lessonsStartDate);
    d.format('YYYY-MM-DD') <= settings.lessonsEndDate;
    d = d.add(1, 'day')
  ) {
    const date = d.format('YYYY-MM-DD');
    if (!suspensions.some((s) => date >= s.dateFrom && date <= s.dateTo)) availableDays[d.day()]++;
  }
  return { settings, suspensions, warnings, availableDays };
}

async function bootstrapAcademicYear(options = {}) {
  const run = async (transaction) => {
    validateYear(options.academicYear);
    const instituteId = await resolveInstituteId(options.instituteId);
    // Serialize startup and manual creation across PM2 workers.
    await Institute.findByPk(instituteId, { transaction, lock: transaction.LOCK.UPDATE });
    const existing = await MonteOreSettings.findOne({
      where: { instituteId, academicYear: options.academicYear },
      transaction,
    });
    if (existing && !options.overwrite) {
      return {
        settings: existing.toJSON(),
        suspensionsCreated: 0,
        suspensionsSkipped: await MonteOreSuspension.count({
          where: { instituteId, academicYear: options.academicYear },
          transaction,
        }),
      };
    }
    if (existing?.status === 'archived')
      invalid('Anno archiviato: ripubblicalo prima di modificarlo');
    const plan = await previewAcademicYear({ ...options, instituteId, transaction });
    const { status: _status, ...values } = plan.settings;
    const settings = existing
      ? await existing.update(values, { transaction })
      : await MonteOreSettings.create(
          { ...plan.settings, status: options.publish === true ? 'published' : 'draft' },
          { transaction },
        );
    let suspensionsCreated = 0;
    let suspensionsSkipped = 0;
    const rows = await MonteOreSuspension.findAll({
      where: { instituteId, academicYear: options.academicYear },
      transaction,
    });
    for (const suspension of plan.suspensions) {
      const match = rows.find(
        (s) =>
          s.category === suspension.category &&
          s.name.trim().toLowerCase() === suspension.name.trim().toLowerCase() &&
          (suspension.category === 'holiday' ||
            (s.dateFrom === suspension.dateFrom && s.dateTo === suspension.dateTo)),
      );
      if (match) {
        await match.update(suspension, { transaction });
        suspensionsSkipped++;
      } else {
        rows.push(
          await MonteOreSuspension.create(
            { ...suspension, instituteId, academicYear: options.academicYear },
            { transaction },
          ),
        );
        suspensionsCreated++;
      }
    }
    return { settings: settings.toJSON(), suspensionsCreated, suspensionsSkipped };
  };
  return options.transaction ? run(options.transaction) : sequelize.transaction(run);
}

/**
 * Garantisce che gli AA "attivi" (corrente + prossimo) abbiano `MonteOreSettings`
 * e le festività di default quando ancora mancanti. Gli anni già configurati
 * restano intatti, comprese le festività eliminate o spostate. Per ogni istituto presente nel sistema.
 *
 * Pensato per essere chiamato in `server.js` dopo il seed, così che ogni AA
 * compaia automaticamente con il calendario completo, senza bisogno che
 * l'admin clicchi "Nuovo AA" dal pannello.
 *
 * @param {object} [opts]
 * @param {Date} [opts.today]            data di riferimento (testabilità)
 * @returns {Promise<Array<{instituteId:number, academicYear:string, created:number, skipped:number}>>}
 */
async function ensureBootstrapForActiveYears({ today = new Date() } = {}) {
  const institutes = await Institute.findAll({ attributes: ['id'], order: [['id', 'ASC']] });
  if (!institutes.length) return [];

  const years = [currentAcademicYear(today), nextAcademicYear(today)];
  const results = [];
  for (const inst of institutes) {
    for (const academicYear of years) {
      try {
        const { suspensionsCreated, suspensionsSkipped } = await bootstrapAcademicYear({
          academicYear,
          instituteId: inst.id,
          mode: 'default',
          overwrite: false,
        });
        results.push({
          instituteId: inst.id,
          academicYear,
          created: suspensionsCreated,
          skipped: suspensionsSkipped,
        });
      } catch (err) {
        // Non bloccare il boot per un errore di bootstrap. Log e prosegui.
        console.warn(
          `  ⚠ Bootstrap AA ${academicYear} (istituto ${inst.id}) fallito: ${err.message}`,
        );
      }
    }
  }
  return results;
}

module.exports = {
  bootstrapAcademicYear,
  previewAcademicYear,
  ensureBootstrapForActiveYears,
  defaultHolidaysFor,
  defaultSettingsFor,
  firstMondayFrom,
};
