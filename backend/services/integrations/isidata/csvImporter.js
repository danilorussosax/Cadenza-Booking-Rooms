'use strict';

/**
 * Parser per file Isidata in formato CSV o XLSX.
 *
 * Vincoli di scope (Liv A):
 *   - file ≤ 10 MB (validato dal route handler tramite multer.limits)
 *   - max 5000 record dopo l'header (per evitare DoS sulla preview con file
 *     enormi). Se il file ne contiene di più, le righe successive vengono
 *     scartate e un warning viene aggiunto al risultato.
 *   - encoding CSV: UTF-8 con o senza BOM, fallback Latin1 (ISO-8859-1) se
 *     il decode UTF-8 produce caratteri di replacement.
 *
 * API:
 *   parse(buffer: Buffer, filename: string, mimeType: string, opts?) →
 *     { rows, headers, warnings }
 *
 *   - rows: array di oggetti `{ [header]: value }` con value sempre stringa.
 *   - headers: array di stringhe (intestazioni nel loro case originale).
 *   - warnings: array di `{ row?: number, msg: string }` non bloccanti.
 *
 * Il parser è agnostico rispetto al MAPPING: applica quello via fieldMapping.js.
 */

const xlsx = require('xlsx');

const MAX_RECORDS = 5000;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Decoder buffer → string.
 * Strategia: UTF-8 primo tentativo; se appaiono caratteri di replacement
 * (U+FFFD) nei primi 4KB ritentiamo Latin1 (Excel italiano produce
 * spesso file in cp1252).
 */
function decodeBuffer(buf) {
  // BOM UTF-8: 0xEF 0xBB 0xBF
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  const u8 = buf.toString('utf8');
  const head = u8.slice(0, 4096);
  if (head.includes('�')) {
    return buf.toString('latin1');
  }
  return u8;
}

/**
 * Parser CSV minimale ma RFC4180-aware (gestisce delimitatore , o ;,
 * quoting con doppi apici, escape "" → ", newline dentro campi quotati).
 *
 * Auto-detect del delimitatore: contiamo `,` vs `;` nella prima riga.
 * Isidata IT esporta tipicamente con `;` (locale), tools di terze parti
 * con `,`.
 */
function parseCsvText(text) {
  const warnings = [];
  // Rimuove eventuale CR finale (Windows) — il parser gestisce comunque \r\n
  // ma normalizzare semplifica i test cross-platform.
  const src = text.replace(/\r\n/g, '\n');

  // Trova prima riga non-vuota per detect del delim.
  let probeEnd = src.indexOf('\n');
  if (probeEnd < 0) probeEnd = src.length;
  const firstLine = src.slice(0, probeEnd);
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delim = semicolons > commas ? ';' : ',';

  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  let lineNo = 1;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      // Quote ammesso solo all'inizio di un field; se in mezzo, lo includiamo
      // letterale (tolerante con file mal-quotati di Isidata).
      if (field === '') {
        inQuotes = true;
      } else {
        field += c;
      }
      continue;
    }
    if (c === delim) {
      cur.push(field);
      field = '';
      continue;
    }
    if (c === '\n') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      lineNo++;
      continue;
    }
    field += c;
  }
  // Ultimo field/riga (se il file non termina con \n).
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  return { rows, warnings };
}

/**
 * Trasforma una matrice {rows: cells[][]} in {headers, records[{header→value}]}.
 */
function rowsToRecords(rows) {
  if (rows.length === 0) return { headers: [], records: [], warnings: [] };
  const headers = rows[0].map((h) => String(h ?? '').trim());
  const records = [];
  const warnings = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    // Salta righe completamente vuote (ne capitano in CSV mal copy-incollati).
    if (r.every((v) => v === null || v === undefined || String(v).trim() === '')) {
      continue;
    }
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (!key) continue; // colonne con header vuoto: ignorate
      const v = r[j];
      obj[key] = v === null || v === undefined ? '' : String(v);
    }
    records.push(obj);
    if (records.length >= MAX_RECORDS) {
      warnings.push({
        row: i + 1,
        msg: `Limite di ${MAX_RECORDS} record raggiunto: le righe successive saranno ignorate`,
      });
      break;
    }
  }
  return { headers, records, warnings };
}

/**
 * Auto-detect formato file:
 *   - .xlsx / .xls / mimeType excel → XLSX
 *   - .csv / .txt / mimeType csv|text → CSV
 *   - fallback: prova XLSX (sniff sui magic bytes ZIP), poi CSV
 */
function detectFormat(buffer, filename, mimeType) {
  const lower = (filename || '').toLowerCase();
  const mt = (mimeType || '').toLowerCase();
  if (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    mt.includes('spreadsheet') ||
    mt.includes('excel')
  ) {
    return 'xlsx';
  }
  if (
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
    lower.endsWith('.txt') ||
    mt.includes('csv') ||
    mt.includes('text/plain')
  ) {
    return 'csv';
  }
  // Sniff magic bytes: ZIP (XLSX è uno zip) → 0x50 0x4B
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) return 'xlsx';
  return 'csv';
}

function parse(buffer, filename = '', mimeType = '') {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('parse(): atteso Buffer');
  }
  if (buffer.length === 0) {
    return { rows: [], headers: [], warnings: [{ msg: 'file vuoto' }] };
  }
  if (buffer.length > MAX_BYTES) {
    const e = new Error(`File troppo grande (${buffer.length} byte, max ${MAX_BYTES})`);
    e.code = 'FILE_TOO_LARGE';
    throw e;
  }

  const fmt = detectFormat(buffer, filename, mimeType);

  if (fmt === 'xlsx') {
    let wb;
    try {
      wb = xlsx.read(buffer, { type: 'buffer' });
    } catch (err) {
      const e = new Error(`Impossibile leggere il file XLSX: ${err.message}`);
      e.code = 'PARSE_FAILED';
      throw e;
    }
    if (!wb.SheetNames.length) {
      return { rows: [], headers: [], warnings: [{ msg: 'workbook senza fogli' }] };
    }
    // Primo foglio per default. Isidata mette gli utenti in un solo sheet.
    const sheet = wb.Sheets[wb.SheetNames[0]];
    // header:1 → restituisce array of arrays (matrice celle).
    // raw:false → conversione a stringa coerente con CSV (numeri formattati,
    //             date in stringa locale leggibile). Importante per matricole
    //             che iniziano con 0 — Excel le converte in numero, qui le
    //             trattiamo come stringhe.
    // defval:'' → non saltare le celle vuote (mantiene allineamento colonne).
    const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    const { headers, records, warnings } = rowsToRecords(matrix);
    return { rows: records, headers, warnings };
  }

  // CSV
  const text = decodeBuffer(buffer);
  const { rows: matrix, warnings: parseWarn } = parseCsvText(text);
  const { headers, records, warnings: shapeWarn } = rowsToRecords(matrix);
  return { rows: records, headers, warnings: [...parseWarn, ...shapeWarn] };
}

module.exports = {
  parse,
  parseCsvText, // export-only-for-testing
  rowsToRecords,
  detectFormat,
  decodeBuffer,
  MAX_RECORDS,
  MAX_BYTES,
};
