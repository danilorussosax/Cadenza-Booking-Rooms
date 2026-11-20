import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AllProviders } from '../../../test-utils';
import { useMonteOreGridData } from '@/components/monteOre/grid/useMonteOreGridData';
import type { MonteOreSlot, MonteOreTeacherActions } from '@/api/monteOre';

const getCalendar = vi.fn();
const getMySlots = vi.fn();
const getMyAmendments = vi.fn();
const toggleSlot = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));
vi.mock('@/api/monteOre', () => ({
  monteOreApi: {
    getCalendar: (...a: unknown[]) => getCalendar(...a),
    getMySlots: (...a: unknown[]) => getMySlots(...a),
    getMyAmendments: (...a: unknown[]) => getMyAmendments(...a),
    toggleSlot: (...a: unknown[]) => toggleSlot(...a),
  },
}));

const none: MonteOreTeacherActions = {
  editPattern: false,
  selectDates: false,
  submit: false,
  requestAmendment: false,
  viewAmendments: false,
};

const wrapper = ({ children }: { children: ReactNode }) => <AllProviders>{children}</AllProviders>;

const slot = (id: number, date: string, active: boolean): MonteOreSlot =>
  ({
    id,
    date,
    startTime: '09:00',
    endTime: '11:00',
    isActive: active,
    isLocked: false,
  }) as MonteOreSlot;

describe('useMonteOreGridData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCalendar.mockResolvedValue({ settings: {}, weeks: [] });
    getMySlots.mockResolvedValue({
      slots: [
        slot(1, '2026-01-05', true),
        slot(2, '2026-01-05', false),
        slot(3, '2026-01-06', true),
      ],
    });
    getMyAmendments.mockResolvedValue({ amendments: [] });
    toggleSlot.mockResolvedValue({});
  });

  it('raggruppa gli slot per data e somma le ore attive', async () => {
    const { result } = renderHook(() => useMonteOreGridData('2026/2027', none), { wrapper });
    await waitFor(() => expect(result.current.slotsByDate.size).toBe(2));
    expect(result.current.slotsByDate.get('2026-01-05')).toHaveLength(2);
    expect(result.current.activeTotal).toBe(4);
    expect(result.current.editable).toBe(false);
  });

  it('non carica le variazioni senza viewAmendments', async () => {
    renderHook(() => useMonteOreGridData(undefined, none), { wrapper });
    await waitFor(() => expect(getMySlots).toHaveBeenCalled());
    expect(getMyAmendments).not.toHaveBeenCalled();
  });

  it('handleToggle: selectDates muta direttamente, requestAmendment apre l editor', async () => {
    const direct = renderHook(
      () => useMonteOreGridData(undefined, { ...none, selectDates: true }),
      { wrapper },
    );
    act(() => direct.result.current.handleToggle(5));
    await waitFor(() => expect(toggleSlot).toHaveBeenCalledWith(5));
    expect(direct.result.current.requestOpen).toBe(false);

    toggleSlot.mockClear();
    const amend = renderHook(
      () => useMonteOreGridData(undefined, { ...none, requestAmendment: true }),
      { wrapper },
    );
    act(() => amend.result.current.handleToggle(5));
    expect(amend.result.current.requestOpen).toBe(true);
    expect(toggleSlot).not.toHaveBeenCalled();
  });

  it('gestisce periodo e slot in spostamento', () => {
    const { result } = renderHook(() => useMonteOreGridData(undefined, none), { wrapper });
    act(() => result.current.setPeriod({ from: '2026-01-01', to: '2026-01-31', day: '2' }));
    expect(result.current.period).toEqual({ from: '2026-01-01', to: '2026-01-31', day: '2' });
    const s = slot(9, '2026-01-05', true);
    act(() => result.current.handleRequestMove(s));
    expect(result.current.movingSlot).toBe(s);
  });
});
