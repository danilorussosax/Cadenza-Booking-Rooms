'use strict';

const it_ = require('../../lib/institutionTime');

// Eseguito sia con TZ=UTC sia con TZ=Europe/Rome: il risultato non deve cambiare.
describe('institutionTime.toInstant: determinismo rispetto al TZ del processo', () => {
  it('stringa senza offset = ora locale istituto (estate +02:00)', () => {
    expect(it_.toInstant('2026-07-15T10:30').toISOString()).toBe('2026-07-15T08:30:00.000Z');
    expect(it_.toInstant('2026-07-15 10:30:15').toISOString()).toBe('2026-07-15T08:30:15.000Z');
  });
  it('stringa senza offset = ora locale istituto (inverno +01:00)', () => {
    expect(it_.toInstant('2026-01-15T10:30').toISOString()).toBe('2026-01-15T09:30:00.000Z');
  });
  it('stringhe con Z o offset sono istanti assoluti', () => {
    expect(it_.toInstant('2026-07-15T10:30:00Z').toISOString()).toBe('2026-07-15T10:30:00.000Z');
    expect(it_.toInstant('2026-07-15T10:30:00+02:00').toISOString()).toBe(
      '2026-07-15T08:30:00.000Z',
    );
  });
  it('data pura = mezzanotte istituto; Date ed epoch invariati; invalido -> Invalid Date', () => {
    expect(it_.toInstant('2026-07-15').toISOString()).toBe('2026-07-14T22:00:00.000Z');
    const d = new Date('2026-07-15T10:00:00Z');
    expect(it_.toInstant(d).getTime()).toBe(d.getTime());
    expect(it_.toInstant(d.getTime()).getTime()).toBe(d.getTime());
    expect(Number.isNaN(it_.toInstant('garbage').getTime())).toBe(true);
  });
});
