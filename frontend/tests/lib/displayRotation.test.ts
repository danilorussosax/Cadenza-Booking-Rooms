import { describe, it, expect } from 'vitest';
import type { DisplayConfigBuilding, PublicBuilding } from '@/api/public';
import {
  STALE_AFTER_MS,
  aggregateAnnouncementsConfig,
  aggregateConcertsConfig,
  buildRotationBuildings,
  buildSlides,
  computeConnectionStatus,
  isBookingsRotationEnabled,
  parseTvSafePct,
  slideDelayMs,
} from '@/lib/displayRotation';

const cfg = (over: Partial<DisplayConfigBuilding>): DisplayConfigBuilding =>
  ({
    id: 1,
    code: null,
    name: 'B',
    intervalSec: 30,
    concertsEnabled: true,
    concertsDays: 30,
    concertsCount: 3,
    concertsIntervalSec: 15,
    bookingsEnabled: true,
    announcementsEnabled: true,
    announcementsCount: 5,
    announcementsIntervalSec: 12,
    announcementsPinnedOnly: false,
    ...over,
  }) as DisplayConfigBuilding;

const pb = (id: number, name = `B${id}`, code: string | null = null) =>
  ({
    id,
    name,
    code,
    floors: [],
    displayViewMode: 'weekly',
    institute: null,
    rooms: [],
  }) as PublicBuilding;

describe('parseTvSafePct', () => {
  it('0 senza il parametro', () => {
    expect(parseTvSafePct('')).toBe(0);
    expect(parseTvSafePct('?b=x')).toBe(0);
  });
  it('3 se attivo senza valore o con valore non numerico', () => {
    expect(parseTvSafePct('?tvsafe')).toBe(3);
    expect(parseTvSafePct('?tvsafe=abc')).toBe(3);
  });
  it('valore clampato in [0, 15]', () => {
    expect(parseTvSafePct('?tvsafe=5.5')).toBe(5.5);
    expect(parseTvSafePct('?tvsafe=99')).toBe(15);
    expect(parseTvSafePct('?tvsafe=-4')).toBe(0);
  });
});

describe('buildRotationBuildings', () => {
  it('senza config: tutti gli edifici con intervallo 30s', () => {
    const out = buildRotationBuildings([pb(1), pb(2)], [], null);
    expect(out.map((b) => [b.id, b.intervalSec])).toEqual([
      [1, 30],
      [2, 30],
    ]);
  });
  it('con config: ordine e intervalli dell’admin, scarta edifici assenti dall’agenda', () => {
    const out = buildRotationBuildings(
      [pb(1), pb(2)],
      [cfg({ id: 2, intervalSec: 10 }), cfg({ id: 9 }), cfg({ id: 1, intervalSec: 20 })],
      null,
    );
    expect(out.map((b) => [b.id, b.intervalSec])).toEqual([
      [2, 10],
      [1, 20],
    ]);
  });
  it('slug richiesto: solo l’edificio corrispondente, altrimenti rotazione completa', () => {
    const all = [pb(1, 'Centrale', 'CEN'), pb(2, 'Nord', 'NOR')];
    expect(buildRotationBuildings(all, [], 'nor').map((b) => b.id)).toEqual([2]);
    expect(buildRotationBuildings(all, [], 'inesistente').map((b) => b.id)).toEqual([1, 2]);
  });
});

describe('aggregateConcertsConfig', () => {
  it('nessun edificio attivo → disabilitato', () => {
    expect(aggregateConcertsConfig([cfg({ concertsEnabled: false })])).toEqual({
      enabled: false,
      horizonDays: 0,
      cap: 0,
      intervalSec: 15,
    });
  });
  it('max di giorni/intervallo; count 0 = senza limite', () => {
    const r = aggregateConcertsConfig([
      cfg({ concertsDays: 10, concertsCount: 3, concertsIntervalSec: 10 }),
      cfg({ concertsDays: 40, concertsCount: 0, concertsIntervalSec: 25 }),
    ]);
    expect(r).toEqual({ enabled: true, horizonDays: 40, cap: 0, intervalSec: 25 });
  });
  it('orizzonte 0 giorni → non abilitato', () => {
    expect(aggregateConcertsConfig([cfg({ concertsDays: 0 })]).enabled).toBe(false);
  });
});

describe('aggregateAnnouncementsConfig', () => {
  it('nessun edificio attivo → disabilitato', () => {
    expect(aggregateAnnouncementsConfig([cfg({ announcementsEnabled: false })])).toEqual({
      enabled: false,
      cap: 0,
      intervalSec: 12,
      pinnedOnly: false,
    });
  });
  it('min intervallo, max cap (0 vince), pinnedOnly solo se tutti', () => {
    const r = aggregateAnnouncementsConfig([
      cfg({ announcementsCount: 4, announcementsIntervalSec: 20, announcementsPinnedOnly: true }),
      cfg({ announcementsCount: 9, announcementsIntervalSec: 8, announcementsPinnedOnly: false }),
    ]);
    expect(r).toEqual({ enabled: true, cap: 9, intervalSec: 8, pinnedOnly: false });
    expect(
      aggregateAnnouncementsConfig([cfg({ announcementsCount: 0 }), cfg({ announcementsCount: 4 })])
        .cap,
    ).toBe(0);
  });
});

describe('isBookingsRotationEnabled', () => {
  it('true se config vuota o almeno un edificio on', () => {
    expect(isBookingsRotationEnabled([])).toBe(true);
    expect(isBookingsRotationEnabled([cfg({ bookingsEnabled: false }), cfg({})])).toBe(true);
  });
  it('false se tutti off', () => {
    expect(isBookingsRotationEnabled([cfg({ bookingsEnabled: false })])).toBe(false);
  });
});

describe('buildSlides', () => {
  const concert = (id: number) => ({ id }) as never;
  const ann = (id: number) => ({ id }) as never;
  const base = {
    rotationBuildings: buildRotationBuildings([pb(1), pb(2)], [], null),
    bookingsEnabled: true,
    concertsConfig: { enabled: true, horizonDays: 30, cap: 2, intervalSec: 15 },
    concerts: [concert(1), concert(2), concert(3)],
    announcementsConfig: { enabled: true, cap: 0, intervalSec: 12, pinnedOnly: false },
    announcements: [ann(1), ann(2)],
  };
  it('ordine edifici → concerti (con cap) → annunci (cap 0 = tutti)', () => {
    const s = buildSlides(base);
    expect(s.map((x) => x.kind)).toEqual([
      'building',
      'building',
      'concert',
      'concert',
      'announcement',
      'announcement',
    ]);
    expect(s[2].intervalSec).toBe(15);
    expect(s[4].intervalSec).toBe(12);
  });
  it('rispetta i master switch', () => {
    const s = buildSlides({
      ...base,
      bookingsEnabled: false,
      concertsConfig: { ...base.concertsConfig, enabled: false },
    });
    expect(s.map((x) => x.kind)).toEqual(['announcement', 'announcement']);
  });
  it('dati non ancora caricati → nessuna slide extra', () => {
    const s = buildSlides({ ...base, concerts: undefined, announcements: undefined });
    expect(s.map((x) => x.kind)).toEqual(['building', 'building']);
  });
});

describe('slideDelayMs', () => {
  it('vincola a [5s, 600s]', () => {
    expect(slideDelayMs(1)).toBe(5000);
    expect(slideDelayMs(30)).toBe(30000);
    expect(slideDelayMs(9999)).toBe(600000);
  });
});

describe('computeConnectionStatus (offline-soft)', () => {
  const now = 1_000_000_000;
  it('live se nessun errore e agenda aggiornata di recente', () => {
    const s = computeConnectionStatus(
      { agendaError: false, statsError: false, agendaUpdatedAt: now - 1000 },
      now,
    );
    expect(s).toEqual({ isLive: true, hasCachedAgenda: true, showOfflineBanner: false });
  });
  it('banner se agenda vecchia > 2 minuti ma con dati cached', () => {
    const s = computeConnectionStatus(
      { agendaError: false, statsError: false, agendaUpdatedAt: now - STALE_AFTER_MS - 1 },
      now,
    );
    expect(s.isLive).toBe(false);
    expect(s.showOfflineBanner).toBe(true);
  });
  it('esattamente alla soglia non è più live', () => {
    const s = computeConnectionStatus(
      { agendaError: false, statsError: false, agendaUpdatedAt: now - STALE_AFTER_MS },
      now,
    );
    expect(s.isLive).toBe(false);
  });
  it('errore su agenda o stats → non live, banner se c’è cache', () => {
    expect(
      computeConnectionStatus({ agendaError: true, statsError: false, agendaUpdatedAt: now }, now)
        .showOfflineBanner,
    ).toBe(true);
    expect(
      computeConnectionStatus({ agendaError: false, statsError: true, agendaUpdatedAt: now }, now)
        .showOfflineBanner,
    ).toBe(true);
  });
  it('mai un fetch riuscito → nessun banner', () => {
    const s = computeConnectionStatus(
      { agendaError: true, statsError: true, agendaUpdatedAt: 0 },
      now,
    );
    expect(s).toEqual({ isLive: false, hasCachedAgenda: false, showOfflineBanner: false });
  });
});
