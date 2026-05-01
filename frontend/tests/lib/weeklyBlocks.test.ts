import { describe, it, expect } from 'vitest';
import {
  buildTeacherDisambiguation,
  bookingToBlock,
  bookingsToBlocks,
  publicBookingToBlock,
  publicBookingsToBlocks,
} from '@/lib/weeklyBlocks';

describe('buildTeacherDisambiguation', () => {
  it('un solo cognome → mappa vuota', () => {
    const m = buildTeacherDisambiguation([{ firstName: 'Mario', lastName: 'Rossi' }]);
    expect(m.size).toBe(0);
  });

  it('cognomi diversi → mappa vuota', () => {
    const m = buildTeacherDisambiguation([
      { firstName: 'Mario', lastName: 'Rossi' },
      { firstName: 'Luigi', lastName: 'Verdi' },
    ]);
    expect(m.size).toBe(0);
  });

  it('omonimo con iniziali diverse → usa "X." prefix', () => {
    const m = buildTeacherDisambiguation([
      { firstName: 'Mario', lastName: 'Rossi' },
      { firstName: 'Luigi', lastName: 'Rossi' },
    ]);
    expect(m.get('rossi::Mario')).toBe('M.');
    expect(m.get('rossi::Luigi')).toBe('L.');
  });

  it('omonimo con stessa iniziale → fallback nome completo', () => {
    const m = buildTeacherDisambiguation([
      { firstName: 'Mario', lastName: 'Rossi' },
      { firstName: 'Marco', lastName: 'Rossi' },
    ]);
    expect(m.get('rossi::Mario')).toBe('Mario');
    expect(m.get('rossi::Marco')).toBe('Marco');
  });

  it('input vuoto / con null → robusto', () => {
    expect(buildTeacherDisambiguation([]).size).toBe(0);
    const m = buildTeacherDisambiguation([
      { firstName: null, lastName: 'Rossi' },
      { firstName: 'Mario', lastName: null },
    ]);
    expect(m.size).toBe(0);
  });
});

describe('bookingToBlock', () => {
  function fakeBooking(overrides: Partial<Parameters<typeof bookingToBlock>[0]> = {}) {
    return {
      id: 1,
      startTime: new Date('2025-11-03T10:00:00Z') as unknown as string,
      endTime: new Date('2025-11-03T11:00:00Z') as unknown as string,
      type: 'studio_individuale',
      status: 'confirmed',
      purpose: null,
      user: { id: 1, firstName: 'Mario', lastName: 'Rossi', role: 'docente' },
      room: { id: 1, name: 'A1' },
      ...overrides,
    } as unknown as Parameters<typeof bookingToBlock>[0];
  }

  it('docente lezione → "Prof. Rossi"', () => {
    const block = bookingToBlock(fakeBooking({ type: 'lezione' }), new Map());
    expect(block.label).toContain('Rossi');
  });

  it('admin → "Direzione"', () => {
    const block = bookingToBlock(
      fakeBooking({ user: { id: 1, firstName: 'A', lastName: 'B', role: 'admin' } }),
      new Map(),
    );
    expect(block.label).toMatch(/Direzione/);
  });

  it('concerto → produce blocco non vuoto', () => {
    const block = bookingToBlock(
      fakeBooking({ type: 'concerto' } as unknown as Parameters<typeof bookingToBlock>[0]),
      new Map(),
    );
    expect(block).toBeDefined();
    expect(typeof block.label).toBe('string');
  });

  it('studente con altro tipo → "Stud"', () => {
    const block = bookingToBlock(
      fakeBooking({
        type: 'altro',
        user: { id: 1, firstName: 'A', lastName: 'B', role: 'studente' },
      }),
      new Map(),
    );
    expect(block.label).toMatch(/Stud/);
  });
});

describe('bookingsToBlocks', () => {
  it('mappa lista vuota a array vuoto', () => {
    expect(bookingsToBlocks([])).toEqual([]);
  });
});

describe('publicBookingToBlock + publicBookingsToBlocks', () => {
  function fakePublic() {
    return {
      id: 1,
      startTime: new Date('2025-11-03T10:00:00Z').toISOString(),
      endTime: new Date('2025-11-03T11:00:00Z').toISOString(),
      type: 'lezione',
      status: 'confirmed',
      bookedBy: 'Prof. Rossi',
      room: { id: 1, name: 'A1' },
    } as unknown as Parameters<typeof publicBookingToBlock>[0];
  }

  it('publicBookingToBlock produce blocco', () => {
    const b = publicBookingToBlock(fakePublic());
    expect(b.label.length).toBeGreaterThan(0);
    expect(b.id).toBe(1);
  });

  it('publicBookingsToBlocks su array vuoto', () => {
    expect(publicBookingsToBlocks([])).toEqual([]);
  });
});
