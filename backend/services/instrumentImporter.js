'use strict';

/**
 * CSV import/export per l'inventario strumenti.
 *
 * Riusa parseCSV() di structureImporter.js per coerenza (autodetect ;,/tab,
 * gestione virgolette/escape, multilinea). Mappa header italiani/inglesi
 * sui campi canonici.
 *
 * Strategia upsert (idempotente):
 *   - Match primario su `code` (campo unico) se presente
 *   - Fallback: match su (name + brand + model + serialNumber) per evitare
 *     duplicazioni se l'utente non gestisce un codice
 *
 * Errori di riga non bloccano: vengono raccolti in errors[].
 */

const { Op } = require('sequelize');
const { Instrument } = require('../models');
const { parseCSV } = require('./structureImporter');

const FAMILIES = [
  'archi',
  'fiati_legni',
  'fiati_ottoni',
  'tastiere',
  'percussioni',
  'corde',
  'voce',
  'elettronica',
  'altro',
];
const CONDITIONS = ['ottimo', 'buono', 'discreto', 'da_riparare', 'fuori_uso'];

const HEADER_MAP = {
  code: 'code',
  codice: 'code',

  name: 'name',
  nome: 'name',
  strumento: 'name',
  instrument: 'name',

  family: 'family',
  famiglia: 'family',

  brand: 'brand',
  marca: 'brand',

  model: 'model',
  modello: 'model',

  serial: 'serialNumber',
  serialnumber: 'serialNumber',
  'serial number': 'serialNumber',
  serial_number: 'serialNumber',
  'numero di serie': 'serialNumber',
  numero_serie: 'serialNumber',
  's/n': 'serialNumber',
  sn: 'serialNumber',

  condition: 'condition',
  condizione: 'condition',
  stato: 'condition',

  loanable: 'isLoanable',
  is_loanable: 'isLoanable',
  isloanable: 'isLoanable',
  prestabile: 'isLoanable',

  notes: 'notes',
  note: 'notes',
  'note interne': 'notes',
};

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase();
}

function parseBool(v, def = true) {
  if (v == null || v === '') return def;
  const s = String(v).trim().toLowerCase();
  if (['no', 'false', '0', 'n', 'off'].includes(s)) return false;
  if (['si', 'sì', 'yes', 'true', '1', 'y', 'on', 'x'].includes(s)) return true;
  return def;
}

function pickEnum(v, allowed, def) {
  if (!v) return def;
  const s = String(v).trim().toLowerCase();
  return allowed.includes(s) ? s : def;
}

function rowsToObjects(matrix) {
  if (matrix.length === 0) return [];
  const headers = matrix[0].map(normalizeHeader).map((h) => HEADER_MAP[h] || h);
  return matrix.slice(1).map((cells, idx) => {
    const obj = { _line: idx + 2 };
    headers.forEach((h, i) => {
      const val = (cells[i] || '').trim();
      if (val !== '') obj[h] = val;
    });
    return obj;
  });
}

/**
 * Importa strumenti da CSV. Idempotente.
 * Restituisce: { rowsTotal, created, updated, skipped, errors[] }
 */
async function importInstruments({ csv }) {
  if (!csv || !csv.trim()) {
    throw Object.assign(new Error('CSV vuoto'), { status: 400, code: 'VALIDATION_FAILED' });
  }
  const matrix = parseCSV(csv);
  if (matrix.length < 2) {
    throw Object.assign(new Error("CSV deve contenere almeno una riga oltre all'intestazione"), {
      status: 400,
      code: 'VALIDATION_FAILED',
    });
  }
  const rows = rowsToObjects(matrix);

  const result = {
    rowsTotal: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const r of rows) {
    const line = r._line;
    try {
      const name = (r.name || '').trim();
      if (!name) {
        result.errors.push({ row: line, message: 'Nome strumento mancante' });
        result.skipped += 1;
        continue;
      }
      const family = pickEnum(r.family, FAMILIES, 'altro');
      const condition = pickEnum(r.condition, CONDITIONS, 'buono');
      const isLoanable = parseBool(r.isLoanable, true);
      const code = (r.code || '').trim() || null;
      const brand = (r.brand || '').trim() || null;
      const model = (r.model || '').trim() || null;
      const serialNumber = (r.serialNumber || '').trim() || null;
      const notes = (r.notes || '').trim() || null;

      // Match: codice → fallback (name+brand+model+serialNumber).
      // Se non ci sono discriminanti oltre al nome, match strict su nome
      // con brand/model/serialNumber tutti NULL (preserva l'idempotenza
      // per record con solo "name").
      let existing = null;
      if (code) {
        existing = await Instrument.findOne({ where: { code } });
      }
      if (!existing) {
        const where = { name };
        where.brand = brand ?? null;
        where.model = model ?? null;
        where.serialNumber = serialNumber ?? null;
        existing = await Instrument.findOne({ where });
      }

      const payload = { name, family, brand, model, serialNumber, condition, isLoanable, notes };
      if (code) payload.code = code;

      if (existing) {
        await existing.update(payload);
        result.updated += 1;
      } else {
        await Instrument.create(payload);
        result.created += 1;
      }
    } catch (err) {
      // duplicate key sul code → potremmo essere in race condition
      if (err.name === 'SequelizeUniqueConstraintError') {
        result.errors.push({ row: line, message: 'Codice già usato' });
      } else {
        result.errors.push({ row: line, message: err.message || 'Errore' });
      }
      result.skipped += 1;
    }
  }
  return result;
}

// =========================================================
// Export CSV
// =========================================================

const EXPORT_HEADERS = [
  'code',
  'name',
  'family',
  'brand',
  'model',
  'serialNumber',
  'condition',
  'isLoanable',
  'notes',
];

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  // Escape se contiene delimiter (;), virgolette, newline
  if (/[;"\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Restituisce una stringa CSV con tutti gli strumenti.
 * Delimitatore `;` (compatibile Excel italiano) + BOM UTF-8 per accenti.
 */
async function exportInstruments() {
  const items = await Instrument.findAll({
    order: [
      ['family', 'ASC'],
      ['name', 'ASC'],
    ],
  });
  const rows = [EXPORT_HEADERS.join(';')];
  for (const it of items) {
    const obj = it.toJSON();
    rows.push(
      EXPORT_HEADERS.map((h) =>
        csvEscape(h === 'isLoanable' ? (obj.isLoanable ? 'si' : 'no') : obj[h]),
      ).join(';'),
    );
  }
  return '﻿' + rows.join('\n') + '\n';
}

module.exports = { importInstruments, exportInstruments, FAMILIES, CONDITIONS };
