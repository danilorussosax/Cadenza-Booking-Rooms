import { describe, expect, it } from 'vitest';
import { defaultsFor, ruleFormSchema, toFormValues } from '@/lib/ruleForm';
import type { BookingRule } from '@/types';

describe('ruleForm', () => {
  it('i default superano la validazione dello schema', () => {
    expect(ruleFormSchema.safeParse(defaultsFor()).success).toBe(true);
  });

  it('rifiuta orari non HH:mm e durate minime < 15', () => {
    expect(ruleFormSchema.safeParse({ ...defaultsFor(), allowedStartTime: '8:00' }).success).toBe(
      false,
    );
    expect(ruleFormSchema.safeParse({ ...defaultsFor(), allowedEndTime: '24:00' }).success).toBe(
      false,
    );
    expect(
      ruleFormSchema.safeParse({ ...defaultsFor(), minBookingDurationMinutes: 10 }).success,
    ).toBe(false);
  });

  it('toFormValues copia solo i campi del form dalla regola', () => {
    const rule = {
      ...defaultsFor(),
      id: 5,
      role: 'docente',
      maxActiveBookings: 9,
      allowedEndTime: '23:30',
    } as unknown as BookingRule;
    const v = toFormValues(rule);
    expect(v.maxActiveBookings).toBe(9);
    expect(v.allowedEndTime).toBe('23:30');
    expect(Object.keys(v).sort()).toEqual(Object.keys(defaultsFor()).sort());
  });
});
