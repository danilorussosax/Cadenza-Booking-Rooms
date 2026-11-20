import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  invalidateBookings,
  invalidateEquipment,
  invalidateInstituteBranding,
  invalidateInstituteProfile,
  invalidateMonteOre,
  invalidateStructure,
  invalidateStructureDeleted,
} from '@/lib/invalidation';

// Una query "viva" per ogni vista rilevante, con chiavi realistiche
// (prefisso + suffissi usati dalle pagine).
const VIEWS = {
  institutesFull: ['institutes', 'full'],
  structureFull: ['structure', 'institutes', 'full'],
  roomsBookable: ['rooms', 'bookable'],
  roomsSearch: ['rooms', 'search', { capacity: 4 }, 7],
  roomsListAll: ['rooms', 'list', 'all'],
  publicAgenda: ['public', 'agenda', 'week', '2026-01-05'],
  publicStats: ['public', 'stats'],
  branding: ['institute', 'public'],
  bookingsMine: ['bookings', 'mine', 'all'],
  availability: ['availability', 3, '2026-01-05'],
  adminBookingsPending: ['admin', 'bookings', 'pending'],
  adminBookingsCount: ['admin', 'bookings', 'pending', 'count'],
  monteOreMe: ['monte-ore', 'me', 2026],
  adminMonteOre: ['admin', 'monte-ore', 'settings'],
  users: ['users'],
} as const;

type View = keyof typeof VIEWS;

let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient();
  for (const key of Object.values(VIEWS)) qc.setQueryData(key, 'dati');
});

const invalidated = (): View[] =>
  (Object.keys(VIEWS) as View[])
    .filter((name) => qc.getQueryState(VIEWS[name] as readonly unknown[])?.isInvalidated)
    .sort();

describe('lib/invalidation · eventi di dominio', () => {
  it('invalidateStructure tocca struttura, aule e Display pubblico (non il branding)', async () => {
    await invalidateStructure(qc);
    expect(invalidated()).toEqual(
      [
        'institutesFull',
        'structureFull',
        'roomsBookable',
        'roomsSearch',
        'roomsListAll',
        'publicAgenda',
        'publicStats',
      ].sort(),
    );
  });

  it('invalidateEquipment tocca albero struttura e ricerca aule, non il Display pubblico', async () => {
    await invalidateEquipment(qc);
    expect(invalidated()).toEqual(
      ['institutesFull', 'structureFull', 'roomsBookable', 'roomsSearch', 'roomsListAll'].sort(),
    );
  });

  it('invalidateInstituteBranding tocca solo il branding pubblico', async () => {
    await invalidateInstituteBranding(qc);
    expect(invalidated()).toEqual(['branding']);
  });

  it('invalidateInstituteProfile tocca albero istituti e branding', async () => {
    await invalidateInstituteProfile(qc);
    expect(invalidated()).toEqual(['branding', 'institutesFull']);
  });

  it('invalidateStructureDeleted = struttura + branding', async () => {
    await invalidateStructureDeleted(qc);
    expect(invalidated()).toEqual(
      [
        'branding',
        'institutesFull',
        'structureFull',
        'roomsBookable',
        'roomsSearch',
        'roomsListAll',
        'publicAgenda',
        'publicStats',
      ].sort(),
    );
  });

  it('invalidateBookings tocca prenotazioni utente/admin e disponibilita', async () => {
    await invalidateBookings(qc);
    expect(invalidated()).toEqual(
      ['bookingsMine', 'availability', 'adminBookingsPending', 'adminBookingsCount'].sort(),
    );
  });

  it('invalidateMonteOre tocca monte ore utente e admin', async () => {
    await invalidateMonteOre(qc);
    expect(invalidated()).toEqual(['monteOreMe', 'adminMonteOre'].sort());
  });
});
