'use strict';

// vitest globals abilitati in vitest.config.js
const ExcelJS = require('exceljs');
const { importUsersFromFile } = require('../../services/users/csvImport');
const { User, Course } = require('../../models');

async function makeXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

beforeEach(async () => {
  await globalThis.resetDatabase();
});

describe('services/users/csvImport.importUsersFromFile', () => {
  it('importa CSV con delimitatore ";" creando nuovi utenti', async () => {
    const csv =
      'Email;Cognome;Nome;Ruolo;Matricola;Stato;Attivo\n' +
      'mario.rossi@example.it;Rossi;Mario;studente;STU001;approved;si\n' +
      'laura.bianchi@example.it;Bianchi;Laura;docente;DOC42;approved;si\n';
    const result = await importUsersFromFile(Buffer.from(csv, 'utf8'), 'utenti.csv', 'text/csv');
    expect(result.parsed).toBe(2);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    const mario = await User.findOne({ where: { email: 'mario.rossi@example.it' } });
    expect(mario).toBeTruthy();
    expect(mario.role).toBe('studente');
    expect(mario.matricola).toBe('STU001');
    expect(mario.status).toBe('approved');
    expect(mario.isActive).toBe(true);
    expect(mario.passwordHash).toBeTruthy();
  });

  it('importa CSV con delimitatore "," (auto-detect)', async () => {
    const csv = 'Email,Cognome,Nome,Ruolo\n' + 'giuseppe.verdi@example.it,Verdi,Giuseppe,docente\n';
    const result = await importUsersFromFile(Buffer.from(csv, 'utf8'), 'utenti.csv', 'text/csv');
    expect(result.created).toBe(1);
    const user = await User.findOne({ where: { email: 'giuseppe.verdi@example.it' } });
    expect(user.role).toBe('docente');
  });

  it('importa XLSX', async () => {
    const buf = await makeXlsx([
      ['Email', 'Cognome', 'Nome', 'Ruolo'],
      ['anna.neri@example.it', 'Neri', 'Anna', 'studente'],
    ]);
    const result = await importUsersFromFile(buf, 'utenti.xlsx', '');
    expect(result.created).toBe(1);
    const user = await User.findOne({ where: { email: 'anna.neri@example.it' } });
    expect(user).toBeTruthy();
  });

  it('accetta role=admin (variante coerceRoleAdmin)', async () => {
    const csv = 'Email;Cognome;Nome;Ruolo\nadmin2@example.it;Admin;Two;admin\n';
    const result = await importUsersFromFile(Buffer.from(csv, 'utf8'), 'a.csv', 'text/csv');
    expect(result.created).toBe(1);
    const u = await User.findOne({ where: { email: 'admin2@example.it' } });
    expect(u.role).toBe('admin');
  });

  it('aggiorna utenti esistenti (idempotente per email)', async () => {
    // Primo import
    const csv1 =
      'Email;Cognome;Nome;Ruolo;Matricola\ncarlo@example.it;Bianchi;Carlo;studente;STU99\n';
    await importUsersFromFile(Buffer.from(csv1, 'utf8'), 'a.csv', 'text/csv');

    // Secondo import con cognome cambiato + matricola diversa
    const csv2 = 'Email;Cognome;Nome;Ruolo;Matricola\ncarlo@example.it;Verdi;Carlo;docente;DOC99\n';
    const result = await importUsersFromFile(Buffer.from(csv2, 'utf8'), 'a.csv', 'text/csv');
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);

    const u = await User.findOne({ where: { email: 'carlo@example.it' } });
    expect(u.lastName).toBe('Verdi');
    expect(u.role).toBe('docente');
    expect(u.matricola).toBe('DOC99');
  });

  it('salta righe senza email', async () => {
    const csv = 'Email;Cognome;Nome;Ruolo\n;Rossi;Mario;studente\nx@y.it;Verdi;Luigi;studente\n';
    const result = await importUsersFromFile(Buffer.from(csv, 'utf8'), 'a.csv', 'text/csv');
    expect(result.parsed).toBe(2);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].msg).toMatch(/email/i);
  });

  it('risolve courseCode → courseId', async () => {
    await Course.create({ code: 'CODI21', name: 'Pianoforte', levels: [], isActive: true });
    const csv =
      'Email;Cognome;Nome;Ruolo;CodiceCorso\n' +
      'pianista@example.it;Pianist;Pino;studente;CODI21\n';
    const result = await importUsersFromFile(Buffer.from(csv, 'utf8'), 'a.csv', 'text/csv');
    expect(result.created).toBe(1);
    const u = await User.findOne({ where: { email: 'pianista@example.it' } });
    expect(u.courseId).toBeTruthy();
  });

  it('genera warning per courseCode sconosciuto (utente comunque importato)', async () => {
    const csv =
      'Email;Cognome;Nome;Ruolo;CodiceCorso\n' + 'x@example.it;X;X;studente;CODE-INESISTENTE\n';
    const result = await importUsersFromFile(Buffer.from(csv, 'utf8'), 'a.csv', 'text/csv');
    expect(result.created).toBe(1);
    expect(result.errors.some((e) => /codice corso/i.test(e.msg))).toBe(true);
  });

  it('coerce isActive = false con "no"', async () => {
    const csv = 'Email;Cognome;Nome;Ruolo;Attivo\nu@example.it;U;U;studente;no\n';
    await importUsersFromFile(Buffer.from(csv, 'utf8'), 'a.csv', 'text/csv');
    const u = await User.findOne({ where: { email: 'u@example.it' } });
    expect(u.isActive).toBe(false);
  });

  it('default user.status = approved se Stato vuoto', async () => {
    const csv = 'Email;Cognome;Nome;Ruolo\nv@example.it;V;V;studente\n';
    await importUsersFromFile(Buffer.from(csv, 'utf8'), 'a.csv', 'text/csv');
    const u = await User.findOne({ where: { email: 'v@example.it' } });
    expect(u.status).toBe('approved');
  });

  it('rifiuta file vuoto con EMPTY_FILE', async () => {
    const csv = 'Email;Cognome;Nome;Ruolo\n';
    await expect(
      importUsersFromFile(Buffer.from(csv, 'utf8'), 'a.csv', 'text/csv'),
    ).rejects.toThrow(/almeno una riga/i);
  });
});
