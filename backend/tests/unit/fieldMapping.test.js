'use strict';

/**
 * Unit: services/integrations/isidata/fieldMapping.js — porta branches da
 * 56% a >=60%. Helper di import Isidata, pure functions.
 */

const {
  resolveHeader,
  buildHeaderMap,
  coerceStatus,
  coerceRole,
  applyMapping,
  sanitizeOverrides,
} = require('../../services/integrations/isidata/fieldMapping');

describe('fieldMapping.coerceStatus', () => {
  it('valori "active" → "active"', () => {
    for (const v of [
      'attivo',
      'iscritto',
      's',
      'si',
      'sì',
      'true',
      '1',
      'a',
      'active',
      'in corso',
      'incorso',
    ]) {
      expect(coerceStatus(v)).toBe('active');
    }
  });

  it('valori "inactive"', () => {
    for (const v of [
      'cessato',
      'non iscritto',
      'noniscritto',
      'n',
      'no',
      'false',
      '0',
      'i',
      'inactive',
      'disattivato',
      'sospeso',
    ]) {
      expect(coerceStatus(v)).toBe('inactive');
    }
  });

  it('vuoto/null/undefined/sconosciuto → default "active"', () => {
    expect(coerceStatus(null)).toBe('active');
    expect(coerceStatus(undefined)).toBe('active');
    expect(coerceStatus('')).toBe('active');
    expect(coerceStatus('   ')).toBe('active');
    expect(coerceStatus('inventato')).toBe('active');
  });

  it('case insensitive + trim', () => {
    expect(coerceStatus('  ATTIVO ')).toBe('active');
    expect(coerceStatus('CESSATO')).toBe('inactive');
  });
});

describe('fieldMapping.coerceRole', () => {
  it('"docente" / "professore" → docente', () => {
    expect(coerceRole('Docente')).toBe('docente');
    expect(coerceRole('Professore')).toBe('docente');
    expect(coerceRole('DOC')).toBe('docente');
    expect(coerceRole('prof.')).toBe('docente');
  });

  it('"studente" / "allievo" / "iscritto" → studente', () => {
    expect(coerceRole('Studente')).toBe('studente');
    expect(coerceRole('Allievo')).toBe('studente');
    expect(coerceRole('iscritto')).toBe('studente');
    expect(coerceRole('STUD123')).toBe('studente');
  });

  it('default → studente', () => {
    expect(coerceRole(null)).toBe('studente');
    expect(coerceRole(undefined)).toBe('studente');
    expect(coerceRole('')).toBe('studente');
    expect(coerceRole('vattelapesca')).toBe('studente');
    expect(coerceRole(42)).toBe('studente');
  });
});

describe('fieldMapping.resolveHeader', () => {
  it('match su alias di default (case-insensitive)', () => {
    expect(resolveHeader('email', ['Email', 'Nome'])).toBe('Email');
    expect(resolveHeader('firstName', ['NOME', 'Cognome'])).toBe('NOME');
  });

  it('match su alias con accenti / spazi (normalize)', () => {
    expect(resolveHeader('email', ['Email Istituzionale'])).toBe('Email Istituzionale');
    expect(resolveHeader('birthDate', ['Data di Nascita'])).toBe('Data di Nascita');
  });

  it('override admin vince sugli alias default', () => {
    const headers = ['Email', 'CampoCustom'];
    const r = resolveHeader('email', headers, { email: 'CampoCustom' });
    expect(r).toBe('CampoCustom');
  });

  it('override admin che non matcha alcun header → fallback default', () => {
    const r = resolveHeader('email', ['Email'], { email: 'NonEsistente' });
    expect(r).toBe('Email');
  });

  it('nessun match → null', () => {
    expect(resolveHeader('email', ['ColonnaA', 'ColonnaB'])).toBeNull();
  });

  it('target sconosciuto → null', () => {
    expect(resolveHeader('inventato', ['A', 'B'])).toBeNull();
  });
});

describe('fieldMapping.buildHeaderMap', () => {
  it('mappa multipli target', () => {
    const map = buildHeaderMap(['Matricola', 'Email', 'Nome', 'Cognome', 'Ruolo']);
    expect(map.externalId).toBe('Matricola');
    expect(map.email).toBe('Email');
    expect(map.firstName).toBe('Nome');
    expect(map.lastName).toBe('Cognome');
    expect(map.role).toBe('Ruolo');
  });

  it('header non riconosciuti vengono ignorati', () => {
    const map = buildHeaderMap(['CampoIgnoto', 'ColonnaX']);
    expect(Object.keys(map).length).toBe(0);
  });
});

describe('fieldMapping.applyMapping', () => {
  const map = {
    externalId: 'Matricola',
    email: 'Email',
    firstName: 'Nome',
    lastName: 'Cognome',
    role: 'Ruolo',
    status: 'Stato',
  };

  it('riga normale: produce user canonico', () => {
    const r = applyMapping(
      {
        Matricola: 'M001',
        Email: 'a@b.it',
        Nome: 'Mario',
        Cognome: 'Rossi',
        Ruolo: 'Studente',
        Stato: 'attivo',
      },
      map,
    );
    expect(r.ok).toBe(true);
    expect(r.user.externalId).toBe('M001');
    expect(r.user.email).toBe('a@b.it');
    expect(r.user.role).toBe('studente');
    expect(r.user.status).toBe('active');
  });

  it('email viene normalizzata a lowercase', () => {
    const r = applyMapping({ Matricola: 'M', Email: 'A@B.IT', Nome: 'A', Cognome: 'B' }, map);
    expect(r.user.email).toBe('a@b.it');
  });

  it('senza externalId né email → ok:false', () => {
    const r = applyMapping({ Nome: 'A', Cognome: 'B' }, map);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/matricola né email/i);
  });

  it('senza email ma con externalId → ok', () => {
    const r = applyMapping({ Matricola: 'M', Nome: 'A', Cognome: 'B' }, map);
    expect(r.ok).toBe(true);
    expect(r.user.email).toBeNull();
  });

  it('senza externalId ma con email → genera resolvedExternalId email_<hash>', () => {
    const r = applyMapping({ Email: 'a@x.it', Nome: 'A', Cognome: 'B' }, map);
    expect(r.ok).toBe(true);
    expect(r.user.externalId).toMatch(/^email_[0-9a-f]+$/);
  });

  it('senza nome/cognome → ok:false', () => {
    const r = applyMapping({ Matricola: 'M', Email: 'a@b.it' }, map);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/nome o cognome/i);
  });

  it('fallback "Nominativo" (Cognome Nome) split su spazio', () => {
    const mapNoNames = { ...map };
    delete mapNoNames.firstName;
    delete mapNoNames.lastName;
    const r = applyMapping({ Matricola: 'M', Nominativo: 'Rossi Mario' }, mapNoNames);
    expect(r.ok).toBe(true);
    expect(r.user.lastName).toBe('Rossi');
    expect(r.user.firstName).toBe('Mario');
  });

  it('fallback "Nominativo" con 3+ parole: cognome = primo, nome = resto', () => {
    const mapNoNames = { externalId: 'M' };
    const r = applyMapping({ M: 'X1', Nominativo: 'De Luca Maria Pia' }, mapNoNames);
    expect(r.ok).toBe(true);
    expect(r.user.lastName).toBe('De');
    expect(r.user.firstName).toBe('Luca Maria Pia');
  });

  it('matricola separata da externalId', () => {
    const m = { ...map, matricola: 'NumeroMatr' };
    const r = applyMapping(
      { Matricola: 'M', NumeroMatr: '12345', Email: 'a@b.it', Nome: 'A', Cognome: 'B' },
      m,
    );
    expect(r.user.externalId).toBe('M');
    expect(r.user.matricola).toBe('12345');
  });
});

describe('fieldMapping.sanitizeOverrides', () => {
  it('null/undefined → null', () => {
    expect(sanitizeOverrides(null)).toBeNull();
    expect(sanitizeOverrides(undefined)).toBeNull();
  });

  it('non-object (string/array) → throw VALIDATION_FAILED', () => {
    expect(() => sanitizeOverrides('not-obj')).toThrow(/oggetto/i);
    expect(() => sanitizeOverrides([1, 2])).toThrow(/oggetto/i);
    try {
      sanitizeOverrides(42);
    } catch (e) {
      expect(e.code).toBe('VALIDATION_FAILED');
    }
  });

  it('keep solo chiavi note', () => {
    const out = sanitizeOverrides({
      email: 'EmailFile',
      role: 'TipoUtente',
      INVENTATA: 'X',
    });
    expect(out).toEqual({ email: 'EmailFile', role: 'TipoUtente' });
  });

  it('valori non stringa droppati silently', () => {
    expect(sanitizeOverrides({ email: 42, role: 'OK' })).toEqual({ role: 'OK' });
    expect(sanitizeOverrides({ email: null, role: ['x'] })).toBeNull();
  });

  it('stringhe vuote/troppo lunghe droppate', () => {
    const long = 'x'.repeat(101);
    expect(sanitizeOverrides({ email: '', role: long })).toBeNull();
  });

  it('output trim sui valori', () => {
    expect(sanitizeOverrides({ email: '  Email  ' })).toEqual({ email: 'Email' });
  });

  it('output {} → null (nessuna chiave utile)', () => {
    expect(sanitizeOverrides({ inventata: 'X' })).toBeNull();
  });
});
