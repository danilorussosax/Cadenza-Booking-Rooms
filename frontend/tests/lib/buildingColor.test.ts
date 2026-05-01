import { describe, it, expect } from 'vitest';
import { buildingColor } from '@/lib/buildingColor';

describe('lib/buildingColor', () => {
  it('ritorna oggetto con classi text/chip/tile', () => {
    const c = buildingColor(1);
    expect(c).toHaveProperty('text');
    expect(c).toHaveProperty('chip');
    expect(c).toHaveProperty('tile');
  });

  it('è deterministico per lo stesso id', () => {
    const a = buildingColor(42);
    const b = buildingColor(42);
    expect(a).toEqual(b);
  });

  it('id null/undefined → palette default valida', () => {
    expect(buildingColor(null)).toBeDefined();
    expect(buildingColor(undefined)).toBeDefined();
  });

  it('id diversi restituiscono colori diversi (modulo collisioni della palette)', () => {
    // Almeno una coppia su 8 deve essere diversa
    const colors = [buildingColor(1), buildingColor(3), buildingColor(5), buildingColor(7)];
    const unique = new Set(colors.map((c) => c.text));
    expect(unique.size).toBeGreaterThan(1);
  });
});
