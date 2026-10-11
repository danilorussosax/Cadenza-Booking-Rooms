'use strict';

const dayjs = require('dayjs');

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_FAILED';
  throw error;
}

function validateYear(year) {
  if (typeof year !== 'string' || !/^\d{4}\/\d{4}$/.test(year))
    invalid('Formato non valido (atteso YYYY/YYYY)');
  const [start, end] = year.split('/').map(Number);
  if (start < 1900 || end > 9999 || end !== start + 1)
    invalid('Anno non coerente: il secondo anno deve essere il primo + 1 (dal 1900)');
  return start;
}

function firstMondayFrom(date) {
  let d = dayjs(date);
  while (d.day() !== 1) d = d.add(1, 'day');
  return d.format('YYYY-MM-DD');
}

function defaultSettingsFor(year) {
  const start = validateYear(year);
  return {
    academicYearStart: `${start}-11-01`,
    academicYearEnd: `${start + 1}-10-31`,
    lessonsStartDate: firstMondayFrom(`${start}-11-01`),
    lessonsEndDate: `${start + 1}-10-31`,
    submissionWindowStart: `${start}-09-01`,
    submissionWindowEnd: `${start}-10-31`,
    minRequiredHours: 324,
    maxAmendmentsPerYear: 3,
    maxHoursPerDay: null,
    dailyBreakAfterHours: null,
    dailyBreakMinutes: null,
  };
}

function validateSettings(settings) {
  const start = validateYear(settings.academicYear);
  const fields = [
    'academicYearStart',
    'academicYearEnd',
    'lessonsStartDate',
    'lessonsEndDate',
    'submissionWindowStart',
    'submissionWindowEnd',
  ];
  for (const field of fields) {
    const value = settings[field];
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !dayjs(value).isValid() ||
      dayjs(value).format('YYYY-MM-DD') !== value
    )
      invalid(`Data non valida: ${field}`);
  }
  if (
    settings.academicYearStart !== `${start}-11-01` ||
    settings.academicYearEnd !== `${start + 1}-10-31`
  )
    invalid("Il calendario deve andare dal 1 novembre al 31 ottobre dell'anno accademico");
  if (
    settings.lessonsStartDate < settings.academicYearStart ||
    settings.lessonsEndDate > settings.academicYearEnd ||
    settings.lessonsStartDate > settings.lessonsEndDate
  )
    invalid("Il periodo delle lezioni deve essere ordinato e compreso nell'anno accademico");
  if (settings.submissionWindowStart > settings.submissionWindowEnd)
    invalid('La chiusura della compilazione deve seguire la sua apertura');
  if (!Number.isFinite(settings.minRequiredHours) || settings.minRequiredHours < 0)
    invalid('La soglia ore deve essere un numero non negativo');
}

module.exports = { invalid, validateYear, validateSettings, firstMondayFrom, defaultSettingsFor };
