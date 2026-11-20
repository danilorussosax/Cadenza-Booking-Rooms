import { describe, expect, it } from 'vitest';
import type { MonteOreSchedule } from '@/api/monteOre';
import { scheduleToForm } from '@/lib/monteOreSchedule';

describe('scheduleToForm', () => {
  it('usa i default senza riga esistente', () => {
    expect(scheduleToForm(null)).toEqual({
      roomId: null,
      dayOfWeek: 1,
      startTime: '14:00',
      endTime: '16:00',
      bookingType: 'lezione',
      purpose: '',
      notes: '',
    });
  });

  it('copia i valori della riga esistente', () => {
    const s = {
      roomId: 7,
      dayOfWeek: 3,
      startTime: '10:00',
      endTime: '12:30',
      bookingType: 'prova',
      purpose: 'Piano',
      notes: 'n',
    } as MonteOreSchedule;
    expect(scheduleToForm(s)).toEqual({
      roomId: 7,
      dayOfWeek: 3,
      startTime: '10:00',
      endTime: '12:30',
      bookingType: 'prova',
      purpose: 'Piano',
      notes: 'n',
    });
  });

  it('normalizza null in default per purpose/notes', () => {
    const s = {
      roomId: null,
      dayOfWeek: 0,
      startTime: '08:00',
      endTime: '09:00',
      bookingType: 'lezione',
      purpose: null,
      notes: null,
    } as MonteOreSchedule;
    const f = scheduleToForm(s);
    expect(f.purpose).toBe('');
    expect(f.notes).toBe('');
    expect(f.dayOfWeek).toBe(0);
  });
});
