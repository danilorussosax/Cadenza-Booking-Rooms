import { describe, it, expect } from 'vitest';
import { projectMonteOreHours } from '@/lib/monteOreProjection';
import type { AmendmentOperation, MonteOreSlot } from '@/api/monteOre';

const slot = (id: number, over: Partial<MonteOreSlot> = {}): MonteOreSlot =>
  ({
    id,
    startTime: '10:00',
    endTime: '12:00',
    isActive: true,
    isLocked: false,
    ...over,
  }) as MonteOreSlot;

const op = (o: Record<string, unknown>) => o as unknown as AmendmentOperation;

describe('projectMonteOreHours', () => {
  it('somma le ore degli slot attivi e non bloccati', () => {
    const slots = [
      slot(1),
      slot(2, { startTime: '14:00', endTime: '15:30' }),
      slot(3, { isActive: false }),
      slot(4, { isLocked: true }),
    ];
    expect(projectMonteOreHours(slots, [])).toBe(3.5);
  });

  it('toggle_off e toggle_on', () => {
    const slots = [slot(1), slot(2)];
    expect(projectMonteOreHours(slots, [op({ kind: 'toggle_off', slotId: 1 })])).toBe(2);
    expect(
      projectMonteOreHours(slots, [
        op({ kind: 'toggle_off', slotId: 1 }),
        op({ kind: 'toggle_on', slotId: 1 }),
      ]),
    ).toBe(4);
  });

  it('change_time aggiorna solo i campi forniti', () => {
    const slots = [slot(1)];
    expect(
      projectMonteOreHours(slots, [
        op({ kind: 'change_time', slotId: 1, payload: { endTime: '13:00' } }),
      ]),
    ).toBe(3);
  });

  it('add_new_day aggiunge uno slot, ma richiede orari', () => {
    const slots = [slot(1)];
    expect(
      projectMonteOreHours(slots, [
        op({ kind: 'add_new_day', payload: { startTime: '09:00', endTime: '10:00' } }),
      ]),
    ).toBe(3);
    expect(projectMonteOreHours(slots, [op({ kind: 'add_new_day', payload: {} })])).toBeNull();
  });

  it('move_to disattiva la sorgente e attiva il target', () => {
    const slots = [slot(1), slot(2, { isActive: false, endTime: '11:00' })];
    expect(
      projectMonteOreHours(slots, [
        op({ kind: 'move_to', slotId: 1, payload: { targetSlotId: 2 } }),
      ]),
    ).toBe(1);
    expect(
      projectMonteOreHours(slots, [
        op({ kind: 'move_to', slotId: 1, payload: { targetSlotId: 99 } }),
      ]),
    ).toBeNull();
  });

  it('slot inesistente o durata non valida → null', () => {
    expect(projectMonteOreHours([slot(1)], [op({ kind: 'toggle_off', slotId: 42 })])).toBeNull();
    expect(
      projectMonteOreHours([slot(1, { startTime: '12:00', endTime: '10:00' })], []),
    ).toBeNull();
  });

  it('non muta gli slot in ingresso', () => {
    const slots = [slot(1)];
    projectMonteOreHours(slots, [op({ kind: 'toggle_off', slotId: 1 })]);
    expect(slots[0].isActive).toBe(true);
  });
});
