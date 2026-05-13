'use strict';

/**
 * Generatore del template Excel "Monte Ore" per import docenti.
 *
 * Esposto da `GET /api/admin/monte-ore/import-template.xlsx`.
 *
 * Fogli prodotti:
 *   1. Istruzioni    — testo statico (compilazione, regole gialle/grigie).
 *   2. Anagrafica    — campi docente + AA (pre-popolato), soglia ore, ecc.
 *   3. Orario        — matrice settimane × giorni Lun-Sab. Qualsiasi giorno
 *                      coperto da una MonteOreSuspension (festività, vacanze
 *                      lunghe, sessione esame, ponti) → cella rossa. Settimana
 *                      Lun-Sab interamente sospesa → merge rosso "SOSPENSIONE:
 *                      {name}". Giorni fuori dal periodo di lezioni → grigio.
 *   4. Sospensioni   — elenco delle MonteOreSuspension dell'AA con periodo,
 *                      categoria, nome, note.
 *   5. Tipi attività — placeholder per override (settimana, giorno, orario,
 *                      tipo, etichetta) — colonne libere per ora.
 *
 * `exceljs` è già in deps (^4.4.0) → require sincrono.
 */

const dayjs = require('dayjs');
const ExcelJS = require('exceljs');

const { computeWeeks, DAYS_IT_SHORT } = require('./monteOreCalendarService');

const DAY_HEADERS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

const COLOR_YELLOW = 'FFFFF2CC';
const COLOR_GREY_LIGHT = 'FFE7E6E6';
const COLOR_HEADER = 'FFD9E1F2';
// Tutte le sospensioni (festività, vacanze lunghe, sessioni d'esame, ponti
// custom) usano lo stesso rosso. Coerenza visiva col riquadro Sospensioni.
const COLOR_BLOCK = 'FFC0392B';

/**
 * Per ogni "settimana" prodotta da `computeWeeks` ritorna anche il giorno
 * "sabato" (weekEnd ufficiale del modello è sabato), ma per il template
 * mostriamo la matrice Lun-Sab (6 colonne). Costruiamo quindi i 6 giorni a
 * partire dal lunedì.
 */
function buildSixDayWeeks(weeks) {
  return weeks.map((w) => {
    const start = dayjs(w.weekStart);
    const six = [];
    for (let i = 0; i < 6; i++) {
      const d = start.add(i, 'day');
      const dIso = d.format('YYYY-MM-DD');
      // Mantieni isLocked/lockReason del modello per i primi 5 giorni
      // (Lun-Ven). Per il sabato proviamo a recuperare un lock da
      // `partial` o "fuori periodo": riusiamo la struttura di `days`.
      let locked = null;
      if (i < 5) {
        locked = w.days[i] || null;
      }
      six.push({
        date: dIso,
        dayLabel: DAY_HEADERS[i],
        isLocked: locked ? locked.isLocked : false,
        lockReason: locked ? locked.lockReason : null,
      });
    }
    return { ...w, sixDays: six };
  });
}

/**
 * Match per il giorno specifico: ritorna la PRIMA suspension che copre la
 * data (qualsiasi kind/category). Il `kind` decide solo come la sospensione
 * appare in altre UI; nel template è la finestra date a contare.
 */
function findSuspensionForDay(dateIso, suspensions) {
  return (
    (suspensions || []).find(
      (s) =>
        !dayjs(s.dateFrom).isAfter(dayjs(dateIso), 'day') &&
        !dayjs(s.dateTo).isBefore(dayjs(dateIso), 'day'),
    ) || null
  );
}

/**
 * Verifica se TUTTI i 6 giorni Lun-Sab della settimana sono coperti da una
 * sospensione (anche da sospensioni DIVERSE — è raro ma possibile). In tal
 * caso restituisce la suspension che copre il lunedì (rappresentante per
 * il merge della riga). Altrimenti null.
 *
 * Esempio: Natale (24/12 → 6/1, full_week) → la settimana 28/12 → 2/1 è
 * interamente coperta → merge nero.
 * Esempio Pasqua (Ven Santo → mar successivo): NESSUNA settimana lavorativa
 * Lun-Sab è interamente coperta → no merge, celle singole rosse (ven/sab
 * della settimana che precede Pasqua e lun/mar di quella successiva).
 */
function findFullWeekSuspension(week, suspensions) {
  const ws = dayjs(week.weekStart);
  for (let i = 0; i < 6; i++) {
    const dayIso = ws.add(i, 'day').format('YYYY-MM-DD');
    if (!findSuspensionForDay(dayIso, suspensions)) return null;
  }
  return findSuspensionForDay(ws.format('YYYY-MM-DD'), suspensions);
}

function setBg(cell, argb) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function setBorder(cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FF999999' } },
    left: { style: 'thin', color: { argb: 'FF999999' } },
    bottom: { style: 'thin', color: { argb: 'FF999999' } },
    right: { style: 'thin', color: { argb: 'FF999999' } },
  };
}

/**
 * Genera il workbook per l'AA `academicYear` partendo da `settings` e
 * `suspensions` (entrambi opzionali — se assenti, alcuni fogli risultano
 * vuoti). Ritorna il Workbook (non lo scrive: lo streaming è del caller).
 */
async function buildTemplateWorkbook({ academicYear, settings, suspensions = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cadenza';
  wb.created = new Date();

  // -------------------- 1) Istruzioni --------------------
  const sIstr = wb.addWorksheet('Istruzioni');
  sIstr.columns = [{ width: 110 }];
  const istrLines = [
    `Template Monte Ore — AA ${academicYear || 'N/D'}`,
    '',
    'Compilazione:',
    '  • Anagrafica → scheda "Anagrafica" — compilare i campi a sfondo giallo.',
    '  • Orario → scheda "Orario" — inserire l\'attività nelle celle (giorno × settimana).',
    '  • La soglia minima è indicata in Anagrafica (cella "Soglia ore").',
    '',
    'Legenda colori (foglio "Orario"):',
    "  ■ ROSSO   → giorno o settimana sospesa (festività, vacanze, sessione d'esame, ponti)",
    "  ■ grigio  → fuori dal periodo di lezioni dell'AA",
    '  Le celle rosse NON sono modificabili.',
    '',
    'Categorie sospensione (foglio "Sospensioni"):',
    '  • holiday      → festività deterministiche (Natale, Pasqua, 25 apr, 1 mag, 2 giu, ecc.)',
    "  • exam_session → sessioni d'esame configurate dall'admin",
    '  • custom       → ponti/chiusure straordinarie',
    '',
    'Per dubbi: contattare la Direzione.',
  ];
  istrLines.forEach((t, i) => {
    const cell = sIstr.getCell(`A${i + 1}`);
    cell.value = t;
    if (i === 0) {
      cell.font = { bold: true, size: 14 };
    } else if (t.endsWith(':')) {
      cell.font = { bold: true };
    }
  });

  // -------------------- 2) Anagrafica --------------------
  const sAna = wb.addWorksheet('Anagrafica');
  sAna.columns = [{ width: 28 }, { width: 50 }];
  const minHours = settings?.minRequiredHours ?? 324;
  const anaRows = [
    ['Anno Accademico', academicYear || ''],
    ['Scuola', ''],
    ['Materia', ''],
    ['Nome docente', ''],
    ['Email', ''],
    ['Tipo contratto', ''],
    ['Soglia ore', minHours],
    ['Note', ''],
  ];
  anaRows.forEach((row, i) => {
    const rowIdx = i + 1;
    const cA = sAna.getCell(`A${rowIdx}`);
    const cB = sAna.getCell(`B${rowIdx}`);
    cA.value = row[0];
    cA.font = { bold: true };
    setBg(cA, COLOR_HEADER);
    setBorder(cA);
    cB.value = row[1];
    setBorder(cB);
    // Celle "da compilare" → sfondo giallo. AA e Soglia ore restano bianche
    // (sono pre-popolate / readonly logiche).
    if (!['Anno Accademico', 'Soglia ore'].includes(row[0])) {
      setBg(cB, COLOR_YELLOW);
    }
  });

  // -------------------- 3) Orario --------------------
  const sOra = wb.addWorksheet('Orario');
  // 8 colonne: # | Periodo | Lun..Sab
  sOra.columns = [
    { header: '#', key: 'idx', width: 5 },
    { header: 'Periodo', key: 'periodo', width: 22 },
    ...DAY_HEADERS.map((h) => ({ header: h, key: h.toLowerCase(), width: 18 })),
  ];
  // Stile header
  sOra.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    setBg(cell, COLOR_HEADER);
    setBorder(cell);
  });

  let weeks = [];
  if (settings && settings.lessonsStartDate && settings.lessonsEndDate) {
    try {
      weeks = computeWeeks(settings, suspensions);
    } catch {
      weeks = [];
    }
  }
  const sixWeeks = buildSixDayWeeks(weeks);

  // computeWeeks già scarta le settimane full_week-sospese. Per renderle
  // visibili nel template (richiesta della spec) ricostruiamo l'elenco
  // INCLUDENDO anche le settimane full_week, marcandole con la suspension.
  // Strategia: iteriamo dall'inizio lezioni + 7gg fino alla fine, e per
  // ogni settimana lookuppiamo se è full_week sospesa.
  if (settings && settings.lessonsStartDate && settings.lessonsEndDate) {
    const start = dayjs(settings.lessonsStartDate).startOf('isoWeek');
    const end = dayjs(settings.lessonsEndDate).endOf('day');
    let cursor = start;
    let idx = 0;
    let rowIdx = 2; // riga 1 = header
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      idx += 1;
      const weekStart = cursor;
      const weekEnd = cursor.add(5, 'day');
      const periodo = `${weekStart.format('DD MMM')} – ${weekEnd.format('DD MMM YYYY')}`;
      const row = sOra.getRow(rowIdx);
      row.getCell(1).value = idx;
      row.getCell(2).value = periodo;
      const fullSusp = findFullWeekSuspension(
        { weekStart: weekStart.format('YYYY-MM-DD') },
        suspensions,
      );
      if (fullSusp) {
        // Settimana interamente sospesa: merge C..H + nero + testo bianco.
        sOra.mergeCells(rowIdx, 3, rowIdx, 8);
        const merged = row.getCell(3);
        const label =
          fullSusp.category === 'exam_session'
            ? `SESSIONE D'ESAME: ${fullSusp.name}`
            : `SOSPENSIONE: ${fullSusp.name}`;
        merged.value = label;
        merged.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        merged.alignment = { horizontal: 'center', vertical: 'middle' };
        setBg(merged, COLOR_BLOCK);
        setBorder(merged);
        setBorder(row.getCell(1));
        setBorder(row.getCell(2));
      } else {
        // 6 giorni: Lun-Sab. Verifico ciascun giorno contro QUALSIASI
        // sospensione (kind=full_week parziale come Pasqua, kind=partial
        // come 25 apr/1 mag, e exam_session). Le settimane interamente
        // coperte sono già state catturate dal ramo `if` sopra.
        for (let i = 0; i < 6; i++) {
          const cell = row.getCell(3 + i);
          const dayIso = weekStart.add(i, 'day').format('YYYY-MM-DD');
          const susp = findSuspensionForDay(dayIso, suspensions);
          const beforeStart = dayjs(dayIso).isBefore(dayjs(settings.lessonsStartDate), 'day');
          const afterEnd = dayjs(dayIso).isAfter(dayjs(settings.lessonsEndDate), 'day');
          if (susp) {
            setBg(cell, COLOR_BLOCK);
            cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            const prefix = susp.category === 'exam_session' ? 'Esame' : 'Festa';
            cell.value = prefix;
            cell.note = susp.name;
          } else if (beforeStart || afterEnd) {
            setBg(cell, COLOR_GREY_LIGHT);
            cell.note = beforeStart ? "Prima dell'inizio lezioni" : 'Dopo la fine lezioni';
          }
          setBorder(cell);
        }
        setBorder(row.getCell(1));
        setBorder(row.getCell(2));
      }
      cursor = cursor.add(7, 'day');
      rowIdx += 1;
      // Safety: max 60 settimane (un AA arriva max a ~52)
      if (idx > 70) break;
    }
  }

  // sixWeeks è usato solo per fini di reporting esterno se serve (no-op qui),
  // ma lo lascio "calcolato" per non rompere consumer eventuali.
  void sixWeeks;

  // -------------------- 4) Sospensioni --------------------
  const sSus = wb.addWorksheet('Sospensioni');
  sSus.columns = [
    { header: 'Da', key: 'from', width: 14 },
    { header: 'A', key: 'to', width: 14 },
    { header: 'Tipo', key: 'kind', width: 12 },
    { header: 'Categoria', key: 'category', width: 14 },
    { header: 'Nome', key: 'name', width: 32 },
    { header: 'Note', key: 'notes', width: 50 },
  ];
  sSus.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    setBg(cell, COLOR_HEADER);
    setBorder(cell);
  });
  (suspensions || []).forEach((s, i) => {
    const row = sSus.getRow(i + 2);
    row.getCell(1).value = String(s.dateFrom).slice(0, 10);
    row.getCell(2).value = String(s.dateTo).slice(0, 10);
    row.getCell(3).value = s.kind;
    row.getCell(4).value = s.category || 'custom';
    row.getCell(5).value = s.name;
    row.getCell(6).value = s.notes || '';
    for (let c = 1; c <= 6; c++) setBorder(row.getCell(c));
  });

  // -------------------- 5) Tipi attività --------------------
  const sTip = wb.addWorksheet('Tipi attività');
  sTip.columns = [
    { header: 'Settimana', key: 'week', width: 12 },
    { header: 'Giorno', key: 'day', width: 12 },
    { header: 'Orario', key: 'time', width: 16 },
    { header: 'Tipo', key: 'type', width: 18 },
    { header: 'Etichetta', key: 'label', width: 36 },
  ];
  sTip.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    setBg(cell, COLOR_HEADER);
    setBorder(cell);
  });
  // Lasciamo righe vuote stilizzate (10 righe) per agevolare la compilazione.
  for (let r = 2; r <= 11; r++) {
    const row = sTip.getRow(r);
    for (let c = 1; c <= 5; c++) {
      setBorder(row.getCell(c));
      setBg(row.getCell(c), COLOR_YELLOW);
    }
  }

  // Reference: DAYS_IT_SHORT usato altrove (esposto qui per coerenza), non
  // direttamente referenziato in questa funzione.
  void DAYS_IT_SHORT;

  return wb;
}

/**
 * Scrive il workbook su uno stream HTTP (res Express). Usa
 * `xlsx.writeBuffer()` per evitare problemi con stream half-closed.
 */
async function streamTemplate(res, { academicYear, settings, suspensions }) {
  const wb = await buildTemplateWorkbook({ academicYear, settings, suspensions });
  const buf = await wb.xlsx.writeBuffer();
  const fileName = `monteore-template-${String(academicYear || 'AA').replace('/', '-')}.xlsx`;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.end(Buffer.from(buf));
}

module.exports = {
  buildTemplateWorkbook,
  streamTemplate,
};
