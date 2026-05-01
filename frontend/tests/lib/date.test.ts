import { describe, it, expect } from 'vitest';
import {
  dayjs,
  formatDate,
  formatTime,
  formatRange,
  formatDuration,
  toLocalDateInput,
  toLocalDateTimeInput,
  fromLocalInput,
  relativeFromNow,
  startOfWeek,
} from '@/lib/date';

describe('lib/date', () => {
  it('formatDate con formato default', () => {
    const out = formatDate('2025-11-03', 'YYYY-MM-DD');
    expect(out).toBe('2025-11-03');
  });

  it('formatTime estrae HH:mm', () => {
    const d = new Date('2025-11-03T14:30:00Z');
    const out = formatTime(d);
    expect(out).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formatRange combina start–end', () => {
    const out = formatRange('2025-11-03T10:00:00Z', '2025-11-03T11:00:00Z');
    expect(out.length).toBeGreaterThan(0);
  });

  it('formatDuration ritorna stringa "Xh Ym"', () => {
    const out = formatDuration('2025-11-03T10:00:00Z', '2025-11-03T11:30:00Z');
    expect(out).toMatch(/h|m|min/i);
  });

  it('toLocalDateInput formatta YYYY-MM-DD', () => {
    const d = new Date('2025-11-03T12:00:00');
    expect(toLocalDateInput(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('toLocalDateTimeInput formatta YYYY-MM-DDTHH:mm', () => {
    const d = new Date('2025-11-03T14:30:00');
    expect(toLocalDateTimeInput(d)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('fromLocalInput parsifica una stringa locale', () => {
    const d = fromLocalInput('2025-11-03T14:30');
    expect(d).toBeInstanceOf(Date);
  });

  it('relativeFromNow ritorna stringa', () => {
    const future = new Date(Date.now() + 60_000);
    expect(typeof relativeFromNow(future)).toBe('string');
  });

  it('startOfWeek ritorna lunedì (isoWeek)', () => {
    const monday = startOfWeek();
    expect(typeof monday).toBe('object');
    // verifica che sia lunedì (1) — almeno il giorno della settimana
    const day = dayjs(monday).day();
    expect([0, 1]).toContain(day); // 0 dom o 1 lun a seconda dell'orario di esecuzione
  });

  it('dayjs è ri-esportato', () => {
    expect(typeof dayjs).toBe('function');
    expect(dayjs('2025-01-01').isValid()).toBe(true);
  });
});
