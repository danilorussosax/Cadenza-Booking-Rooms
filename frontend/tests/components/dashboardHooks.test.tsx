import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useCalendarPrefs } from '@/pages/dashboard/useCalendarPrefs';
import { buildStats, computeUsageDisplay, type StatsContext } from '@/pages/dashboard/buildStats';
import type { TFunction } from 'i18next';
import type { BookingUsage } from '@/types';

const t = ((k: string) => k) as unknown as TFunction;

describe('useCalendarPrefs', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('parte da single e persiste la vista a 3 giorni', () => {
    const { result } = renderHook(() => useCalendarPrefs());
    expect(result.current.calendarRange).toBe('single');
    expect(result.current.calendarDaysCount).toBe(1);
    act(() => {
      result.current.setCalendarRange('three');
    });
    expect(result.current.calendarDaysCount).toBe(3);
    expect(window.localStorage.getItem('cadenza:dashboard-calendar-range')).toBe('three');

    const again = renderHook(() => useCalendarPrefs());
    expect(again.result.current.calendarRange).toBe('three');
  });

  it('weekStart e il lunedi ISO del giorno scelto', () => {
    const { result } = renderHook(() => useCalendarPrefs());
    act(() => {
      result.current.setDayStart('2026-11-18'); // mercoledi
    });
    expect(result.current.weekStart).toBe('2026-11-16');
  });
});

describe('useMediaQuery', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it('segue i cambi della media query', () => {
    let handler: ((e: MediaQueryListEvent) => void) | undefined;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: (_: string, h: (e: MediaQueryListEvent) => void) => {
        handler = h;
      },
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);
    act(() => {
      handler?.({ matches: true } as MediaQueryListEvent);
    });
    expect(result.current).toBe(true);
  });
});

describe('buildStats', () => {
  const ctx: StatsContext = {
    t,
    isAdmin: false,
    isDocente: false,
    isDesktop: true,
    upcomingCount: 2,
    roomsCount: 5,
    next: undefined,
    usageLoading: false,
    usageDisplay: { value: '3h', hint: 'h' },
    hasMonteOreOverride: false,
    monteOreThreshold: undefined,
    monteOrePlanned: undefined,
    monteOreLoading: false,
    bookingsPending: { loading: false, count: 4 },
    amendmentsPending: { loading: true, count: 0 },
    activeLoansCount: 1,
    pendingLoansCount: 2,
    showLoansCard: false,
  };

  it('utente standard: prenotazioni, ore residue, aule, prossima sessione', () => {
    const tiles = buildStats(ctx);
    expect(tiles.map((s) => s.label)).toEqual([
      'dashboard.stats.active_bookings',
      'dashboard.stats.weekly_remaining_hours',
      'dashboard.stats.available_rooms',
      'dashboard.stats.next_session',
    ]);
    expect(tiles[0].value).toBe(2);
    expect(tiles[1].value).toBe('3h');
  });

  it('admin: tile approvazioni cliccabili con caricamento', () => {
    const tiles = buildStats({ ...ctx, isAdmin: true, showLoansCard: true });
    expect(tiles.map((s) => s.to)).toEqual([
      undefined,
      undefined,
      '/admin/approvals',
      '/admin/monte-ore',
      undefined,
    ]);
    expect(tiles[2].value).toBe(4);
    expect(tiles[3].value).toBe('—');
  });

  it('docente con override Monte Ore: link solo su desktop', () => {
    const base = {
      ...ctx,
      isDocente: true,
      hasMonteOreOverride: true,
      monteOreThreshold: { minHours: 10, mode: 'minimum', contractType: 'supplente' },
      monteOrePlanned: 12,
    } as unknown as StatsContext;
    const desktop = buildStats(base)[1];
    expect(desktop.label).toBe('Monte Ore annuali');
    expect(desktop.value).toBe('12.0 / 10 h');
    expect(desktop.hint).toBe('✓ Piano conforme · supplente');
    expect(desktop.to).toBe('/monte-ore');
    expect(buildStats({ ...base, isDesktop: false })[1].to).toBeUndefined();
  });
});

describe('computeUsageDisplay', () => {
  it('senza dati, illimitato e con quota', () => {
    expect(computeUsageDisplay(undefined, t)).toEqual({ value: '—', hint: '' });
    const unlimited = { unlimited: true, weekly: { max: null, usedHours: 1 } } as BookingUsage;
    expect(computeUsageDisplay(unlimited, t).value).toBe('∞');
    const limited = {
      unlimited: false,
      weekly: { max: 5, usedHours: 2, remainingHours: 3 },
    } as BookingUsage;
    expect(computeUsageDisplay(limited, t).value).toBe('3h');
  });
});
