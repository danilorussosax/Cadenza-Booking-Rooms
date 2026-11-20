import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from '../../test-utils';
import MonteOreGrid from '@/components/monteOre/MonteOreGrid';
import type { MonteOreTeacherActions } from '@/api/monteOre';

const getCalendar = vi.fn();
const getMySlots = vi.fn();
const getMyAmendments = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));
vi.mock('@/api/rooms', () => ({ roomsApi: { list: () => Promise.resolve([]) } }));
vi.mock('@/api/monteOre', () => ({
  monteOreApi: {
    getCalendar: (...a: unknown[]) => getCalendar(...a),
    getMySlots: (...a: unknown[]) => getMySlots(...a),
    getMyAmendments: (...a: unknown[]) => getMyAmendments(...a),
  },
  amendmentSummary: () => '',
}));

const none: MonteOreTeacherActions = {
  editPattern: false,
  selectDates: false,
  submit: false,
  requestAmendment: false,
  viewAmendments: false,
};

// Specchio delle azioni docente calcolate dal server per ogni stato.
const direct = { ...none, editPattern: true, selectDates: true };
const amend = { ...none, requestAmendment: true, viewAmendments: true };
const CASES: [string, MonteOreTeacherActions, 'direct' | 'amend' | 'none'][] = [
  ['draft', direct, 'direct'],
  ['rejected', direct, 'direct'],
  ['submitted', none, 'none'],
  ['approved', amend, 'amend'],
  ['generated', amend, 'amend'],
  // requiresRevalidation: il server rifiuta le variazioni (REVALIDATION_REQUIRED)
  ['approved + requiresRevalidation', { ...none, viewAmendments: true }, 'none'],
  ['generated + requiresRevalidation', { ...none, viewAmendments: true }, 'none'],
];

describe('MonteOreGrid: gating dalle azioni del server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCalendar.mockResolvedValue({
      settings: {
        lessonsStartDate: '2026-09-01',
        lessonsEndDate: '2027-06-30',
        minRequiredHours: 10,
        maxAmendmentsPerYear: 5,
      },
      weeks: [],
    });
    getMySlots.mockResolvedValue({ slots: [] });
    getMyAmendments.mockResolvedValue({ amendments: [] });
  });

  it.each(CASES)('%s', async (_label, actions, mode) => {
    renderWithProviders(<MonteOreGrid actions={actions} isPatternEmpty={false} proposalId={1} />);
    await screen.findByText('Calendario didattico', { exact: false });
    const count = (text: string) => screen.queryAllByText(text, { exact: false }).length;

    expect(count('Rigenera dalla Sezione A') > 0).toBe(mode === 'direct');
    expect(screen.queryAllByLabelText('monteWorkflow.start').length > 0).toBe(mode === 'direct');
    expect(count('Richiedi nuovo giorno') > 0).toBe(mode === 'amend');
    expect(count('monteWorkflow.budgetHelp') > 0).toBe(mode === 'amend');
    expect(count('monteWorkflow.request') > 0).toBe(mode === 'amend');
    await waitFor(() => {
      expect(getMyAmendments).toHaveBeenCalledTimes(actions.viewAmendments ? 1 : 0);
    });
  });
});
