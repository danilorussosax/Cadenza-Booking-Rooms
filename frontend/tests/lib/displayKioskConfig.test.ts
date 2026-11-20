import { describe, it, expect } from 'vitest';
import { clamp, deriveAnnouncementsCfg, deriveConcertsCfg } from '@/lib/displayKioskConfig';
import type { Building } from '@/types';

const b = (over: Record<string, unknown>) => over as unknown as Building;

describe('deriveConcertsCfg', () => {
  it('default senza edifici', () => {
    expect(deriveConcertsCfg([])).toEqual({ enabled: true, days: 30, count: 0, intervalSec: 15 });
  });
  it('aggrega con le opzioni più permissive', () => {
    expect(
      deriveConcertsCfg([
        b({
          displayConcertsEnabled: false,
          displayConcertsDays: 10,
          displayConcertsCount: 3,
          displayConcertsIntervalSec: 10,
        }),
        b({
          displayConcertsEnabled: true,
          displayConcertsDays: 20,
          displayConcertsCount: 5,
          displayConcertsIntervalSec: 30,
        }),
      ]),
    ).toEqual({ enabled: true, days: 20, count: 5, intervalSec: 30 });
  });
  it('count 0 (illimitato) vince; campi mancanti usano i default', () => {
    expect(
      deriveConcertsCfg([b({ displayConcertsCount: 0 }), b({ displayConcertsCount: 4 })]).count,
    ).toBe(0);
    expect(deriveConcertsCfg([b({})])).toEqual({
      enabled: true,
      days: 30,
      count: 0,
      intervalSec: 15,
    });
  });
  it('disabilitato solo se tutti disabilitati', () => {
    expect(deriveConcertsCfg([b({ displayConcertsEnabled: false })]).enabled).toBe(false);
  });
});

describe('deriveAnnouncementsCfg', () => {
  it('default senza edifici', () => {
    expect(deriveAnnouncementsCfg([])).toEqual({
      enabled: true,
      count: 5,
      intervalSec: 12,
      pinnedOnly: false,
    });
  });
  it('pinnedOnly solo se tutti gli edifici lo hanno', () => {
    expect(
      deriveAnnouncementsCfg([
        b({ displayAnnouncementsPinnedOnly: true }),
        b({ displayAnnouncementsPinnedOnly: false }),
      ]).pinnedOnly,
    ).toBe(false);
    expect(
      deriveAnnouncementsCfg([
        b({ displayAnnouncementsPinnedOnly: true }),
        b({ displayAnnouncementsPinnedOnly: true }),
      ]).pinnedOnly,
    ).toBe(true);
  });
  it('count 0 vince, altrimenti max; intervallo max', () => {
    expect(
      deriveAnnouncementsCfg([
        b({ displayAnnouncementsCount: 0, displayAnnouncementsIntervalSec: 20 }),
        b({ displayAnnouncementsCount: 9 }),
      ]),
    ).toMatchObject({ count: 0, intervalSec: 20 });
    expect(
      deriveAnnouncementsCfg([
        b({ displayAnnouncementsCount: 2 }),
        b({ displayAnnouncementsCount: 9 }),
      ]).count,
    ).toBe(9);
  });
});

describe('clamp', () => {
  it('arrotonda e vincola', () => {
    expect(clamp(4.4, 5, 600)).toBe(5);
    expect(clamp(700, 5, 600)).toBe(600);
    expect(clamp(12.5, 5, 600)).toBe(13);
    expect(clamp(7, 5, 600)).toBe(7);
  });
});
