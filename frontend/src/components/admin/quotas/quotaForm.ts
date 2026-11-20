import { z } from 'zod';
import type { UpsertQuotaPayload } from '@/api/quotas';
import type { BookingQuota, QuotaScopeKind, Role } from '@/types';

export const ROLES: Role[] = ['admin', 'docente', 'studente'];
export const SCOPE_KINDS: QuotaScopeKind[] = [
  'roomType',
  'equipmentType',
  'room',
  'building',
  'global',
];
export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const quotaSchema = z
  .object({
    role: z.enum(['admin', 'docente', 'studente']),
    scopeKind: z.enum(['roomType', 'equipmentType', 'room', 'building', 'global']),
    scopeValue: z.string().optional(),
    maxHoursPerWeek: z.number().int().min(0).max(168),
    maxHoursPerDay: z.number().int().min(0).max(24),
    maxHoursPerMonth: z.number().int().min(0).max(744),
    maxBookings: z.number().int().min(0).max(999),
    daysOfWeek: z.array(z.number().int().min(0).max(6)),
    timeFrom: z.string().regex(TIME_REGEX, 'time_format').or(z.literal('')).optional(),
    timeTo: z.string().regex(TIME_REGEX, 'time_format').or(z.literal('')).optional(),
    isActive: z.boolean(),
  })
  .refine(
    (d) =>
      d.maxHoursPerWeek > 0 || d.maxHoursPerDay > 0 || d.maxHoursPerMonth > 0 || d.maxBookings > 0,
    { path: ['maxHoursPerWeek'], message: 'cap_required' },
  )
  .refine((d) => d.scopeKind === 'global' || (d.scopeValue && d.scopeValue.trim().length > 0), {
    path: ['scopeValue'],
    message: 'scope_required',
  })
  .refine((d) => (d.timeFrom && d.timeTo) ?? (!d.timeFrom && !d.timeTo), {
    path: ['timeTo'],
    message: 'time_pair',
  })
  .refine((d) => !d.timeFrom || !d.timeTo || d.timeFrom < d.timeTo, {
    path: ['timeTo'],
    message: 'time_order',
  });

export type QuotaFormValues = z.infer<typeof quotaSchema>;

export const DEFAULT_QUOTA_FORM: QuotaFormValues = {
  role: 'studente',
  scopeKind: 'roomType',
  scopeValue: '',
  maxHoursPerWeek: 4,
  maxHoursPerDay: 2,
  maxHoursPerMonth: 0,
  maxBookings: 0,
  daysOfWeek: [],
  timeFrom: '',
  timeTo: '',
  isActive: true,
};

export function quotaToFormValues(quota: BookingQuota): QuotaFormValues {
  return {
    role: quota.role,
    scopeKind: quota.scopeKind,
    scopeValue: quota.scopeKind === 'global' ? '' : quota.scopeValue,
    maxHoursPerWeek: quota.maxHoursPerWeek,
    maxHoursPerDay: quota.maxHoursPerDay,
    maxHoursPerMonth: quota.maxHoursPerMonth,
    maxBookings: quota.maxBookings,
    daysOfWeek: quota.daysOfWeek,
    timeFrom: quota.timeFrom ?? '',
    timeTo: quota.timeTo ?? '',
    isActive: quota.isActive,
  };
}

export function formValuesToPayload(values: QuotaFormValues): UpsertQuotaPayload {
  return {
    role: values.role,
    scopeKind: values.scopeKind,
    scopeValue: values.scopeKind === 'global' ? '*' : (values.scopeValue ?? '').trim(),
    maxHoursPerWeek: values.maxHoursPerWeek,
    maxHoursPerDay: values.maxHoursPerDay,
    maxHoursPerMonth: values.maxHoursPerMonth,
    maxBookings: values.maxBookings,
    daysOfWeek: values.daysOfWeek,
    timeFrom: values.timeFrom ?? null,
    timeTo: values.timeTo ?? null,
    isActive: values.isActive,
  };
}
