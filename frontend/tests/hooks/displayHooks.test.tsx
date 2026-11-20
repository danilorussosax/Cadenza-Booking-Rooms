import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSlideRotation } from '@/hooks/useSlideRotation';
import { useDisplayConnection } from '@/hooks/useDisplayConnection';
import { useClock } from '@/hooks/useClock';
import { useDebugInfo } from '@/hooks/useDebugInfo';
import { useFullscreen } from '@/hooks/useFullscreen';
import type { Slide } from '@/lib/displayRotation';

const slide = (id: number, intervalSec: number): Slide =>
  ({ kind: 'announcement', announcement: { id }, intervalSec }) as unknown as Slide;

describe('useSlideRotation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('con 0 o 1 slide non avanza e currentSlide riflette la lista', () => {
    const { result: empty } = renderHook(() => useSlideRotation([]));
    expect(empty.current.currentSlide).toBeNull();
    const one = [slide(1, 5)];
    const { result } = renderHook(() => useSlideRotation(one));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.currentSlide).toBe(one[0]);
  });

  it('avanza usando l’intervallo di ciascuna slide e fa il loop', () => {
    const slides = [slide(1, 10), slide(2, 20), slide(3, 5)];
    const { result } = renderHook(() => useSlideRotation(slides));
    expect(result.current.currentIndex).toBe(0);
    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(result.current.currentIndex).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.currentIndex).toBe(1);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(result.current.currentIndex).toBe(2);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.currentIndex).toBe(0);
  });

  it('vincola la durata a un minimo di 5 secondi', () => {
    const slides = [slide(1, 1), slide(2, 1)];
    const { result } = renderHook(() => useSlideRotation(slides));
    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(result.current.currentIndex).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.currentIndex).toBe(1);
  });

  it('se la lista si accorcia sotto l’indice corrente torna a 0', () => {
    const three = [slide(1, 5), slide(2, 5), slide(3, 5)];
    const { result, rerender } = renderHook(({ s }) => useSlideRotation(s), {
      initialProps: { s: three },
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.currentIndex).toBe(2);
    rerender({ s: [slide(1, 5), slide(2, 5)] });
    expect(result.current.currentIndex).toBe(0);
  });

  it('un nuovo array di slide riavvia il timer (stesso ciclo di vita dell’effetto)', () => {
    const a = [slide(1, 10), slide(2, 10)];
    const { result, rerender } = renderHook(({ s }) => useSlideRotation(s), {
      initialProps: { s: a },
    });
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    rerender({ s: [...a] });
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(result.current.currentIndex).toBe(0);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.currentIndex).toBe(1);
  });

  it('pulisce il timer allo smontaggio', () => {
    const { unmount } = renderHook(() => useSlideRotation([slide(1, 5), slide(2, 5)]));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useDisplayConnection (offline-soft)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T10:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('live: nessun banner', () => {
    const { result } = renderHook(() =>
      useDisplayConnection({
        agendaError: false,
        statsError: false,
        agendaUpdatedAt: Date.now() - 30_000,
      }),
    );
    expect(result.current.isLive).toBe(true);
    expect(result.current.showOfflineBanner).toBe(false);
  });

  it('dopo > 2 minuti senza aggiornamenti mostra il banner con l’ultimo orario', () => {
    const updatedAt = Date.now();
    const { result, rerender } = renderHook(() =>
      useDisplayConnection({ agendaError: false, statsError: false, agendaUpdatedAt: updatedAt }),
    );
    expect(result.current.showOfflineBanner).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2 * 60_000 + 1);
    });
    rerender();
    expect(result.current.isLive).toBe(false);
    expect(result.current.showOfflineBanner).toBe(true);
    expect(result.current.lastUpdateLabel).toBe('10:00');
  });

  it('senza fetch riuscito: niente banner e label "—"', () => {
    const { result } = renderHook(() =>
      useDisplayConnection({ agendaError: true, statsError: true, agendaUpdatedAt: 0 }),
    );
    expect(result.current.showOfflineBanner).toBe(false);
    expect(result.current.lastUpdateLabel).toBe('—');
  });
});

describe('useClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T10:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('si aggiorna ogni secondo e pulisce l’intervallo', () => {
    const { result, unmount } = renderHook(() => useClock());
    expect(result.current.format('HH:mm:ss')).toBe('10:00:00');
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.format('HH:mm:ss')).toBe('10:00:03');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useDebugInfo', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.useRealTimers();
  });

  it('null senza ?debug e nessun timer attivo', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDebugInfo());
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('con ?debug restituisce lo snapshot e lo aggiorna ogni secondo', () => {
    window.history.replaceState({}, '', '/display?debug=1');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useDebugInfo());
    expect(result.current?.innerW).toBe(window.innerWidth);
    Object.defineProperty(window, 'innerWidth', { value: 2000, configurable: true });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current?.innerW).toBe(2000);
    expect(result.current?.category).toBe('FHD');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe('useFullscreen', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'fullscreenElement');
    vi.restoreAllMocks();
  });

  it('enter usa requestFullscreen se disponibile, altrimenti il prefisso webkit', async () => {
    const { result } = renderHook(() => useFullscreen());
    const el = document.documentElement as unknown as Record<string, unknown>;
    const req = vi.fn().mockResolvedValue(undefined);
    el.requestFullscreen = req;
    await act(async () => {
      await result.current.enter();
    });
    expect(req).toHaveBeenCalledTimes(1);

    el.requestFullscreen = undefined;
    const webkit = vi.fn().mockResolvedValue(undefined);
    el.webkitRequestFullscreen = webkit;
    await act(async () => {
      await result.current.enter();
    });
    expect(webkit).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(el, 'requestFullscreen');
    Reflect.deleteProperty(el, 'webkitRequestFullscreen');
  });

  it('exit usa exitFullscreen o il prefisso webkit e ignora gli errori', async () => {
    const { result } = renderHook(() => useFullscreen());
    const d = document as unknown as Record<string, unknown>;
    d.exitFullscreen = vi.fn().mockRejectedValue(new Error('no'));
    await act(async () => {
      await result.current.exit();
    });
    expect(d.exitFullscreen).toHaveBeenCalledTimes(1);

    d.exitFullscreen = undefined;
    const webkit = vi.fn().mockResolvedValue(undefined);
    d.webkitExitFullscreen = webkit;
    await act(async () => {
      await result.current.exit();
    });
    expect(webkit).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(d, 'exitFullscreen');
    Reflect.deleteProperty(d, 'webkitExitFullscreen');
  });

  it('segue gli eventi fullscreenchange', () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.isFullscreen).toBe(false);
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.body,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(result.current.isFullscreen).toBe(true);
  });
});
