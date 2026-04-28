'use strict';

// vitest globals abilitati in vitest.config.js
const xlsx = require('xlsx');
const csvImporter = require('../../services/integrations/isidata/csvImporter');

function makeXlsx(rows) {
  const ws = xlsx.utils.aoa_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('csvImporter.parse', () => {
  it('legge XLSX semplice (header + 2 righe)', () => {
    const buf = makeXlsx([
      ['Matricola', 'Cognome', 'Nome', 'Email'],
      ['12345', 'Rossi', 'Mario', 'mario@conservatorio.it'],
      ['12346', 'Verdi', 'Luigi', 'luigi@conservatorio.it'],
    ]);
    const out = csvImporter.parse(buf, 'isidata.xlsx', '');
    expect(out.headers).toEqual(['Matricola', 'Cognome', 'Nome', 'Email']);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toEqual({
      Matricola: '12345',
      Cognome: 'Rossi',
      Nome: 'Mario',
      Email: 'mario@conservatorio.it',
    });
  });

  it('legge CSV con delimitatore ;', () => {
    const csv =
      'Matricola;Cognome;Nome;Email\n12345;Rossi;Mario;mario@x\n12346;Verdi;Luigi;luigi@x\n';
    const out = csvImporter.parse(Buffer.from(csv, 'utf8'), 'export.csv', 'text/csv');
    expect(out.rows).toHaveLength(2);
    expect(out.rows[1].Cognome).toBe('Verdi');
  });

  it('legge CSV con delimitatore ,', () => {
    const csv = 'Matricola,Cognome,Nome\n12345,Rossi,Mario\n';
    const out = csvImporter.parse(Buffer.from(csv, 'utf8'), 'export.csv');
    expect(out.rows[0].Cognome).toBe('Rossi');
  });

  it("strippa il BOM UTF-8 dall'header", () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const csv = Buffer.concat([bom, Buffer.from('Matricola,Cognome\n1,Rossi\n', 'utf8')]);
    const out = csvImporter.parse(csv, 'x.csv');
    expect(out.headers[0]).toBe('Matricola');
  });

  it('decodifica latin1 quando UTF-8 fallisce', () => {
    // "Università" in latin1 (cp1252)
    const csv = Buffer.concat([
      Buffer.from('Cognome,Nome\n', 'utf8'),
      Buffer.from([0x55, 0x6e, 0x69, 0x76, 0x65, 0x72, 0x73, 0x69, 0x74, 0xe0]), // "Universit\xE0"
      Buffer.from(',Mario\n', 'utf8'),
    ]);
    const out = csvImporter.parse(csv, 'x.csv');
    expect(out.rows[0].Cognome).toContain('Universit');
  });

  it('gestisce campi quotati con virgole interne', () => {
    const csv = 'Cognome,Nome,Indirizzo\n"Rossi","Mario","Via Roma, 12"\n';
    const out = csvImporter.parse(Buffer.from(csv, 'utf8'), 'x.csv');
    expect(out.rows[0].Indirizzo).toBe('Via Roma, 12');
  });

  it('gestisce escape doppia virgoletta "" → "', () => {
    const csv = 'Note\n"Disse ""ciao"""\n';
    const out = csvImporter.parse(Buffer.from(csv, 'utf8'), 'x.csv');
    expect(out.rows[0].Note).toBe('Disse "ciao"');
  });

  it('skippa righe completamente vuote', () => {
    const csv = 'A,B\n1,2\n\n\n3,4\n';
    const out = csvImporter.parse(Buffer.from(csv, 'utf8'), 'x.csv');
    expect(out.rows).toHaveLength(2);
  });

  it('rispetta il limite MAX_RECORDS=5000 e produce un warning', () => {
    const lines = ['Matricola'];
    for (let i = 0; i < 5500; i++) lines.push(String(i));
    const out = csvImporter.parse(Buffer.from(lines.join('\n'), 'utf8'), 'x.csv');
    expect(out.rows).toHaveLength(csvImporter.MAX_RECORDS);
    expect(out.warnings.some((w) => /Limite di 5000/.test(w.msg))).toBe(true);
  });

  it('rifiuta file > 10 MB con codice FILE_TOO_LARGE', () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 'a');
    expect(() => csvImporter.parse(big, 'x.csv')).toThrow(/troppo grande/i);
  });

  it('detect xlsx via magic bytes ZIP anche senza estensione', () => {
    const buf = makeXlsx([['A'], ['1']]);
    expect(csvImporter.detectFormat(buf, 'noname', '')).toBe('xlsx');
  });

  it('mantiene leading-zero nelle matricole (XLSX raw:false)', () => {
    const buf = makeXlsx([
      ['Matricola', 'Nome'],
      ['00042', 'Mario'],
    ]);
    const out = csvImporter.parse(buf, 'x.xlsx');
    expect(out.rows[0].Matricola).toBe('00042');
  });

  it('ignora colonne con header vuoto', () => {
    const csv = 'Matricola,,Nome\n1,X,Mario\n';
    const out = csvImporter.parse(Buffer.from(csv, 'utf8'), 'x.csv');
    expect(out.rows[0]).toEqual({ Matricola: '1', Nome: 'Mario' });
  });

  it('file vuoto → nessuna riga + warning', () => {
    const out = csvImporter.parse(Buffer.alloc(0), 'x.csv');
    expect(out.rows).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });
});
