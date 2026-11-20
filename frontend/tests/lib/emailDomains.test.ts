import { describe, it, expect } from 'vitest';
import { parseAllowedDomains } from '@/lib/emailDomains';

describe('parseAllowedDomains', () => {
  it('separa per virgola, punto e virgola e spazi', () => {
    expect(parseAllowedDomains('a.it, b.it;c.it  d.it\ne.it')).toEqual([
      'a.it',
      'b.it',
      'c.it',
      'd.it',
      'e.it',
    ]);
  });
  it('lowercase, toglie @ iniziale e deduplica mantenendo il primo ordine', () => {
    expect(parseAllowedDomains('@Unimi.IT, unimi.it, @B.it')).toEqual(['unimi.it', 'b.it']);
  });
  it('input vuoti o non stringa danno lista vuota', () => {
    expect(parseAllowedDomains('')).toEqual([]);
    expect(parseAllowedDomains('  ,; ')).toEqual([]);
    expect(parseAllowedDomains(null)).toEqual([]);
    expect(parseAllowedDomains(undefined)).toEqual([]);
  });
  it('un "@" isolato viene scartato', () => {
    expect(parseAllowedDomains('@, a.it')).toEqual(['a.it']);
  });
});
