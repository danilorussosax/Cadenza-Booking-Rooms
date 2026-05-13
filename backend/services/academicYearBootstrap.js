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
 * dall'AA precedente le sospensioni `custom` ed `exam_session` shiftate di
 * +365 giorni (approssimazione: l'admin può rifinire dopo).
 */

const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { sequelize, MonteOreSettings, MonteOreSuspension, Institute } = require('../models');
const {
  computeEaster,
  currentAcademicYear,
  nextAcademicYear,
} = require('./monteOreCalendarService');

/**
 * Primo lunedì utile da `dateIso` (incluso). Ritorna 'YYYY-MM-DD'.
 */
function firstMondayFrom(dateIso) {
  let d = dayjs(dateIso);
  // dayjs.day(): 0=domenica, 1=lunedì … 6=sabato.
  while (d.day() !== 1) {
    d = d.add(1, 'day');
  }
  return d.format('YYYY-MM-DD');
}

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

/**
 * Build dei `defaultRange` con `lessonsStartDate` = primo lunedì utile da 1
 * nov Y, non hard-coded a 3 nov.
 */
function defaultSettingsFor(academicYear) {
  const [Y0] = academicYear.split('/').map(Number);
  const Y = Y0;
  const Y1 = Y0 + 1;
  return {
    academicYearStart: isoDate(Y, 11, 1),
    academicYearEnd: isoDate(Y1, 10, 31),
    lessonsStartDate: firstMondayFrom(isoDate(Y, 11, 1)),
    lessonsEndDate: isoDate(Y1, 10, 31),
    submissionWindowStart: isoDate(Y, 9, 1),
    submissionWindowEnd: isoDate(Y, 10, 31),
    minRequiredHours: 324,
    maxAmendmentsPerYear: 3,
  };
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

/**
 * Bootstrap dell'AA. Idempotente: se chiamato due volte con overwrite=false
 * non duplica righe.
 *
 * @param {object} opts
 * @param {string} opts.academicYear              "2025/2026"
 * @param {number} [opts.instituteId]             default = primo istituto
 * @param {'default'|'from_previous'} [opts.mode] default 'default'
 * @param {string} [opts.previousYear]            usato in mode='from_previous'
 * @param {boolean} [opts.overwrite]              se true sovrascrive i settings
 * @param {object} [opts.transaction]             transazione Sequelize opzionale
 * @returns {Promise<{settings: object, suspensionsCreated: number, suspensionsSkipped: number}>}
 */
async function bootstrapAcademicYear({
  academicYear,
  instituteId = null,
  mode = 'default',
  previousYear = null,
  overwrite = false,
  transaction = null,
} = {}) {
  if (!academicYear || !/^\d{4}\/\d{4}$/.test(academicYear)) {
    const e = new Error('academicYear non valido (atteso formato "YYYY/YYYY")');
    e.status = 400;
    throw e;
  }
  const [a, b] = academicYear.split('/').map(Number);
  if (b !== a + 1) {
    const e = new Error('academicYear non coerente: il secondo anno deve essere il primo + 1');
    e.status = 400;
    throw e;
  }

  const run = async (t) => {
    const realInstituteId = await resolveInstituteId(instituteId);

    // 1) Settings — findOrCreate per non sovrascrivere se overwrite=false
    const defaults = defaultSettingsFor(academicYear);
    const [settings, created] = await MonteOreSettings.findOrCreate({
      where: { instituteId: realInstituteId, academicYear },
      defaults: { instituteId: realInstituteId, academicYear, ...defaults },
      transaction: t,
    });
    if (!created && overwrite) {
      await settings.update(defaults, { transaction: t });
    }

    // 2) Holidays deterministiche
    const holidays = defaultHolidaysFor(academicYear);

    // Pre-fetch esistenti (match per name + dateFrom, evita duplicati anche
    // tra run successivi anche se le date "slittano" tra anni).
    const existingHolidays = await MonteOreSuspension.findAll({
      where: { instituteId: realInstituteId, academicYear, category: 'holiday' },
      transaction: t,
    });
    const existingKey = (s) => `${s.name}::${String(s.dateFrom).slice(0, 10)}`;
    const existingSet = new Set(existingHolidays.map(existingKey));

    let suspensionsCreated = 0;
    let suspensionsSkipped = 0;

    for (const h of holidays) {
      const key = `${h.name}::${h.dateFrom}`;
      if (existingSet.has(key) && !overwrite) {
        suspensionsSkipped += 1;
        continue;
      }
      if (existingSet.has(key) && overwrite) {
        const ex = existingHolidays.find((s) => existingKey(s) === key);
        await ex.update(
          {
            dateFrom: h.dateFrom,
            dateTo: h.dateTo,
            kind: h.kind,
            category: 'holiday',
            notes: h.notes,
          },
          { transaction: t },
        );
        // Considerato come "ricreato"
        suspensionsCreated += 1;
        continue;
      }
      await MonteOreSuspension.create(
        {
          instituteId: realInstituteId,
          academicYear,
          name: h.name,
          dateFrom: h.dateFrom,
          dateTo: h.dateTo,
          kind: h.kind,
          category: 'holiday',
          notes: h.notes,
        },
        { transaction: t },
      );
      suspensionsCreated += 1;
    }

    // 3) Eventuale copia da AA precedente (mode='from_previous')
    if (mode === 'from_previous' && previousYear) {
      if (!/^\d{4}\/\d{4}$/.test(previousYear)) {
        const e = new Error('previousYear non valido');
        e.status = 400;
        throw e;
      }
      const fromCustom = await MonteOreSuspension.findAll({
        where: {
          instituteId: realInstituteId,
          academicYear: previousYear,
          category: { [Op.in]: ['custom', 'exam_session'] },
        },
        transaction: t,
      });
      // Recupera anche le righe (custom/exam_session) già presenti nell'AA
      // target, per evitare duplicati su run ripetuti.
      const existingCopies = await MonteOreSuspension.findAll({
        where: {
          instituteId: realInstituteId,
          academicYear,
          category: { [Op.in]: ['custom', 'exam_session'] },
        },
        transaction: t,
      });
      const copiesSet = new Set(existingCopies.map(existingKey));
      for (const s of fromCustom) {
        const shiftedFrom = dayjs(s.dateFrom).add(365, 'day').format('YYYY-MM-DD');
        const shiftedTo = dayjs(s.dateTo).add(365, 'day').format('YYYY-MM-DD');
        const key = `${s.name}::${shiftedFrom}`;
        if (copiesSet.has(key) && !overwrite) {
          suspensionsSkipped += 1;
          continue;
        }
        await MonteOreSuspension.create(
          {
            instituteId: realInstituteId,
            academicYear,
            name: s.name,
            dateFrom: shiftedFrom,
            dateTo: shiftedTo,
            kind: s.kind,
            category: s.category,
            notes: s.notes,
          },
          { transaction: t },
        );
        suspensionsCreated += 1;
      }
    }

    return {
      settings: settings.toJSON ? settings.toJSON() : settings,
      suspensionsCreated,
      suspensionsSkipped,
    };
  };

  if (transaction) return run(transaction);
  return sequelize.transaction(run);
}

/**
 * Garantisce che gli AA "attivi" (corrente + prossimo) abbiano `MonteOreSettings`
 * e le festività di default. Idempotente: chiamabile a ogni boot senza
 * duplicare nulla. Per ogni istituto presente nel sistema.
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
  ensureBootstrapForActiveYears,
  defaultHolidaysFor,
  defaultSettingsFor,
  firstMondayFrom,
};
