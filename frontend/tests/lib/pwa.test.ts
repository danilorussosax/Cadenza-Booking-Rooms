import { describe, it, expect, beforeEach } from 'vitest';
import { bumpVisitCount, getVisitCount, isA2hsDismissed, setA2hsDismissed } from '@/lib/pwa';

describe('lib/pwa', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('bumpVisitCount: parte da 0, sale di 1 ogni call', () => {
    expect(getVisitCount()).toBe(0);
    expect(bumpVisitCount()).toBe(1);
    expect(bumpVisitCount()).toBe(2);
    expect(getVisitCount()).toBe(2);
  });

  it('isA2hsDismissed: false di default', () => {
    expect(isA2hsDismissed()).toBe(false);
  });

  it('setA2hsDismissed → isA2hsDismissed === true', () => {
    setA2hsDismissed();
    expect(isA2hsDismissed()).toBe(true);
  });

  it('localStorage corruption → fallback safe', () => {
    localStorage.setItem('cadenza:visit_count', 'not-a-number');
    expect(getVisitCount()).toBe(0);
  });
});
