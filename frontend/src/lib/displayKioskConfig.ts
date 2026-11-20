import type { Building } from '@/types';

export interface ConcertsCfg {
  enabled: boolean;
  days: number;
  count: number;
  intervalSec: number;
}

export interface AnnouncementsCfg {
  enabled: boolean;
  count: number;
  intervalSec: number;
  pinnedOnly: boolean;
}

// Le impostazioni concerti sono salvate per-edificio sul DB ma esposte
// globalmente dalla UI (la rotazione /display le aggrega comunque). Quando
// l'admin modifica la card, lo stesso valore viene scritto su tutti gli
// edifici. Initial values: se i record divergono prendiamo le opzioni "più
// permissive" (enabled OR, days max, count 0 se almeno uno è 0/unlimited).
export function deriveConcertsCfg(buildings: Building[]): ConcertsCfg {
  if (buildings.length === 0) {
    return { enabled: true, days: 30, count: 0, intervalSec: 15 };
  }
  const enabledAny = buildings.some((b) => b.displayConcertsEnabled ?? true);
  const days = Math.max(...buildings.map((b) => b.displayConcertsDays ?? 30));
  const counts = buildings.map((b) => b.displayConcertsCount ?? 0);
  const count = counts.includes(0) ? 0 : Math.max(...counts);
  const intervalSec = Math.max(...buildings.map((b) => b.displayConcertsIntervalSec ?? 15));
  return { enabled: enabledAny, days, count, intervalSec };
}

// Stessa logica della card concerti: aggreghiamo le preferenze per-edificio
// nelle "più permissive". Sul save, il valore della UI viene replicato su
// tutti gli edifici. pinnedOnly=true vince solo se TUTTI gli edifici lo
// hanno (così se anche uno è "tutti", manteniamo il caso più ampio).
export function deriveAnnouncementsCfg(buildings: Building[]): AnnouncementsCfg {
  if (buildings.length === 0) {
    return { enabled: true, count: 5, intervalSec: 12, pinnedOnly: false };
  }
  const enabledAny = buildings.some((b) => b.displayAnnouncementsEnabled ?? true);
  const counts = buildings.map((b) => b.displayAnnouncementsCount ?? 5);
  const count = counts.includes(0) ? 0 : Math.max(...counts);
  const intervalSec = Math.max(...buildings.map((b) => b.displayAnnouncementsIntervalSec ?? 12));
  const pinnedOnly = buildings.every((b) => b.displayAnnouncementsPinnedOnly === true);
  return { enabled: enabledAny, count, intervalSec, pinnedOnly };
}

/** Arrotonda `v` all'intero e lo vincola a [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}
