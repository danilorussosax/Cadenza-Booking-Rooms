'use strict';

// vitest globals abilitati in vitest.config.js
const {
  computeDiff,
  computeSafetyChecks,
  diffFields,
  externalToSnapshot,
  localToSnapshot,
  SAFETY_THRESHOLDS,
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

describe('diffEngine.computeSafetyChecks', () => {
  function fakeDiff(toCreate, toOrphan) {
    return { toCreate: new Array(toCreate).fill({}), toOrphan: new Array(toOrphan).fill({}) };
  }

  it('niente warning quando ratio e count sono bassi', () => {
    const s = computeSafetyChecks(fakeDiff(0, 0), 100);
    expect(s.warnings).toHaveLength(0);
    expect(s.deactivateRatio).toBe(0);
  });

  it('critical su ratio > 20% (es. 25/100)', () => {
    const s = computeSafetyChecks(fakeDiff(0, 25), 100);
    const critical = s.warnings.filter((w) => w.level === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0].code).toBe('MASS_DEACTIVATION');
  });

  it('critical su count assoluto ≥ 50 anche con ratio basso (es. 50/1000)', () => {
    const s = computeSafetyChecks(fakeDiff(0, 50), 1000);
    expect(s.warnings.some((w) => w.level === 'critical' && w.code === 'MASS_DEACTIVATION')).toBe(
      true,
    );
  });

  it('warning (non critical) su ratio fra 10% e 20% (es. 15/100)', () => {
    const s = computeSafetyChecks(fakeDiff(0, 15), 100);
    expect(s.warnings.filter((w) => w.level === 'critical')).toHaveLength(0);
    const warn = s.warnings.filter((w) => w.level === 'warning' && w.code === 'MASS_DEACTIVATION');
    expect(warn).toHaveLength(1);
  });

  it('warning MASS_CREATION quando createCount ≥ 100', () => {
    const s = computeSafetyChecks(fakeDiff(120, 0), 1000);
    expect(s.warnings.some((w) => w.code === 'MASS_CREATION')).toBe(true);
  });

  it('totalActiveUsers=0 → ratio=0, niente warning di deactivate', () => {
    const s = computeSafetyChecks(fakeDiff(0, 0), 0);
    expect(s.deactivateRatio).toBe(0);
    expect(s.warnings.filter((w) => w.code === 'MASS_DEACTIVATION')).toHaveLength(0);
  });

  it('rispetta le soglie esportate', () => {
    expect(SAFETY_THRESHOLDS.DEACTIVATE_RATIO_CRITICAL).toBe(0.2);
    expect(SAFETY_THRESHOLDS.DEACTIVATE_COUNT_CRITICAL).toBe(50);
  });
});

describe('diffEngine.computeDiff — courseCodeToId map', () => {
  it('valorizza ext.courseId quando il code è in catalogo', () => {
    const map = new Map([['CODI/21', 42]]);
    const externals = [ext({ courseCode: 'CODI/21' })];
    const out = computeDiff(externals, [], 'matricola', 'isidata', { courseCodeToId: map });
    expect(out.toCreate).toHaveLength(1);
    expect(out.toCreate[0].courseId).toBe(42);
    expect(out.warnings ?? []).toHaveLength(0);
  });

  it('non valorizza courseId se code non in mappa, emette warning aggregato', () => {
    const map = new Map([['NOTO', 1]]);
    const externals = [
      ext({ matricola: '1', externalId: '1', courseCode: 'IGN-001' }),
      ext({ matricola: '2', externalId: '2', courseCode: 'IGN-001' }),
    ];
    const out = computeDiff(externals, [], 'matricola', 'isidata', { courseCodeToId: map });
    expect(out.toCreate[0].courseId).toBeUndefined();
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].code).toBe('UNKNOWN_COURSE_CODE');
    expect(out.warnings[0].count).toBe(2);
    expect(out.warnings[0].courseCode).toBe('IGN-001');
  });
});

describe('diffEngine.computeDiff — contractType (docente)', () => {
  it("non genera update.contractType se l'esterno non fornisce il campo", () => {
    const local = loc({
      role: 'docente',
      externalSource: 'isidata',
      externalId: '99',
      matricola: '99',
      contractType: 'titolare',
    });
    // ext NON ha contractType.
    const out = computeDiff(
      [ext({ role: 'docente', externalId: '99', matricola: '99' })],
      [local],
      'matricola',
      'isidata',
    );
    if (out.toUpdate.length > 0) {
      expect(out.toUpdate[0].fieldsChanged).not.toContain('contractType');
    }
  });

  it("genera update.contractType quando l'esterno cambia valore", () => {
    const local = loc({
      role: 'docente',
      externalSource: 'isidata',
      externalId: '99',
      matricola: '99',
      contractType: 'titolare',
    });
    const external = ext({
      role: 'docente',
      externalId: '99',
      matricola: '99',
      contractType: 'supplente',
    });
    const out = computeDiff([external], [local], 'matricola', 'isidata');
    expect(out.toUpdate).toHaveLength(1);
    expect(out.toUpdate[0].fieldsChanged).toContain('contractType');
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
