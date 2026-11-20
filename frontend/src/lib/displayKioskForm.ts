import type { Building } from '@/types';
import { clamp, type AnnouncementsCfg, type ConcertsCfg } from '@/lib/displayKioskConfig';

/** Stato locale di una riga della tabella edifici (toggle rotazione + durata + vista). */
export interface RowState {
  buildingId: number;
  enabled: boolean;
  intervalSec: number;
  /** Modalità tabella prenotazioni — 'weekly' (default) o 'daily'. */
  viewMode: 'weekly' | 'daily';
}

export interface BookingsCfg {
  enabled: boolean;
}

export function rowFromBuilding(b: Building): RowState {
  return {
    buildingId: b.id,
    enabled: b.displayEnabled ?? true,
    intervalSec: b.displayIntervalSec ?? 30,
    viewMode: b.displayViewMode === 'daily' ? 'daily' : 'weekly',
  };
}

/** Master toggle prenotazioni: on se almeno un edificio ha il toggle on (o lista vuota). */
export function deriveBookingsCfg(buildings: Building[]): BookingsCfg {
  return {
    enabled: buildings.length === 0 || buildings.some((b) => b.displayBookingsEnabled !== false),
  };
}

/** True se la riga locale differisce dai valori salvati sull'edificio. */
export function isRowChanged(row: RowState, b: Building): boolean {
  return (
    row.enabled !== (b.displayEnabled ?? true) ||
    row.intervalSec !== (b.displayIntervalSec ?? 30) ||
    row.viewMode !== (b.displayViewMode === 'daily' ? 'daily' : 'weekly')
  );
}

export function isConcertsDirty(cur: ConcertsCfg, base: ConcertsCfg): boolean {
  return (
    cur.enabled !== base.enabled ||
    cur.days !== base.days ||
    cur.count !== base.count ||
    cur.intervalSec !== base.intervalSec
  );
}

export function isAnnouncementsDirty(cur: AnnouncementsCfg, base: AnnouncementsCfg): boolean {
  return (
    cur.enabled !== base.enabled ||
    cur.count !== base.count ||
    cur.intervalSec !== base.intervalSec ||
    cur.pinnedOnly !== base.pinnedOnly
  );
}

export interface BuildingPatchInput {
  row: RowState;
  bookings: BookingsCfg;
  concerts: ConcertsCfg;
  announcements: AnnouncementsCfg;
  bookingsDirty: boolean;
  concertsDirty: boolean;
  announcementsDirty: boolean;
}

/**
 * Payload di aggiornamento per un edificio. Le card globali "dirty" sovrascrivono
 * il valore di ogni edificio; quelle pulite ripassano il valore corrente del DB.
 */
export function buildBuildingPatch(b: Building, i: BuildingPatchInput) {
  const { row: r, bookings, concerts, announcements } = i;
  return {
    displayEnabled: r.enabled,
    displayIntervalSec: clamp(r.intervalSec, 5, 600),
    displayViewMode: r.viewMode,
    displayBookingsEnabled: i.bookingsDirty ? bookings.enabled : (b.displayBookingsEnabled ?? true),
    displayConcertsEnabled: i.concertsDirty ? concerts.enabled : (b.displayConcertsEnabled ?? true),
    displayConcertsDays: clamp(
      i.concertsDirty ? concerts.days : (b.displayConcertsDays ?? 30),
      0,
      365,
    ),
    displayConcertsCount: clamp(
      i.concertsDirty ? concerts.count : (b.displayConcertsCount ?? 0),
      0,
      50,
    ),
    displayConcertsIntervalSec: clamp(
      i.concertsDirty ? concerts.intervalSec : (b.displayConcertsIntervalSec ?? 15),
      5,
      600,
    ),
    displayAnnouncementsEnabled: i.announcementsDirty
      ? announcements.enabled
      : (b.displayAnnouncementsEnabled ?? true),
    displayAnnouncementsCount: clamp(
      i.announcementsDirty ? announcements.count : (b.displayAnnouncementsCount ?? 5),
      0,
      30,
    ),
    displayAnnouncementsIntervalSec: clamp(
      i.announcementsDirty ? announcements.intervalSec : (b.displayAnnouncementsIntervalSec ?? 12),
      5,
      600,
    ),
    displayAnnouncementsPinnedOnly: i.announcementsDirty
      ? announcements.pinnedOnly
      : b.displayAnnouncementsPinnedOnly === true,
  };
}
