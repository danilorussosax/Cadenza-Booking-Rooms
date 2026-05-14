'use strict';

/**
 * Servizio condiviso per l'import "amministrativo" di utenti da CSV/XLSX.
 *
 * Differenze rispetto al sync Isidata (services/integrations/isidata):
 *   - flow one-shot (no preview/apply wizard, no token TOCTOU)
 *   - accetta role='admin'
 *   - status del file = user.status (pending/approved/rejected), default 'approved'
 *   - colonna 'Attivo' separata per isActive
 *   - nessuna detection orphan: l'admin importa una lista che vuole creare/aggiornare,
 *     gli utenti non presenti restano invariati
 *   - nessun externalSource persistito: utenti "interni"
 *
 * Riutilizza l'infrastruttura di parsing (csvImporter) e la risoluzione header
 * (buildHeaderMap) del modulo Isidata. Supporta sia CSV (delimitatori `;` o `,`)
 * sia XLSX.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { User, Course } = require('../../models');
const csvImporter = require('../integrations/isidata/csvImporter');
const {
  buildHeaderMap,
  coerceRoleAdmin,
  coerceUserStatus,
  coerceIsActive,
} = require('../integrations/isidata/fieldMapping');

const VALID_ROLES = ['admin', 'docente', 'studente'];

function pick(row, headerMap, target) {
  const h = headerMap[target];
  if (!h) return null;
  const v = row[h];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} mimetype
 * @returns {Promise<{
 *   parsed: number,
 *   created: number,
 *   updated: number,
 *   skipped: number,
 *   errors: Array<{ line: number, msg: string }>,
 *   warnings: Array<{ row?: number, msg: string }>,
 * }>}
 */
async function importUsersFromFile(buffer, filename = '', mimetype = '') {
  const result = {
    parsed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    warnings: [],
  };

  let parsed;
  try {
    parsed = await csvImporter.parse(buffer, filename, mimetype);
  } catch (err) {
    const e = new Error(err.message || 'Parsing fallito');
    e.code = err.code || 'PARSE_FAILED';
    throw e;
  }
  const { rows, headers, warnings } = parsed;
  result.warnings.push(...warnings);

  if (!rows.length) {
    const e = new Error("CSV/XLSX deve contenere almeno una riga oltre all'intestazione");
    e.code = 'EMPTY_FILE';
    throw e;
  }
  result.parsed = rows.length;

  const headerMap = buildHeaderMap(headers);

  // Lookup veloce codice corso → courseId per non rifare la query per ogni riga.
  const courses = await Course.findAll({ attributes: ['id', 'code'] });
  const courseByCode = new Map(
    courses
      .map((c) => [
        String(c.code || '')
          .trim()
          .toLowerCase(),
        c.id,
      ])
      .filter(([k]) => k),
  );

  // Numero riga "umano": header è riga 1, prima riga dati è riga 2.
  let lineNo = 1;
  for (const row of rows) {
    lineNo += 1;
    const lineMsg = (msg) => result.errors.push({ line: lineNo, msg });

    const email = pick(row, headerMap, 'email');
    if (!email) {
      lineMsg('email mancante');
      result.skipped++;
      continue;
    }
    const firstName = pick(row, headerMap, 'firstName');
    const lastName = pick(row, headerMap, 'lastName');
    if (!firstName || !lastName) {
      lineMsg('nome o cognome mancante');
      result.skipped++;
      continue;
    }

    const roleRaw = pick(row, headerMap, 'role');
    const role = coerceRoleAdmin(roleRaw);
    if (!VALID_ROLES.includes(role)) {
      // Difensivo: coerceRoleAdmin restituisce sempre un valore valido, ma
      // in caso di future modifiche al mapping vogliamo evitare di scrivere
      // record con ruolo non valido.
      lineMsg(`ruolo "${roleRaw}" non valido (admin/docente/studente)`);
      result.skipped++;
      continue;
    }

    const userStatus = coerceUserStatus(pick(row, headerMap, 'userStatus'));
    const isActiveRaw = pick(row, headerMap, 'isActive');
    const isActive = coerceIsActive(isActiveRaw);

    const matricola = pick(row, headerMap, 'matricola');
    const courseCode = pick(row, headerMap, 'courseCode');
    const courseId = courseCode ? (courseByCode.get(courseCode.toLowerCase()) ?? null) : null;
    if (courseCode && courseId == null) {
      // Soft-warning: importo l'utente senza corso piuttosto che skipparlo.
      lineMsg(`codice corso "${courseCode}" non trovato (utente importato senza corso)`);
    }

    const emailNorm = email.toLowerCase();
    try {
      // paranoid:false → trova anche utenti soft-deleted con stessa email
      // (altrimenti scatta unique violation sull'INSERT successivo).
      const existing = await User.findOne({ where: { email: emailNorm }, paranoid: false });
      if (existing) {
        if (existing.deletedAt) await existing.restore();
        await existing.update({
          firstName,
          lastName,
          role,
          matricola: matricola || existing.matricola,
          courseId,
          status: userStatus,
          isActive,
        });
        result.updated++;
      } else {
        // Password temporanea casuale: l'admin DEVE invitare l'utente al
        // reset password (oppure usare 2FA email per primo accesso).
        const tempPassword = crypto.randomBytes(16).toString('hex');
        const hash = await bcrypt.hash(tempPassword, 12);
        await User.create({
          email: emailNorm,
          firstName,
          lastName,
          role,
          matricola: matricola || null,
          courseId,
          status: userStatus,
          isActive,
          passwordHash: hash,
        });
        result.created++;
      }
    } catch (err) {
      // Estrai dettagli da errori Sequelize per non mostrare solo "Validation error"
      let msg = err?.message || 'Errore creazione/aggiornamento';
      if (
        err?.name === 'SequelizeValidationError' &&
        Array.isArray(err.errors) &&
        err.errors.length
      ) {
        msg = err.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      } else if (err?.name === 'SequelizeUniqueConstraintError') {
        const fields = Array.isArray(err.errors)
          ? err.errors.map((e) => e.path).join(', ')
          : Object.keys(err.fields || {}).join(', ');
        msg = `Vincolo unique violato (${fields || '?'})`;
      }
      lineMsg(msg);
      result.skipped++;
    }
  }

  return result;
}

module.exports = {
  importUsersFromFile,
};
