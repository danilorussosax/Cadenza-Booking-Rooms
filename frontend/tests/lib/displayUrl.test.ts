import { describe, expect, it } from 'vitest';
import { findBuildingBySlug, parseDisplayBuildingSlug, slugifyBuilding } from '@/lib/displayUrl';

describe('slugifyBuilding', () => {
  it('normalizza lowercase + rimuove spazi', () => {
    expect(slugifyBuilding('Sede Centrale')).toBe('sedecentrale');
  });

  it('rimuove diacritici (accenti)', () => {
    expect(slugifyBuilding('Süd')).toBe('sud');
    expect(slugifyBuilding('Édifice Nord')).toBe('edificenord');
  });

  it('rimuove punteggiatura e caratteri speciali', () => {
    expect(slugifyBuilding('Edificio NORD-1')).toBe('edificionord1');
    expect(slugifyBuilding('A&B')).toBe('ab');
  });

  it('è idempotente', () => {
    const once = slugifyBuilding('Sede Centrale');
    expect(slugifyBuilding(once)).toBe(once);
  });
});

describe('parseDisplayBuildingSlug', () => {
  it('ritorna null su URL senza parametri', () => {
    expect(parseDisplayBuildingSlug('')).toBeNull();
    expect(parseDisplayBuildingSlug('?')).toBeNull();
  });

  it('estrae da ?b=<slug>', () => {
    expect(parseDisplayBuildingSlug('?b=centrale')).toBe('centrale');
  });

  it('estrae da ?building=<slug> (alias verboso)', () => {
    expect(parseDisplayBuildingSlug('?building=radar')).toBe('radar');
  });

  it('estrae da ?<slug> (key boolean)', () => {
    expect(parseDisplayBuildingSlug('?centrale')).toBe('centrale');
    expect(parseDisplayBuildingSlug('?radar')).toBe('radar');
  });

  it('normalizza lo slug (lowercase, no accenti, no spazi)', () => {
    expect(parseDisplayBuildingSlug('?b=Sede%20Centrale')).toBe('sedecentrale');
    expect(parseDisplayBuildingSlug('?b=S%C3%BCd')).toBe('sud'); // ?b=Süd encoded
  });

  it('?b vince su ?<slug> (esplicito vince su boolean)', () => {
    // URL come "?centrale&b=radar": prende b=radar
    expect(parseDisplayBuildingSlug('?centrale&b=radar')).toBe('radar');
  });

  it('?b ha priorità su ?building se entrambi presenti', () => {
    expect(parseDisplayBuildingSlug('?b=alpha&building=beta')).toBe('alpha');
  });

  it('ignora valori vuoti e parametri spazio-only', () => {
    expect(parseDisplayBuildingSlug('?b=')).toBeNull();
    expect(parseDisplayBuildingSlug('?b=%20%20')).toBeNull();
  });

  it('ignora `b` e `building` come key boolean (sono campi gestiti)', () => {
    // ?b senza valore: NON deve essere interpretato come slug "b"
    expect(parseDisplayBuildingSlug('?b')).toBeNull();
    expect(parseDisplayBuildingSlug('?building')).toBeNull();
  });

  it('prende solo la PRIMA chiave boolean se ce ne sono più di una', () => {
    expect(parseDisplayBuildingSlug('?centrale&radar')).toBe('centrale');
  });
});

describe('findBuildingBySlug', () => {
  const buildings = [
    { id: 1, code: 'CENT', name: 'Sede Centrale' },
    { id: 2, code: 'RADAR', name: 'Sede Radar' },
    { id: 3, code: null, name: 'Edificio Storico' },
  ];

  it('matcha per code (case-insensitive)', () => {
    expect(findBuildingBySlug(buildings, 'cent')?.id).toBe(1);
    expect(findBuildingBySlug(buildings, 'radar')?.id).toBe(2);
  });

  it('fa fallback su name normalizzato se code non matcha', () => {
    expect(findBuildingBySlug(buildings, 'edificiostorico')?.id).toBe(3);
    expect(findBuildingBySlug(buildings, 'sedecentrale')?.id).toBe(1);
  });

  it('code ha priorità su name', () => {
    const list = [
      { id: 10, code: 'A', name: 'B' },
      { id: 11, code: 'X', name: 'A' }, // name confliggente col code di 10
    ];
    // Slug "a" matcha SEMPRE prima il code di 10, non il name di 11
    expect(findBuildingBySlug(list, 'a')?.id).toBe(10);
  });

  it('ritorna null se nessun match', () => {
    expect(findBuildingBySlug(buildings, 'inesistente')).toBeNull();
  });

  it('ignora code null o vuoto', () => {
    const list = [{ id: 1, code: null, name: 'Foo' }];
    expect(findBuildingBySlug(list, 'foo')?.id).toBe(1);
  });

  it('fa substring match come fallback friendly (?centrale → "Sede Centrale")', () => {
    expect(findBuildingBySlug(buildings, 'centrale')?.id).toBe(1);
    expect(findBuildingBySlug(buildings, 'radar')?.id).toBe(2);
    expect(findBuildingBySlug(buildings, 'storico')?.id).toBe(3);
  });

  it('substring match cede la priorità a match esatti', () => {
    // Se esiste un building con code "centrale" esatto, vince su uno che
    // ha "centrale" solo come substring del nome.
    const list = [
      { id: 100, code: null, name: 'Sede Centrale Antica' },
      { id: 200, code: 'CENTRALE', name: 'Edificio Sud' },
    ];
    expect(findBuildingBySlug(list, 'centrale')?.id).toBe(200);
  });

  it('integra con parseDisplayBuildingSlug end-to-end (?centrale → Sede Centrale)', () => {
    const slug = parseDisplayBuildingSlug('?centrale');
    expect(slug).not.toBeNull();
    const match = slug ? findBuildingBySlug(buildings, slug) : null;
    expect(match?.id).toBe(1);
  });

  it('integra end-to-end con tutte e 3 le sintassi URL', () => {
    expect(findBuildingBySlug(buildings, parseDisplayBuildingSlug('?b=CENT')!)?.id).toBe(1);
    expect(findBuildingBySlug(buildings, parseDisplayBuildingSlug('?building=radar')!)?.id).toBe(2);
    expect(findBuildingBySlug(buildings, parseDisplayBuildingSlug('?storico')!)?.id).toBe(3);
  });
});
