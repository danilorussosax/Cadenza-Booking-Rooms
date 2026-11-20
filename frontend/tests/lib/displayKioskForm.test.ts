import { describe, it, expect } from 'vitest';
import {
  buildBuildingPatch,
  deriveBookingsCfg,
  isAnnouncementsDirty,
  isConcertsDirty,
  isRowChanged,
  rowFromBuilding,
} from '@/lib/displayKioskForm';
import type { Building } from '@/types';

const b = (over: Record<string, unknown> = {}) => ({ id: 7, ...over }) as unknown as Building;

describe('rowFromBuilding / isRowChanged', () => {
  it('applica i default', () => {
    expect(rowFromBuilding(b())).toEqual({
      buildingId: 7,
      enabled: true,
      intervalSec: 30,
      viewMode: 'weekly',
    });
  });
  it('rileva le modifiche', () => {
    const bld = b({ displayEnabled: false, displayIntervalSec: 45, displayViewMode: 'daily' });
    const row = rowFromBuilding(bld);
    expect(isRowChanged(row, bld)).toBe(false);
    expect(isRowChanged({ ...row, enabled: true }, bld)).toBe(true);
    expect(isRowChanged({ ...row, intervalSec: 10 }, bld)).toBe(true);
    expect(isRowChanged({ ...row, viewMode: 'weekly' }, bld)).toBe(true);
  });
});

describe('deriveBookingsCfg', () => {
  it('lista vuota → on; off solo se tutti esplicitamente false', () => {
    expect(deriveBookingsCfg([]).enabled).toBe(true);
    expect(deriveBookingsCfg([b({ displayBookingsEnabled: false })]).enabled).toBe(false);
    expect(
      deriveBookingsCfg([b({ displayBookingsEnabled: false }), b({ displayBookingsEnabled: true })])
        .enabled,
    ).toBe(true);
  });
});

describe('dirty helpers', () => {
  it('concerts', () => {
    const c = { enabled: true, days: 30, count: 0, intervalSec: 15 };
    expect(isConcertsDirty(c, { ...c })).toBe(false);
    expect(isConcertsDirty({ ...c, days: 31 }, c)).toBe(true);
  });
  it('announcements', () => {
    const a = { enabled: true, count: 5, intervalSec: 12, pinnedOnly: false };
    expect(isAnnouncementsDirty(a, { ...a })).toBe(false);
    expect(isAnnouncementsDirty({ ...a, pinnedOnly: true }, a)).toBe(true);
  });
});

describe('buildBuildingPatch', () => {
  const concerts = { enabled: false, days: 999, count: 99, intervalSec: 1 };
  const announcements = { enabled: false, count: 99, intervalSec: 1, pinnedOnly: true };
  const bld = b({
    displayConcertsDays: 10,
    displayConcertsCount: 2,
    displayAnnouncementsPinnedOnly: false,
  });
  const common = {
    row: rowFromBuilding(bld),
    bookings: { enabled: false },
    concerts,
    announcements,
  };

  it('card pulite: ripassa i valori del DB (con default)', () => {
    const p = buildBuildingPatch(bld, {
      ...common,
      bookingsDirty: false,
      concertsDirty: false,
      announcementsDirty: false,
    });
    expect(p).toMatchObject({
      displayBookingsEnabled: true,
      displayConcertsEnabled: true,
      displayConcertsDays: 10,
      displayConcertsCount: 2,
      displayConcertsIntervalSec: 15,
      displayAnnouncementsEnabled: true,
      displayAnnouncementsCount: 5,
      displayAnnouncementsIntervalSec: 12,
      displayAnnouncementsPinnedOnly: false,
    });
  });

  it('card dirty: sovrascrive con i valori globali, clampati', () => {
    const p = buildBuildingPatch(bld, {
      ...common,
      bookingsDirty: true,
      concertsDirty: true,
      announcementsDirty: true,
    });
    expect(p).toMatchObject({
      displayBookingsEnabled: false,
      displayConcertsEnabled: false,
      displayConcertsDays: 365,
      displayConcertsCount: 50,
      displayConcertsIntervalSec: 5,
      displayAnnouncementsEnabled: false,
      displayAnnouncementsCount: 30,
      displayAnnouncementsIntervalSec: 5,
      displayAnnouncementsPinnedOnly: true,
    });
  });
});
