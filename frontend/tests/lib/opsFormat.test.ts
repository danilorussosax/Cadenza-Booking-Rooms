import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsScheduler } from '@/api/ops';
import { fmtBytes, fmtDuration, fmtRelative, isStale } from '@/lib/opsFormat';

describe('opsFormat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fmtBytes', () => {
    expect(fmtBytes(null)).toBe('—');
    expect(fmtBytes(NaN)).toBe('—');
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(1536)).toBe('1.5 KB');
    expect(fmtBytes(20 * 1024 * 1024)).toBe('20 MB');
  });

  it('fmtDuration', () => {
    expect(fmtDuration(undefined)).toBe('—');
    expect(fmtDuration(30)).toBe('30s');
    expect(fmtDuration(120)).toBe('2min');
    expect(fmtDuration(7200)).toBe('2.0h');
    expect(fmtDuration(172_800)).toBe('2g');
  });

  it('fmtRelative', () => {
    expect(fmtRelative(null)).toBe('—');
    expect(fmtRelative('2026-01-01T11:59:30Z')).toBe('30s fa');
    expect(fmtRelative('2026-01-01T11:00:00Z')).toBe('1.0h fa');
    expect(fmtRelative('2026-01-01T12:02:00Z')).toBe('tra 2min');
  });

  it('isStale', () => {
    const base = { name: 'x', enabled: true, intervalMs: 1000 } as OpsScheduler;
    expect(isStale({ ...base, lastTickAt: '2026-01-01T11:59:59Z' })).toBe(false);
    expect(isStale({ ...base, lastTickAt: '2026-01-01T11:59:50Z' })).toBe(true);
    expect(isStale({ ...base, enabled: false, lastTickAt: '2020-01-01T00:00:00Z' })).toBe(false);
    expect(isStale({ ...base, lastTickAt: null })).toBe(false);
  });
});
