'use strict';

/**
 * Unit: parser Excel del Monte Ore importato dall'admin.
 *
 * Strategia: usiamo il template service esistente per generare un workbook
 * "vero", poi simuliamo la compilazione del docente scrivendo nelle celle
 * del foglio "Orario" e nei campi del foglio "Anagrafica". Infine
 * serializziamo in buffer (xlsx.writeBuffer) e passiamo a `parseExcel`.
 *
 * Copre:
 *   - estrazione corretta dei campi anagrafica (case-insensitive)
 *   - aggregazione per (dayOfWeek, startTime, endTime) con `occurrences`
 *   - parsing di fascia con aula tra parentesi → roomHint + notes
 *   - segmento malformato → warning e schedule non creato
 *   - cella in zona sospensione ("Festa") → ignorata anche se il testo
 *     contenesse una fascia oraria valida
 */

const { buildTemplateWorkbook } = require('../../services/monteOreTemplateService');
const { parseExcel, aggregateSchedules } = require('../../services/monteOreImportService');

const baseSettings = {
  academicYear: '2026/2027',
  lessonsStartDate: '2026-11-02',
  lessonsEndDate: '2027-10-31',
  minRequiredHours: 324,
};

/**
 * Compila i campi del foglio Anagrafica scrivendo nelle celle B1..B8.
 * Le label in colonna A sono già state stampate dal template.
 */
function fillAnagrafica(wb, fields) {
  const s = wb.getWorksheet('Anagrafica');
  const labelToRow = {};
  for (let r = 1; r <= 12; r++) {
    const label = String(s.getCell(`A${r}`).value || '')
      .toLowerCase()
      .trim();
    labelToRow[label] = r;
  }
  const map = {
    scuola: 'scuola',
    materia: 'materia',
    nomeDocente: 'nome docente',
    email: 'email',
    tipoContratto: 'tipo contratto',
    note: 'note',
  };
  for (const [k, label] of Object.entries(map)) {
    if (fields[k] !== undefined && labelToRow[label]) {
      s.getCell(`B${labelToRow[label]}`).value = fields[k];
    }
  }
}

/**
 * Trova la prima riga "libera" (non sospesa) del foglio Orario e ritorna
 * il suo indice. Scarta le righe merged (SOSPENSIONE) e le righe in cui
 * tutte le celle C..H sono pre-colorate (festività su tutta la fila).
 */
function findFreeOrarioRow(wb) {
  const ws = wb.getWorksheet('Orario');
  for (let r = 2; r <= 60; r++) {
    const periodo = ws.getRow(r).getCell(2).value;
    if (!periodo) continue;
    // Una riga "sospesa" ha la cella C..H merged con testo SOSPENSIONE/SESSIONE.
    const cText = String(ws.getRow(r).getCell(3).value || '').toLowerCase();
    if (cText.includes('sospensione') || cText.includes('sessione')) continue;
    // Cerca una cella tra C..H NON colorata rossa.
    for (let i = 0; i < 6; i++) {
      const cell = ws.getRow(r).getCell(3 + i);
      const fg = cell.fill?.fgColor?.argb;
      if (fg !== 'FFC0392B') return { row: r, col: 3 + i };
    }
  }
  throw new Error('Nessuna cella libera trovata nel foglio Orario');
}

/**
 * Trova una cella in zona sospensione (rossa, testo "Festa" o "Esame")
 * per testare che venga ignorata anche se ci scriviamo sopra una fascia.
 */
function findLockedCell(wb) {
  const ws = wb.getWorksheet('Orario');
  for (let r = 2; r <= 60; r++) {
    for (let i = 0; i < 6; i++) {
      const cell = ws.getRow(r).getCell(3 + i);
      const fg = cell.fill?.fgColor?.argb;
      if (fg === 'FFC0392B') return { row: r, col: 3 + i, currentText: cell.value };
    }
  }
  return null;
}

async function workbookToBuffer(wb) {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('aggregateSchedules', () => {
  it('aggrega celle identiche per (dayOfWeek, startTime, endTime)', () => {
    const out = aggregateSchedules([
      { dayOfWeek: 1, startTime: '14:00', endTime: '16:00', roomHint: null },
      { dayOfWeek: 1, startTime: '14:00', endTime: '16:00', roomHint: 'A12' },
      { dayOfWeek: 2, startTime: '09:00', endTime: '10:30', roomHint: null },
    ]);
    expect(out).toHaveLength(2);
    const mon = out.find((s) => s.dayOfWeek === 1);
    expect(mon.occurrences).toBe(2);
    // Primo trovato senza hint → poi viene aggiornato col primo non-null.
    expect(mon.roomHint).toBe('A12');
    expect(mon.notes).toMatch(/A12/);
    const tue = out.find((s) => s.dayOfWeek === 2);
    expect(tue.occurrences).toBe(1);
    expect(tue.roomHint).toBeNull();
  });

  it('ordina per dayOfWeek poi per startTime', () => {
    const out = aggregateSchedules([
      { dayOfWeek: 3, startTime: '15:00', endTime: '17:00', roomHint: null },
      { dayOfWeek: 1, startTime: '14:00', endTime: '16:00', roomHint: null },
      { dayOfWeek: 1, startTime: '09:00', endTime: '11:00', roomHint: null },
    ]);
    expect(out.map((s) => `${s.dayOfWeek}@${s.startTime}`)).toEqual([
      '1@09:00',
      '1@14:00',
      '3@15:00',
    ]);
  });
});

describe('parseExcel', () => {
  it('estrae correttamente i campi Anagrafica (case-insensitive)', async () => {
    const wb = await buildTemplateWorkbook({
      academicYear: '2026/2027',
      settings: baseSettings,
      suspensions: [],
    });
    fillAnagrafica(wb, {
      scuola: 'Conservatorio di Roma',
      materia: 'Pianoforte 3°',
      nomeDocente: 'Mario Rossi',
      email: 'Mario.Rossi@Test.IT', // verifico lowercase
      tipoContratto: 'Ordinario',
      note: 'Nessuna esigenza particolare',
    });
    const buf = await workbookToBuffer(wb);
    const { anagrafica } = await parseExcel(buf);
    expect(anagrafica.academicYear).toBe('2026/2027');
    expect(anagrafica.scuola).toBe('Conservatorio di Roma');
    expect(anagrafica.materia).toBe('Pianoforte 3°');
    expect(anagrafica.nomeDocente).toBe('Mario Rossi');
    expect(anagrafica.email).toBe('mario.rossi@test.it');
    expect(anagrafica.tipoContratto).toBe('Ordinario');
    expect(anagrafica.minHours).toBe(324);
    expect(anagrafica.note).toBe('Nessuna esigenza particolare');
  });

  it('aggrega fasce orarie su settimane diverse con stesso pattern', async () => {
    const wb = await buildTemplateWorkbook({
      academicYear: '2026/2027',
      settings: baseSettings,
      suspensions: [],
    });
    fillAnagrafica(wb, { email: 'docente@test.it' });
    const ws = wb.getWorksheet('Orario');

    // Scrivo la stessa fascia "14:00-16:00" su 3 settimane consecutive,
    // colonna C (Lunedì = dayOfWeek 1). Trovo 3 righe libere consecutive.
    let found = 0;
    for (let r = 2; r <= 60 && found < 3; r++) {
      const periodo = ws.getRow(r).getCell(2).value;
      if (!periodo) continue;
      const cText = String(ws.getRow(r).getCell(3).value || '').toLowerCase();
      if (cText.includes('sospensione') || cText.includes('sessione')) continue;
      const cell = ws.getRow(r).getCell(3);
      if (cell.fill?.fgColor?.argb === 'FFC0392B') continue;
      cell.value = '14:00-16:00';
      found++;
    }
    expect(found).toBeGreaterThanOrEqual(2);

    const buf = await workbookToBuffer(wb);
    const { schedules } = await parseExcel(buf);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      dayOfWeek: 1,
      startTime: '14:00',
      endTime: '16:00',
      bookingType: 'lezione',
      roomHint: null,
    });
    expect(schedules[0].occurrences).toBe(found);
  });

  it('parsa fascia con aula tra parentesi → roomHint e notes', async () => {
    const wb = await buildTemplateWorkbook({
      academicYear: '2026/2027',
      settings: baseSettings,
      suspensions: [],
    });
    fillAnagrafica(wb, { email: 'docente@test.it' });
    const free = findFreeOrarioRow(wb);
    wb.getWorksheet('Orario').getRow(free.row).getCell(free.col).value = '09:30-11:00 (A12)';

    const buf = await workbookToBuffer(wb);
    const { schedules, warnings } = await parseExcel(buf);
    expect(warnings).toHaveLength(0);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].startTime).toBe('09:30');
    expect(schedules[0].endTime).toBe('11:00');
    expect(schedules[0].roomHint).toBe('A12');
    expect(schedules[0].notes).toMatch(/A12/);
  });

  it('più fasce separate da ";" producono più schedule pattern', async () => {
    const wb = await buildTemplateWorkbook({
      academicYear: '2026/2027',
      settings: baseSettings,
      suspensions: [],
    });
    fillAnagrafica(wb, { email: 'docente@test.it' });
    const free = findFreeOrarioRow(wb);
    wb.getWorksheet('Orario').getRow(free.row).getCell(free.col).value =
      '09:30-11:00 (Aula 12); 14:00-16:00';

    const buf = await workbookToBuffer(wb);
    const { schedules, warnings } = await parseExcel(buf);
    expect(warnings).toHaveLength(0);
    expect(schedules).toHaveLength(2);
    const morning = schedules.find((s) => s.startTime === '09:30');
    expect(morning.roomHint).toBe('Aula 12');
    const afternoon = schedules.find((s) => s.startTime === '14:00');
    expect(afternoon.roomHint).toBeNull();
  });

  it('valore malformato genera warning e nessuno schedule', async () => {
    const wb = await buildTemplateWorkbook({
      academicYear: '2026/2027',
      settings: baseSettings,
      suspensions: [],
    });
    fillAnagrafica(wb, { email: 'docente@test.it' });
    const free = findFreeOrarioRow(wb);
    wb.getWorksheet('Orario').getRow(free.row).getCell(free.col).value = 'pomeriggio';

    const buf = await workbookToBuffer(wb);
    const { schedules, warnings } = await parseExcel(buf);
    expect(schedules).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(' ')).toMatch(/pomeriggio/);
  });

  it('cella in zona sospensione (rossa) viene ignorata anche se contiene una fascia', async () => {
    const wb = await buildTemplateWorkbook({
      academicYear: '2026/2027',
      settings: baseSettings,
      suspensions: [
        {
          name: 'Vacanze di Natale',
          dateFrom: '2026-12-24',
          dateTo: '2027-01-06',
          kind: 'full_week',
          category: 'holiday',
        },
        {
          name: 'Festa del lavoro',
          dateFrom: '2027-05-01',
          dateTo: '2027-05-01',
          kind: 'partial',
          category: 'holiday',
        },
      ],
    });
    fillAnagrafica(wb, { email: 'docente@test.it' });
    const locked = findLockedCell(wb);
    expect(locked).toBeTruthy();
    // Sovrascrivo il valore lasciando "Festa" all'inizio per simulare il
    // testo del template, ma aggiungo una fascia: deve essere ignorata.
    wb.getWorksheet('Orario').getRow(locked.row).getCell(locked.col).value = 'Festa 14:00-16:00';

    const buf = await workbookToBuffer(wb);
    const { schedules, warnings } = await parseExcel(buf);
    // Nessuno schedule deve nascere dalla cella bloccata.
    expect(schedules).toHaveLength(0);
    // Nessun warning perché la cella è LOCKED, non malformata.
    expect(warnings).toHaveLength(0);
  });

  it('rifiuta buffer vuoto', async () => {
    await expect(parseExcel(Buffer.alloc(0))).rejects.toThrow(/vuoto/i);
  });
});
