import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('lib/utils.cn', () => {
  it('concatena classi', () => {
    expect(cn('a', 'b')).toBe('a b');
  });
  it('rimuove duplicati con tailwind-merge (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
  it('gestisce condizionali (clsx)', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
    expect(cn('a', undefined, null, 'b')).toBe('a b');
  });
  it('input vuoto → ""', () => {
    expect(cn()).toBe('');
  });
});
