'use strict';

/**
 * Anno accademico di riferimento di una richiesta.
 *
 * Unico punto che decide: quale anno intende la richiesta, qual è la riga
 * MonteOreSettings, in che stato è l'anno e se un dato utente può
 * modificare/inviare ora (finestra globale, deroga individuale, piani legacy).
 * Il flag `submissionOpen` mostrato alla UI e il controllo applicato
 * all'invio escono dalla stessa funzione (`getAcademicYearContext`).
 *
 * `today` è sempre opzionale (default: ora corrente).
 */

const dayjs = require('dayjs');
const calendar = require('./monteOreCalendarService');

/** Nomi accettati dal client per il parametro anno, in ordine di priorità. */
const YEAR_PARAM_SOURCES = [
  ['body', 'academicYear'],
  ['body', 'year'],
  ['query', 'academicYear'],
  ['query', 'year'],
];

/** Legge l'anno esplicito dalla richiesta (null se omesso). */
function readYearParam(req) {
  for (const [bag, name] of YEAR_PARAM_SOURCES) {
    const v = req?.[bag]?.[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Anno bersaglio del docente: attivato dall'admin, altrimenti prossimo se finestra aperta, altrimenti corrente. */
async function resolveTeacherTargetYear(today = new Date()) {
  const { MonteOreSettings } = require('../models');
  const activeSettings = await MonteOreSettings.findOne({
    where: { isActiveForTeachers: true, status: 'published' },
  });
  const nextSettings = await MonteOreSettings.findOne({
    where: { academicYear: calendar.nextAcademicYear(today) },
  });
  return {
    academicYear: calendar.resolveTargetAcademicYearForTeacher(today, nextSettings, activeSettings),
    activeSettings,
    nextSettings,
  };
}

/** Rotte docente: anno esplicito, altrimenti anno bersaglio del docente. */
async function resolveTeacherYear(req, today = new Date()) {
  return readYearParam(req) || (await resolveTeacherTargetYear(today)).academicYear;
}

/** Rotte admin: anno esplicito, altrimenti anno di calendario. */
function resolveAdminYear(req, today = new Date()) {
  return readYearParam(req) || calendar.currentAcademicYear(today);
}

/** Stato logico dell'anno: 'draft' | 'published' | 'archived' | null se senza impostazioni. */
function statusOf(settings) {
  return settings ? settings.status || 'published' : null;
}

/**
 * Costruisce il contesto da una riga settings già caricata (nessuna query).
 * `reason`: null | ACADEMIC_YEAR_NOT_PUBLISHED | OUTSIDE_SUBMISSION_WINDOW.
 * Senza settings (piani legacy) l'invio resta aperto.
 */
function buildContext(academicYear, settings, user = null, today = new Date()) {
  const ctx = { academicYear, settings, status: statusOf(settings), legacy: !settings };
  if (!settings) return { ...ctx, canSubmit: true, reason: null, viaIndividualGrant: false };
  if (settings.status && settings.status !== 'published') {
    return {
      ...ctx,
      canSubmit: false,
      reason: 'ACADEMIC_YEAR_NOT_PUBLISHED',
      viaIndividualGrant: false,
    };
  }
  const now = dayjs(today).format('YYYY-MM-DD');
  const start =
    settings.submissionWindowStart && String(settings.submissionWindowStart).slice(0, 10);
  const end = settings.submissionWindowEnd && String(settings.submissionWindowEnd).slice(0, 10);
  if (start && end && now >= start && now <= end) {
    return { ...ctx, canSubmit: true, reason: null, viaIndividualGrant: false };
  }
  // Deroga individuale (Fase 6.1): valida fuori dalla finestra globale.
  if (user && user.monteOreSubmissionAllowedUntil) {
    const until = String(user.monteOreSubmissionAllowedUntil).slice(0, 10);
    if (now <= until) return { ...ctx, canSubmit: true, reason: null, viaIndividualGrant: true };
  }
  return {
    ...ctx,
    canSubmit: false,
    reason: 'OUTSIDE_SUBMISSION_WINDOW',
    viaIndividualGrant: false,
  };
}

/** Contesto dell'anno per un utente (una query sulle impostazioni). */
async function getAcademicYearContext(academicYear, user = null, { today = new Date() } = {}) {
  const { MonteOreSettings } = require('../models');
  const settings = await MonteOreSettings.findOne({ where: { academicYear } });
  return buildContext(academicYear, settings, user, today);
}

module.exports = {
  readYearParam,
  resolveTeacherTargetYear,
  resolveTeacherYear,
  resolveAdminYear,
  getAcademicYearContext,
  buildContext,
};
