'use strict';

/**
 * Parser del file Excel "Monte Ore" prodotto da `monteOreTemplateService` e
 * compilato dal docente.
 *
 * Il template ha 5 fogli, ma per l'import ci interessano solo:
 *   - "Anagrafica"  → metadati (AA, scuola, materia, docente, email, soglia, note)
 *   - "Orario"      → matrice settimane × giorni Lun-Sab con le fasce orarie
 *                     inserite dal docente (es. `14:00-16:00 (A12)`).
 *
 * Le settimane interamente sospese sono già renderizzate come merge "rosso"
 * nel template: vengono ignorate. Le celle con testo "Festa" / "Esame" /
 * "SOSPENSIONE" sono ignorate allo stesso modo.
 *
 * Il parser produce:
 *   - `anagrafica`: oggetto con i campi del foglio Anagrafica.
 *   - `schedules`:  fasce orarie aggregate per (dayOfWeek, startTime, endTime).
 *                   Più settimane con la stessa fascia → un unico schedule
 *                   pattern con `occurrences` incrementato.
 *   - `warnings`:   stringhe descrittive di celle malformate / non parsabili,
 *                   per mostrare un riepilogo all'admin.
 */

const ExcelJS = require('exceljs');

// ============================================================
// Helpers
// ============================================================

/**
 * Restituisce il contenuto testuale di una cella exceljs, gestendo i vari
 * shape che la libreria può produrre:
 *   - stringa o numero    → ritorna stringa trimmata
 *   - null/undefined       → ritorna ''
 *   - rich text            → concatena i runs
 *   - formula con result   → ritorna il result
 *   - oggetto sharedString → ritorna la stringa
 */
function getCellText(cell) {
  if (cell === null || cell === undefined) return '';
  const v = cell.value !== undefined ? cell.value : cell;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v).trim();
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    // Rich text: { richText: [{ text: '...' }, ...] }
    if (Array.isArray(v.richText)) {
      return v.richText
        .map((r) => r.text || '')
        .join('')
        .trim();
    }
    // Formula: { formula, result } — usiamo il result
    if (v.result !== undefined && v.result !== null) {
      if (typeof v.result === 'object' && Array.isArray(v.result.richText)) {
        return v.result.richText
          .map((r) => r.text || '')
          .join('')
          .trim();
      }
      return String(v.result).trim();
    }
    // Hyperlink: { text, hyperlink }
    if (typeof v.text === 'string') return v.text.trim();
  }
  return String(v).trim();
}

/**
 * Mappa label → key dei campi dell'Anagrafica. Le label sono case-insensitive
 * e confrontate dopo trim/lowercase.
 */
const ANAGRAFICA_FIELDS = [
  { label: 'anno accademico', key: 'academicYear' },
  { label: 'scuola', key: 'scuola' },
  { label: 'materia', key: 'materia' },
  { label: 'nome docente', key: 'nomeDocente' },
  { label: 'email', key: 'email' },
  { label: 'tipo contratto', key: 'tipoContratto' },
  { label: 'soglia ore', key: 'minHours' },
  { label: 'note', key: 'note' },
];

/** Pattern di una fascia oraria con aula opzionale: `HH:MM-HH:MM (aula)` */
const TIME_RANGE_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(?:\s*\(([^)]+)\))?$/;

/** Marker che indicano una cella bloccata (sospensione, festività, esame) */
const LOCK_MARKERS = ['festa', 'esame', 'sospensione', "sessione d'esame", 'sessione d esame'];

/**
 * Verifica se una stringa cella corrisponde a una "sospensione" renderizzata
 * dal template (e quindi non parsabile come fascia oraria).
 */
function isLockedCellText(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return LOCK_MARKERS.some((m) => t.includes(m));
}

function pad2(n) {
  const s = String(n);
  return s.length === 1 ? `0${s}` : s;
}

/** Etichetta posizionale per i warnings: es. "Orario!E7" (giorno=Mer settimana=6). */
function cellLabel(rowIdx, colIdx) {
  // colIdx 1-based: 1=A, 2=B, 3=C, ...
  let s = '';
  let n = colIdx;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `${s}${rowIdx}`;
}

// ============================================================
// Aggregator
// ============================================================

/**
 * Aggrega le celle "raw" (`{ dayOfWeek, startTime, endTime, roomHint }`) per
 * chiave `(dayOfWeek|startTime|endTime)`. Settimane multiple con la stessa
 * fascia → un solo schedule pattern, con `occurrences` = numero di settimane.
 *
 * Il primo `roomHint` non vuoto incontrato viene preservato; viene anche
 * scritto come nota leggibile (es. `"Aula consigliata: A12"`).
 */
function aggregateSchedules(rawCells) {
  const byKey = new Map();
  for (const cell of rawCells) {
    const key = `${cell.dayOfWeek}|${cell.startTime}|${cell.endTime}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        dayOfWeek: cell.dayOfWeek,
        startTime: cell.startTime,
        endTime: cell.endTime,
        bookingType: 'lezione',
        roomHint: cell.roomHint || null,
        notes: cell.roomHint ? `Aula consigliata: ${cell.roomHint}` : null,
        occurrences: 0,
      };
      byKey.set(key, agg);
    } else if (!agg.roomHint && cell.roomHint) {
      // Preserva il primo roomHint trovato (è una nota, non una FK).
      agg.roomHint = cell.roomHint;
      agg.notes = `Aula consigliata: ${cell.roomHint}`;
    }
    agg.occurrences += 1;
  }
  // Ordina per dayOfWeek asc, poi startTime asc — comodo per UI e test.
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startTime.localeCompare(b.startTime);
  });
}

// ============================================================
// Parser principale
// ============================================================

/**
 * Carica il buffer xlsx, estrae anagrafica e schedules.
 *
 * @param {Buffer} buffer  Contenuto binario del file caricato dall'admin.
 * @returns {Promise<{
 *   anagrafica: {
 *     academicYear: string,
 *     scuola: string|null,
 *     materia: string|null,
 *     nomeDocente: string|null,
 *     email: string,
 *     tipoContratto: string|null,
 *     minHours: number|null,
 *     note: string|null,
 *   },
 *   schedules: Array<{
 *     dayOfWeek: number,
 *     startTime: string,
 *     endTime: string,
 *     bookingType: string,
 *     roomHint: string|null,
 *     notes: string|null,
 *     occurrences: number,
 *   }>,
 *   warnings: string[],
 * }>}
 */
async function parseExcel(buffer) {
  if (!buffer || !buffer.length) {
    throw new Error('File vuoto o non leggibile');
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // -------------------- Anagrafica --------------------
  const sAna = wb.getWorksheet('Anagrafica');
  if (!sAna) {
    throw new Error('Foglio "Anagrafica" mancante');
  }
  const anaByKey = {};
  // Leggi righe 1..N: colonna A = label, colonna B = valore.
  // Il template ha 8 righe ma siamo tolleranti: leggiamo finché c'è una label.
  for (let r = 1; r <= 30; r++) {
    const row = sAna.getRow(r);
    const labelRaw = getCellText(row.getCell(1));
    if (!labelRaw) continue;
    const label = labelRaw.toLowerCase().trim();
    const def = ANAGRAFICA_FIELDS.find((f) => f.label === label);
    if (!def) continue;
    const valueRaw = getCellText(row.getCell(2));
    anaByKey[def.key] = valueRaw;
  }

  // Normalizzazione: email lowercase, minHours number, vuoti → null.
  const anagrafica = {
    academicYear: anaByKey.academicYear || '',
    scuola: anaByKey.scuola || null,
    materia: anaByKey.materia || null,
    nomeDocente: anaByKey.nomeDocente || null,
    email: (anaByKey.email || '').toLowerCase(),
    tipoContratto: anaByKey.tipoContratto || null,
    minHours: anaByKey.minHours ? Number(anaByKey.minHours) || null : null,
    note: anaByKey.note || null,
  };

  // -------------------- Orario --------------------
  const sOra = wb.getWorksheet('Orario');
  const warnings = [];
  const rawCells = [];

  if (!sOra) {
    // Niente foglio Orario → ritorna anagrafica con schedules vuoti + warning.
    warnings.push('Foglio "Orario" mancante: nessuna fascia oraria importata');
    return { anagrafica, schedules: [], warnings };
  }

  // Dalla riga 2 in poi: la riga 1 è header (# | Periodo | Lun..Sab).
  // Itera finché c'è almeno la colonna B (periodo) compilata.
  const lastRow = sOra.actualRowCount || sOra.rowCount || 60;
  for (let r = 2; r <= lastRow; r++) {
    const row = sOra.getRow(r);
    const periodo = getCellText(row.getCell(2));
    if (!periodo) continue; // riga vuota / fuori range

    // Colonne C..H = giorni Lun..Sab → dayOfWeek 1..6 (compatibile JS Date.getDay
    // dove Domenica=0, Lunedì=1, ...).
    for (let i = 0; i < 6; i++) {
      const colIdx = 3 + i; // C..H
      const cell = row.getCell(colIdx);
      const text = getCellText(cell);
      if (!text) continue; // cella libera
      if (isLockedCellText(text)) continue; // sospensione / festa / esame

      const dayOfWeek = i + 1; // Lun=1, Mar=2, ..., Sab=6

      // Più fasce separate da `;`
      const segments = text
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const seg of segments) {
        const m = TIME_RANGE_RE.exec(seg);
        if (!m) {
          warnings.push(
            `Cella ${cellLabel(r, colIdx)} (settimana "${periodo}"): segmento non riconosciuto "${seg}"`,
          );
          continue;
        }
        const sh = Number(m[1]);
        const sm = Number(m[2]);
        const eh = Number(m[3]);
        const em = Number(m[4]);
        const roomHint = (m[5] || '').trim() || null;

        if (sh > 23 || eh > 23 || sm > 59 || em > 59) {
          warnings.push(`Cella ${cellLabel(r, colIdx)}: orario fuori range "${seg}"`);
          continue;
        }
        const startTime = `${pad2(sh)}:${pad2(sm)}`;
        const endTime = `${pad2(eh)}:${pad2(em)}`;
        if (endTime <= startTime) {
          warnings.push(
            `Cella ${cellLabel(r, colIdx)}: fine (${endTime}) non posteriore all'inizio (${startTime})`,
          );
          continue;
        }

        rawCells.push({ dayOfWeek, startTime, endTime, roomHint });
      }
    }
  }

  const schedules = aggregateSchedules(rawCells);
  return { anagrafica, schedules, warnings };
}

module.exports = {
  parseExcel,
  aggregateSchedules,
  // Esposti per i test unit (helper interni utilizzabili senza file Excel).
  _internals: { getCellText, isLockedCellText, TIME_RANGE_RE },
};
