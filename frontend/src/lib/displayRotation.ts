import type { DisplayConfigBuilding, PublicAnnouncement, PublicBuilding } from '@/api/public';
import type { PublicConcert } from '@/types';
import { findBuildingBySlug } from '@/lib/displayUrl';

/** Edificio della rotazione, con la durata della slide decisa dall'admin. */
export type RotationBuilding = PublicBuilding & { intervalSec: number };

export type Slide =
  | { kind: 'building'; building: RotationBuilding; intervalSec: number }
  | { kind: 'concert'; concert: PublicConcert; intervalSec: number }
  | { kind: 'announcement'; announcement: PublicAnnouncement; intervalSec: number };

export interface ConcertsRotationConfig {
  enabled: boolean;
  horizonDays: number;
  cap: number;
  intervalSec: number;
}

export interface AnnouncementsRotationConfig {
  enabled: boolean;
  cap: number;
  intervalSec: number;
  pinnedOnly: boolean;
}

/** Soglia oltre la quale l'agenda è considerata "non aggiornata" (offline-soft). */
export const STALE_AFTER_MS = 2 * 60_000;

/** Padding TV-safe (in %) da `?tvsafe[=N]`: 0 = disattivo, default 3, clamp 0–15. */
export function parseTvSafePct(search: string): number {
  const params = new URLSearchParams(search);
  if (!params.has('tvsafe')) return 0;
  const raw = params.get('tvsafe');
  if (!raw) return 3; // attivo senza valore → 3% (sweet spot empirico)
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.max(0, Math.min(15, n));
}

/**
 * Edifici dell'agenda filtrati e riordinati secondo la configurazione admin.
 * Senza config → tutti con intervallo di default (30s). Con `requestedSlug`
 * mostra solo l'edificio corrispondente (fallback alla rotazione completa se
 * lo slug non matcha, per non lasciare lo schermo vuoto).
 */
export function buildRotationBuildings(
  allBuildings: PublicBuilding[],
  rotationOrder: DisplayConfigBuilding[],
  requestedSlug: string | null,
): RotationBuilding[] {
  let base: RotationBuilding[];
  if (rotationOrder.length === 0) {
    base = allBuildings.map((b) => ({ ...b, intervalSec: 30 }));
  } else {
    const byId = new Map(allBuildings.map((b) => [b.id, b]));
    base = rotationOrder
      .map((c) => {
        const b = byId.get(c.id);
        return b ? { ...b, intervalSec: c.intervalSec } : null;
      })
      .filter((b): b is RotationBuilding => b !== null);
  }
  if (!requestedSlug) return base;
  const match = findBuildingBySlug(base, requestedSlug);
  return match ? [match] : base;
}

/**
 * Aggregati concerti (per-edificio, applicati globalmente):
 *  - enabled: almeno un edificio con toggle on e orizzonte > 0
 *  - horizon: max(concertsDays) tra edifici con toggle on
 *  - cap: max(concertsCount) tra edifici con toggle on (0 = nessun limite)
 *  - intervalSec: max(concertsIntervalSec) tra edifici con toggle on
 */
export function aggregateConcertsConfig(rotationOrder: DisplayConfigBuilding[]) {
  const active = rotationOrder.filter((b) => b.concertsEnabled);
  if (active.length === 0) {
    return { enabled: false, horizonDays: 0, cap: 0, intervalSec: 15 };
  }
  const horizonDays = Math.max(...active.map((b) => b.concertsDays), 0);
  const counts = active.map((b) => b.concertsCount);
  // 0 in qualsiasi edificio significa "senza limite" → la max è 0
  const cap = counts.includes(0) ? 0 : Math.max(...counts);
  const intervalSec = Math.max(...active.map((b) => b.concertsIntervalSec));
  return { enabled: horizonDays > 0, horizonDays, cap, intervalSec };
}

/**
 * Aggregati annunci:
 *  - enabled: almeno un edificio in rotazione ha il toggle on
 *  - cap: max(announcementsCount) — 0 in qualsiasi → 0 (senza limite)
 *  - intervalSec: min(announcementsIntervalSec) — slide più veloce vince
 *  - pinnedOnly: true solo se TUTTI gli attivi hanno pinnedOnly=true
 */
export function aggregateAnnouncementsConfig(rotationOrder: DisplayConfigBuilding[]) {
  const active = rotationOrder.filter((b) => b.announcementsEnabled);
  if (active.length === 0) {
    return { enabled: false, cap: 0, intervalSec: 12, pinnedOnly: false };
  }
  const counts = active.map((b) => b.announcementsCount);
  const cap = counts.includes(0) ? 0 : Math.max(...counts);
  const intervalSec = Math.min(...active.map((b) => b.announcementsIntervalSec));
  const pinnedOnly = active.every((b) => b.announcementsPinnedOnly);
  return { enabled: true, cap, intervalSec, pinnedOnly };
}

/** Master switch prenotazioni: se nessun edificio ha bookingsEnabled, niente slide edifici. */
export function isBookingsRotationEnabled(rotationOrder: DisplayConfigBuilding[]): boolean {
  return rotationOrder.length === 0 || rotationOrder.some((b) => b.bookingsEnabled);
}

export interface BuildSlidesInput {
  rotationBuildings: RotationBuilding[];
  bookingsEnabled: boolean;
  concertsConfig: ConcertsRotationConfig;
  concerts: PublicConcert[] | undefined;
  announcementsConfig: AnnouncementsRotationConfig;
  announcements: PublicAnnouncement[] | undefined;
}

/** Slide della rotazione: prima gli edifici, poi i concerti, poi gli annunci. */
export function buildSlides(i: BuildSlidesInput): Slide[] {
  const out: Slide[] = i.bookingsEnabled
    ? i.rotationBuildings.map((b) => ({
        kind: 'building',
        building: b,
        intervalSec: b.intervalSec,
      }))
    : [];
  if (i.concertsConfig.enabled) {
    const all = i.concerts ?? [];
    const concerts = i.concertsConfig.cap > 0 ? all.slice(0, i.concertsConfig.cap) : all;
    for (const c of concerts) {
      out.push({ kind: 'concert', concert: c, intervalSec: i.concertsConfig.intervalSec });
    }
  }
  if (i.announcementsConfig.enabled) {
    const all = i.announcements ?? [];
    const limited = i.announcementsConfig.cap > 0 ? all.slice(0, i.announcementsConfig.cap) : all;
    for (const a of limited) {
      out.push({
        kind: 'announcement',
        announcement: a,
        intervalSec: i.announcementsConfig.intervalSec,
      });
    }
  }
  return out;
}

/** Durata effettiva (ms) di una slide: intervallo vincolato a [5s, 600s]. */
export function slideDelayMs(intervalSec: number): number {
  return Math.max(5, Math.min(600, intervalSec)) * 1000;
}

export interface ConnectionStatus {
  isLive: boolean;
  hasCachedAgenda: boolean;
  showOfflineBanner: boolean;
}

/**
 * Offline-soft: "live" se agenda e stats non sono in errore e l'agenda è stata
 * aggiornata nelle ultime 2 minuti. Il banner compare solo se NON live ma c'è
 * almeno un fetch riuscito (`agendaUpdatedAt > 0`).
 */
export function computeConnectionStatus(
  input: { agendaError: boolean; statsError: boolean; agendaUpdatedAt: number },
  nowMs: number = Date.now(),
): ConnectionStatus {
  const isLive =
    !input.agendaError && !input.statsError && input.agendaUpdatedAt > nowMs - STALE_AFTER_MS;
  const hasCachedAgenda = input.agendaUpdatedAt > 0;
  return { isLive, hasCachedAgenda, showOfflineBanner: !isLive && hasCachedAgenda };
}
