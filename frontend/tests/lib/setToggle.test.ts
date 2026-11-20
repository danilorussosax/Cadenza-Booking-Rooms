import { describe, expect, it } from 'vitest';
import { toggleSetItem, toggleSetItems } from '@/lib/setToggle';

describe('lib/setToggle', () => {
  it('toggleSetItem aggiunge e rimuove senza mutare l’originale', () => {
    const a = new Set([1]);
    const b = toggleSetItem(a, 2);
    expect([...b]).toEqual([1, 2]);
    expect([...a]).toEqual([1]);
    expect([...toggleSetItem(b, 1)]).toEqual([2]);
  });

  it('toggleSetItems aggiunge tutti se ne manca almeno uno', () => {
    expect([...toggleSetItems(new Set([1]), [1, 2, 3])].sort()).toEqual([1, 2, 3]);
  });

  it('toggleSetItems rimuove tutti se già tutti presenti', () => {
    expect([...toggleSetItems(new Set([1, 2, 3, 9]), [1, 2, 3])]).toEqual([9]);
  });
});
