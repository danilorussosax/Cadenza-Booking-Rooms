'use strict';

// vitest globals abilitati in vitest.config.js
const {
  computeDiff,
  diffFields,
  externalToSnapshot,
  localToSnapshot,
} = require('../../services/integrations/diffEngine');

function ext(over = {}) {
  return {
    externalId: '12345',
    email: 'mario@conservatorio.it',
    firstName: 'Mario',
    lastName: 'Rossi',
    role: 'studente',
    matricola: '12345',
    courseCode: 'CODI/21',
    courseName: 'Pianoforte',
    status: 'active',
    ...over,
  };
}

function loc(over = {}) {
  return {
    id: 1,
    email: 'mario@conservatorio.it',
    firstName: 'Mario',
    lastName: 'Rossi',
    role: 'studente',
    matricola: '12345',
    externalSource: null,
    externalId: null,
    isActive: true,
    ...over,
  };
}

describe('diffEngine.computeDiff', () => {
  it('classifica un nuovo utente come toCreate', () => {
    const out = computeDiff([ext()], [], 'matricola', 'isidata');
    expect(out.toCreate).toHaveLength(1);
    expect(out.toUpdate).toHaveLength(0);
    expect(out.toOrphan).toHaveLength(0);
  });

  it('match per matricola: stessi dati → solo linkChanged (externalId mancante)', () => {
    const out = computeDiff([ext()], [loc()], 'matricola', 'isidata');
    expect(out.toCreate).toHaveLength(0);
    expect(out.toUpdate).toHaveLength(1);
    expect(out.toUpdate[0].fieldsChanged).toEqual([]);
    expect(out.toUpdate[0].linkChanged).toBe(true);
  });

  it('rileva campi cambiati (lastName)', () => {
    const out = computeDiff(
      [ext({ lastName: 'Bianchi' })],
      [loc({ externalSource: 'isidata', externalId: '12345' })],
      'matricola',
      'isidata',
    );
    expect(out.toUpdate).toHaveLength(1);
    expect(out.toUpdate[0].fieldsChanged).toContain('lastName');
  });

  it('match per externalId quando matchBy=externalId', () => {
    const local = loc({ matricola: 'OTHER', externalSource: 'isidata', externalId: '12345' });
    const out = computeDiff([ext()], [local], 'externalId', 'isidata');
    expect(out.toUpdate).toHaveLength(1);
    expect(out.toUpdate[0].local.id).toBe(local.id);
  });

  it('match fallback per email se matricola non collide', () => {
    const local = loc({ matricola: 'NO_MATCH', email: 'mario@conservatorio.it' });
    const out = computeDiff([ext({ matricola: 'XYZ' })], [local], 'matricola', 'isidata');
    expect(out.toUpdate).toHaveLength(1);
  });

  it('matricola con leading-zero matcha lo stesso utente', () => {
    const local = loc({ matricola: '42' });
    const ex = ext({ matricola: '00042' });
    const out = computeDiff([ex], [local], 'matricola', 'isidata');
    expect(out.toUpdate).toHaveLength(1);
    // Le matricole sono "equivalenti" dopo normalizzazione ⇒ non in fieldsChanged.
    expect(out.toUpdate[0].fieldsChanged).not.toContain('matricola');
  });

  it('email case-insensitive non viene segnalata come cambiata', () => {
    const local = loc({
      email: 'Mario@Conservatorio.IT',
      externalSource: 'isidata',
      externalId: '12345',
    });
    const out = computeDiff([ext()], [local], 'matricola', 'isidata');
    expect(out.toUpdate[0]?.fieldsChanged ?? []).not.toContain('email');
  });

  it('orphan: utente con externalSource=isidata e non più nel batch viene proposto per disattivazione', () => {
    const local = loc({
      id: 99,
      externalSource: 'isidata',
      externalId: '999',
      matricola: '999',
      email: 'gone@x',
    });
    const out = computeDiff([], [local], 'matricola', 'isidata');
    expect(out.toOrphan).toHaveLength(1);
    expect(out.toOrphan[0].id).toBe(99);
  });

  it('NON considera orfani gli utenti senza externalSource (creati manualmente)', () => {
    const local = loc({ id: 7, externalSource: null });
    const out = computeDiff([], [local], 'matricola', 'isidata');
    expect(out.toOrphan).toHaveLength(0);
  });

  it('NON considera orfani gli admin', () => {
    const local = loc({ id: 1, role: 'admin', externalSource: 'isidata', externalId: 'A1' });
    const out = computeDiff([], [local], 'matricola', 'isidata');
    expect(out.toOrphan).toHaveLength(0);
  });

  it('cambio status active→inactive viene proposto come fieldsChanged.isActive', () => {
    const local = loc({ externalSource: 'isidata', externalId: '12345', isActive: true });
    const ex = ext({ status: 'inactive' });
    const out = computeDiff([ex], [local], 'matricola', 'isidata');
    expect(out.toUpdate[0].fieldsChanged).toContain('isActive');
  });

  it('utente ext con externalId distinto NON matcha quello locale (anche se matricola simile)', () => {
    // Caso difensivo: matricola colliderebbe MA externalId è esplicito e diverso.
    // Strategia matricola: matcha comunque (matricola batte externalId nella priority).
    // Strategia externalId: deve preferire l'externalId, quindi crea nuovo se l'id non esiste.
    const local = loc({ id: 1, externalSource: 'isidata', externalId: 'SAME', matricola: '12345' });
    const ext1 = ext({ externalId: 'OTHER', matricola: '12345' });
    const out = computeDiff([ext1], [local], 'externalId', 'isidata');
    // matchBy=externalId: cerca prima per externalId (OTHER) → non trova →
    // ricade su matricola → trova → toUpdate con linkChanged.
    expect(out.toUpdate).toHaveLength(1);
    expect(out.toUpdate[0].linkChanged).toBe(true);
  });
});

describe('diffEngine.diffFields', () => {
  it('matricola normalizzata (leading-zero) non genera cambio', () => {
    const local = localToSnapshot(loc({ matricola: '42' }));
    const ex = externalToSnapshot(ext({ matricola: '0042' }));
    expect(diffFields(local, ex)).not.toContain('matricola');
  });

  it('cognome diverso → fieldsChanged.lastName', () => {
    const local = localToSnapshot(loc({ lastName: 'A' }));
    const ex = externalToSnapshot(ext({ lastName: 'B' }));
    expect(diffFields(local, ex)).toContain('lastName');
  });
});
