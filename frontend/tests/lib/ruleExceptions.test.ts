import { describe, it, expect } from 'vitest';
import {
  blankException,
  exceptionSummary,
  fromException,
  isPastOnlyRange,
  roleLabel,
  toggleDay,
  validateException,
  type ExceptionFormState,
} from '@/lib/ruleExceptions';
import type { BookingRuleException } from '@/types';

const exc = (over: Record<string, unknown>): BookingRuleException =>
  ({
    id: 1,
    role: 'all',
    name: 'X',
    kind: 'block',
    roomId: null,
    daysOfWeek: null,
    dateFrom: null,
    dateTo: null,
    startTime: null,
    endTime: null,
    maxHoursInWindow: null,
    isActive: true,
    notes: null,
    ...over,
  }) as unknown as BookingRuleException;

const form = (over: Partial<ExceptionFormState>): ExceptionFormState => ({
  ...blankException('all'),
  name: 'Pausa',
  ...over,
});

describe('exceptionSummary', () => {
  it('Sempre attiva senza vincoli', () => {
    expect(exceptionSummary(exc({}))).toBe('Sempre attiva');
  });
  it('data singola, range, solo inizio, solo fine', () => {
    expect(exceptionSummary(exc({ dateFrom: '2026-01-01', dateTo: '2026-01-01' }))).toBe(
      'Il 2026-01-01',
    );
    expect(exceptionSummary(exc({ dateFrom: '2026-01-01', dateTo: '2026-01-05' }))).toBe(
      'Dal 2026-01-01 al 2026-01-05',
    );
    expect(exceptionSummary(exc({ dateFrom: '2026-01-01' }))).toBe('Dal 2026-01-01');
    expect(exceptionSummary(exc({ dateTo: '2026-01-05' }))).toBe('Fino al 2026-01-05');
  });
  it('aula, giorni e orari con default 00:00/23:59', () => {
    expect(
      exceptionSummary(exc({ roomId: 7, daysOfWeek: [1, 3], startTime: '12:00', endTime: null })),
    ).toBe('Solo aula: #7 · Lun, Mer · 12:00–23:59');
    expect(exceptionSummary(exc({ roomId: 7, room: { name: 'A1' } }))).toBe('Solo aula: A1');
    expect(exceptionSummary(exc({ endTime: '08:00' }))).toBe('00:00–08:00');
  });
});

describe('roleLabel', () => {
  it('mappa i ruoli', () => {
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('docente')).toBe('Docenti');
    expect(roleLabel('studente')).toBe('Studenti');
  });
});

describe('blankException / fromException', () => {
  it('blank: default e aula scoped', () => {
    expect(blankException('docente').roomScope).toBe('all');
    expect(blankException('docente', 5).roomScope).toBe('5');
    expect(blankException('docente').maxHoursInWindow).toBe('1');
  });
  it('from: singleDate solo se from === to', () => {
    expect(fromException(exc({ dateFrom: '2026-01-01', dateTo: '2026-01-01' })).singleDate).toBe(
      true,
    );
    expect(fromException(exc({ dateFrom: '2026-01-01', dateTo: '2026-01-02' })).singleDate).toBe(
      false,
    );
    expect(fromException(exc({ dateFrom: '2026-01-01' })).singleDate).toBe(false);
  });
  it('from: null diventano stringhe vuote / default', () => {
    const f = fromException(exc({ roomId: 3, maxHoursInWindow: 2 }));
    expect(f.roomScope).toBe('3');
    expect(f.maxHoursInWindow).toBe('2');
    expect(f.notes).toBe('');
    expect(fromException(exc({})).maxHoursInWindow).toBe('1');
  });
});

describe('toggleDay', () => {
  it('aggiunge ordinando e rimuove', () => {
    expect(toggleDay([3], 1)).toEqual([1, 3]);
    expect(toggleDay([1, 3], 3)).toEqual([1]);
    expect(toggleDay([], 0)).toEqual([0]);
  });
});

describe('isPastOnlyRange', () => {
  it('solo per i block con dateTo passata', () => {
    expect(isPastOnlyRange(form({ dateTo: '2026-01-01' }), '2026-06-01')).toBe(true);
    expect(isPastOnlyRange(form({ dateTo: '2026-06-01' }), '2026-06-01')).toBe(false);
    expect(isPastOnlyRange(form({}), '2026-06-01')).toBe(false);
    expect(isPastOnlyRange(form({ kind: 'time_window', dateTo: '2020-01-01' }), '2026-06-01')).toBe(
      false,
    );
  });
  it('con singleDate usa dateFrom', () => {
    expect(
      isPastOnlyRange(form({ singleDate: true, dateFrom: '2026-01-01', dateTo: '' }), '2026-06-01'),
    ).toBe(true);
  });
});

describe('validateException', () => {
  const err = (f: ExceptionFormState) => {
    const r = validateException(f);
    return r.ok ? null : r.error;
  };
  it('nome obbligatorio (anche solo spazi)', () => {
    expect(err(form({ name: '   ' }))).toBe('Nome obbligatorio');
  });
  it('time_window richiede ore positive', () => {
    expect(err(form({ kind: 'time_window', maxHoursInWindow: '0' }))).toMatch(/Ore massime/);
    expect(err(form({ kind: 'time_window', maxHoursInWindow: 'abc' }))).toMatch(/Ore massime/);
    expect(err(form({ kind: 'time_window', maxHoursInWindow: '1.5' }))).toBeNull();
    // per i block il campo ore è ignorato
    expect(err(form({ kind: 'block', maxHoursInWindow: '0' }))).toBeNull();
  });
  it('orario fine > inizio', () => {
    expect(err(form({ startTime: '10:00', endTime: '10:00' }))).toMatch(/orario di fine/);
    expect(err(form({ startTime: '10:00', endTime: '09:00' }))).toMatch(/orario di fine/);
    expect(err(form({ startTime: '10:00' }))).toBeNull();
  });
  it('data inizio <= data fine', () => {
    expect(err(form({ dateFrom: '2026-02-01', dateTo: '2026-01-01' }))).toMatch(/data di inizio/);
    expect(err(form({ dateFrom: '2026-01-01', dateTo: '2026-01-01' }))).toBeNull();
  });
  it('payload: normalizza vuoti a null, trim, singleDate copia dateFrom', () => {
    const r = validateException(
      form({
        name: '  Pausa  ',
        singleDate: true,
        dateFrom: '2026-03-03',
        dateTo: '2099-01-01',
        notes: '  ',
        roomScope: '4',
        daysOfWeek: [2],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload).toMatchObject({
        name: 'Pausa',
        dateFrom: '2026-03-03',
        dateTo: '2026-03-03',
        startTime: null,
        endTime: null,
        notes: null,
        roomId: 4,
        daysOfWeek: [2],
        maxHoursInWindow: null,
      });
    }
  });
  it('payload: time_window porta le ore come numero, nessun giorno -> null', () => {
    const r = validateException(form({ kind: 'time_window', maxHoursInWindow: '3' }));
    expect(r.ok && r.payload.maxHoursInWindow).toBe(3);
    expect(r.ok && r.payload.daysOfWeek).toBeNull();
    expect(r.ok && r.payload.roomId).toBeNull();
  });
});
