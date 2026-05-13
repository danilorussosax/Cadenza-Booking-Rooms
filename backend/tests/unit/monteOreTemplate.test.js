'use strict';

/**
 * Unit: rendering del template Excel — focus sulle sospensioni colorate.
 *
 * Verifica in particolare che la sospensione "Vacanze di Pasqua"
 * (kind=full_week ma a cavallo di due settimane lavorative) venga
 * renderizzata cella-per-cella (ven/sab della settimana che precede
 * Pasqua + lun/mar di quella successiva) anziché essere "persa".
 */

const ExcelJS = require('exceljs');
const { buildTemplateWorkbook } = require('../../services/monteOreTemplateService');

const COLOR_BLOCK = 'FFC0392B';

const baseSettings = {
  academicYear: '2026/2027',
  lessonsStartDate: '2026-11-02',
  lessonsEndDate: '2027-10-31',
  minRequiredHours: 324,
};

async function build(suspensions) {
  return buildTemplateWorkbook({
    academicYear: '2026/2027',
    settings: baseSettings,
    suspensions,
  });
}

/** Trova la riga del foglio Orario il cui campo "Periodo" contiene `match`. */
function findRow(ws, match) {
  for (let r = 2; r <= 60; r++) {
    const periodo = ws.getRow(r).getCell(2).value;
    if (periodo && String(periodo).includes(match)) return r;
  }
  return null;
}

function bg(cell) {
  return cell.fill?.fgColor?.argb || null;
}

describe('Template Excel — rendering sospensioni colorate', () => {
  it('Vacanze di Natale: settimana 28 dic → 02 gen interamente rossa', async () => {
    const wb = await build([
      {
        name: 'Vacanze di Natale',
        dateFrom: '2026-12-24',
        dateTo: '2027-01-06',
        kind: 'full_week',
        category: 'holiday',
      },
    ]);
    const ws = wb.getWorksheet('Orario');
    const r = findRow(ws, '28 Dec') || findRow(ws, '28 Dic');
    expect(r).toBeTruthy();
    // C..H merged in singola cella rossa con label "SOSPENSIONE: ..."
    const c = ws.getRow(r).getCell(3);
    expect(bg(c)).toBe(COLOR_BLOCK);
    expect(String(c.value || '')).toMatch(/SOSPENSIONE/i);
  });

  it('Vacanze di Pasqua 2027: ven 26 + sab 27 marzo → rosso "Festa"', async () => {
    const wb = await build([
      {
        name: 'Vacanze di Pasqua',
        dateFrom: '2027-03-26',
        dateTo: '2027-03-30',
        kind: 'full_week',
        category: 'holiday',
      },
    ]);
    const ws = wb.getWorksheet('Orario');
    const r = findRow(ws, '22 Mar');
    expect(r).toBeTruthy();
    const row = ws.getRow(r);
    // 22 mar = lun (libera), …, 26 mar = ven (sospesa), 27 mar = sab (sospesa)
    expect(bg(row.getCell(3))).toBeNull(); // Lun
    expect(bg(row.getCell(7))).toBe(COLOR_BLOCK); // Ven
    expect(bg(row.getCell(8))).toBe(COLOR_BLOCK); // Sab
    expect(String(row.getCell(7).value || '')).toBe('Festa');
  });

  it('Vacanze di Pasqua 2027: lun 29 + mar 30 marzo → rosso "Festa"', async () => {
    const wb = await build([
      {
        name: 'Vacanze di Pasqua',
        dateFrom: '2027-03-26',
        dateTo: '2027-03-30',
        kind: 'full_week',
        category: 'holiday',
      },
    ]);
    const ws = wb.getWorksheet('Orario');
    const r = findRow(ws, '29 Mar');
    expect(r).toBeTruthy();
    const row = ws.getRow(r);
    expect(bg(row.getCell(3))).toBe(COLOR_BLOCK); // Lun = dell'Angelo
    expect(bg(row.getCell(4))).toBe(COLOR_BLOCK); // Mar
    expect(bg(row.getCell(5))).toBeNull(); // Mer libera
  });

  it('Sessione esami partial → "Esame" rosso', async () => {
    const wb = await build([
      {
        name: 'Sessione invernale',
        dateFrom: '2027-02-22',
        dateTo: '2027-02-26',
        kind: 'partial',
        category: 'exam_session',
      },
    ]);
    const ws = wb.getWorksheet('Orario');
    const r = findRow(ws, '22 Feb');
    expect(r).toBeTruthy();
    const row = ws.getRow(r);
    expect(bg(row.getCell(3))).toBe(COLOR_BLOCK); // Lun
    expect(String(row.getCell(3).value || '')).toBe('Esame');
  });
});
