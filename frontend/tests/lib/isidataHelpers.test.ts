import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildProviderTk,
  changedSummary,
  formatPrimitive,
  mergeSavedMapping,
  readSavedMapping,
  saveMappingToLs,
} from '@/pages/admin/integrations/isidata/isidataHelpers';
import type { ToUpdateItem } from '@/api/integrations';

describe('isidataHelpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('formatPrimitive gestisce null/primitivi/oggetti', () => {
    expect(formatPrimitive(null)).toBe('—');
    expect(formatPrimitive('a')).toBe('a');
    expect(formatPrimitive(3)).toBe('3');
    expect(formatPrimitive({})).toBe('?');
  });

  it('changedSummary elenca i campi cambiati e externalId', () => {
    const u = {
      local: { email: 'a@x' },
      external: { email: 'b@x' },
      fieldsChanged: ['email'],
      linkChanged: true,
    } as unknown as ToUpdateItem;
    expect(changedSummary(u)).toBe('email: a@x → b@x · externalId');
    expect(changedSummary({ ...u, fieldsChanged: [], linkChanged: false })).toBe('—');
  });

  it('save/read mapping su localStorage; JSON non valido → null', () => {
    saveMappingToLs({ email: 'Mail' });
    expect(readSavedMapping()).toEqual({ email: 'Mail' });
    localStorage.setItem('isidata.lastMapping', '[1]');
    expect(readSavedMapping()).toBeNull();
    localStorage.setItem('isidata.lastMapping', '{oops');
    expect(readSavedMapping()).toBeNull();
  });

  it('mergeSavedMapping usa il salvato solo se applicabile agli header', () => {
    const eff = { email: 'E', matricola: 'M' };
    expect(mergeSavedMapping(eff, null, ['E'])).toBe(eff);
    expect(mergeSavedMapping(eff, { email: 'Zzz' }, ['E', 'M'])).toBe(eff);
    expect(mergeSavedMapping(eff, { email: 'M' }, ['E', 'M'])).toEqual({
      email: 'M',
      matricola: 'M',
    });
  });

  it('buildProviderTk prova la chiave del provider e ricade su isidata', () => {
    const t = ((key: string, opts?: { defaultValue?: string }) =>
      key === 'integrations.esse3.a' ? 'ESSE3-A' : (opts?.defaultValue ?? key)) as never;
    expect(buildProviderTk(t, 'esse3')('a')).toBe('ESSE3-A');
    expect(buildProviderTk(t, 'esse3')('b')).toBe('integrations.isidata.b');
    expect(buildProviderTk(t, 'isidata')('a')).toBe('integrations.isidata.a');
  });
});
