import { describe, it, expect } from 'vitest';
import {
  computeDelta,
  computeRowStatus,
  emptyMapping,
  savedMappingApplicable,
  TARGET_FIELDS,
} from '@/lib/isidataMapping';

describe('savedMappingApplicable', () => {
  it('false senza mapping salvato o senza header disponibili', () => {
    expect(savedMappingApplicable(null, ['A'])).toBe(false);
    expect(savedMappingApplicable({ email: 'A' }, undefined)).toBe(false);
  });
  it('true se tutti gli header non-null sono presenti', () => {
    expect(savedMappingApplicable({ email: 'Mail', matricola: null }, ['Mail', 'X'])).toBe(true);
  });
  it('false se anche un solo header manca (case-sensitive)', () => {
    expect(savedMappingApplicable({ email: 'Mail', role: 'Ruolo' }, ['Mail'])).toBe(false);
    expect(savedMappingApplicable({ email: 'mail' }, ['Mail'])).toBe(false);
  });
  it('mapping tutto null è applicabile; stringhe vuote sono ignorate', () => {
    expect(savedMappingApplicable({ email: null, role: '' }, [])).toBe(true);
  });
});

describe('computeDelta', () => {
  it('undefined se non ci sono differenze', () => {
    expect(computeDelta({ email: 'Mail' }, { email: 'Mail' })).toBeUndefined();
    expect(computeDelta({}, {})).toBeUndefined();
  });
  it('include solo i target cambiati o aggiunti', () => {
    expect(
      computeDelta(
        { email: 'Mail2', matricola: 'Mat', role: null },
        { email: 'Mail', matricola: 'Mat' },
      ),
    ).toEqual({ email: 'Mail2' });
    expect(computeDelta({ role: 'Ruolo' }, {})).toEqual({ role: 'Ruolo' });
  });
  it('un target demappato non entra nel payload', () => {
    expect(computeDelta({ email: null }, { email: 'Mail' })).toBeUndefined();
    expect(computeDelta({ email: '' }, { email: 'Mail' })).toBeUndefined();
  });
  it('ignora chiavi sconosciute', () => {
    expect(computeDelta({ foo: 'X' }, {})).toBeUndefined();
  });
});

describe('emptyMapping', () => {
  it('ha tutti i target a null', () => {
    const m = emptyMapping();
    expect(Object.keys(m)).toEqual([...TARGET_FIELDS]);
    expect(Object.values(m).every((v) => v === null)).toBe(true);
  });
});

describe('computeRowStatus', () => {
  it('missing/optional se non mappato', () => {
    expect(computeRowStatus({ value: null, autoVal: 'A', isRequired: true })).toBe('missing');
    expect(computeRowStatus({ value: '', autoVal: null, isRequired: false })).toBe('optional');
  });
  it("auto se coincide con l'auto-detect, altrimenti manual", () => {
    expect(computeRowStatus({ value: 'A', autoVal: 'A', isRequired: true })).toBe('auto');
    expect(computeRowStatus({ value: 'B', autoVal: 'A', isRequired: false })).toBe('manual');
    expect(computeRowStatus({ value: 'B', autoVal: null, isRequired: false })).toBe('manual');
  });
});
