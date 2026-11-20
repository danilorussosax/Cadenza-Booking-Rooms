import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUOTA_FORM,
  formValuesToPayload,
  quotaSchema,
  quotaToFormValues,
} from '@/components/admin/quotas/quotaForm';
import type { BookingQuota } from '@/types';

describe('quotaForm', () => {
  it('scope globale → scopeValue "*"', () => {
    const p = formValuesToPayload({ ...DEFAULT_QUOTA_FORM, scopeKind: 'global', scopeValue: 'x' });
    expect(p.scopeValue).toBe('*');
    expect(p.timeFrom).toBe('');
  });

  it('scopeValue viene trimmato per scope non globali', () => {
    const p = formValuesToPayload({ ...DEFAULT_QUOTA_FORM, scopeValue: '  piano  ' });
    expect(p.scopeValue).toBe('piano');
  });

  it('quotaToFormValues azzera scopeValue per global e normalizza gli orari null', () => {
    const q = {
      role: 'docente',
      scopeKind: 'global',
      scopeValue: '*',
      maxHoursPerWeek: 3,
      maxHoursPerDay: 0,
      maxHoursPerMonth: 0,
      maxBookings: 0,
      daysOfWeek: [1],
      timeFrom: null,
      timeTo: null,
      isActive: true,
    } as unknown as BookingQuota;
    const v = quotaToFormValues(q);
    expect(v.scopeValue).toBe('');
    expect(v.timeFrom).toBe('');
    expect(v.daysOfWeek).toEqual([1]);
  });

  it('schema: richiede almeno un cap, scope e coppia/ordine orari', () => {
    const parse = (o: object) => quotaSchema.safeParse({ ...DEFAULT_QUOTA_FORM, ...o });
    expect(parse({ maxHoursPerWeek: 0, maxHoursPerDay: 0, scopeValue: 'a' }).success).toBe(false);
    expect(parse({ scopeValue: '' }).success).toBe(false);
    expect(parse({ scopeValue: 'a', timeFrom: '10:00' }).success).toBe(false);
    expect(parse({ scopeValue: 'a', timeFrom: '12:00', timeTo: '10:00' }).success).toBe(false);
    expect(parse({ scopeValue: 'a', timeFrom: '10:00', timeTo: '12:00' }).success).toBe(true);
  });
});
