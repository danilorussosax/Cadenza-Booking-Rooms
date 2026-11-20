import { z } from 'zod';
import type { BookingRule } from '@/types';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ruleFormSchema = z.object({
  maxActiveBookings: z.number().int().min(0),
  maxHoursPerWeek: z.number().int().min(0),
  maxHoursPerDay: z.number().int().min(0),
  maxBookingDurationMinutes: z.number().int().min(15),
  minBookingDurationMinutes: z.number().int().min(15),
  maxAdvanceDays: z.number().int().min(0),
  minAdvanceHours: z.number().int().min(0),
  cancellationDeadlineHours: z.number().int().min(0),
  minIntervalBetweenBookingsMinutes: z.number().int().min(0),
  allowRecurring: z.boolean(),
  allowNightHours: z.boolean(),
  allowedStartTime: z.string().regex(TIME_REGEX, 'Formato HH:mm'),
  allowedEndTime: z.string().regex(TIME_REGEX, 'Formato HH:mm'),
});

export type FormValues = z.infer<typeof ruleFormSchema>;

export function defaultsFor(): FormValues {
  return {
    maxActiveBookings: 5,
    maxHoursPerWeek: 10,
    maxHoursPerDay: 4,
    maxBookingDurationMinutes: 120,
    minBookingDurationMinutes: 30,
    maxAdvanceDays: 14,
    minAdvanceHours: 0,
    cancellationDeadlineHours: 2,
    minIntervalBetweenBookingsMinutes: 0,
    allowRecurring: false,
    allowNightHours: false,
    allowedStartTime: '08:00',
    allowedEndTime: '22:00',
  };
}

export function toFormValues(rule: BookingRule): FormValues {
  return {
    maxActiveBookings: rule.maxActiveBookings,
    maxHoursPerWeek: rule.maxHoursPerWeek,
    maxHoursPerDay: rule.maxHoursPerDay,
    maxBookingDurationMinutes: rule.maxBookingDurationMinutes,
    minBookingDurationMinutes: rule.minBookingDurationMinutes,
    maxAdvanceDays: rule.maxAdvanceDays,
    minAdvanceHours: rule.minAdvanceHours,
    cancellationDeadlineHours: rule.cancellationDeadlineHours,
    minIntervalBetweenBookingsMinutes: rule.minIntervalBetweenBookingsMinutes,
    allowRecurring: rule.allowRecurring,
    allowNightHours: rule.allowNightHours,
    allowedStartTime: rule.allowedStartTime,
    allowedEndTime: rule.allowedEndTime,
  };
}

// =====================================================
// Eccezioni alla regola del ruolo
