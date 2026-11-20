import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from '../test-utils';
import MonteOre from '@/pages/MonteOre';
import type { MonteOreProposal, MonteOreWorkflowState } from '@/api/monteOre';

const getMine = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));
vi.mock('@/components/monteOre/MonteOreGrid', () => ({ default: () => null }));
vi.mock('@/api/rooms', () => ({ roomsApi: { list: () => Promise.resolve([]) } }));
vi.mock('@/api/monteOre', () => ({
  monteOreApi: {
    getAcademicYearForTeacher: () =>
      Promise.resolve({ items: [{ academicYear: '2026/2027', status: 'published' }] }),
    getMine: (...args: unknown[]) => getMine(...args),
    getMyThreshold: () => Promise.resolve(undefined),
  },
}));

const workflow = (over: Partial<MonteOreWorkflowState> = {}): MonteOreWorkflowState => ({
  status: 'draft',
  ready: false,
  blockers: [],
  actions: {
    teacher: {
      editPattern: true,
      selectDates: true,
      submit: false,
      requestAmendment: false,
      viewAmendments: false,
    },
    admin: {
      approve: false,
      reject: false,
      revertToDraft: false,
      unlock: false,
      editSchedules: true,
      reviewAmendments: false,
      revalidate: false,
    },
  },
  ...over,
});

const proposal = (over: Partial<MonteOreProposal> = {}): MonteOreProposal =>
  ({
    id: 1,
    userId: 1,
    academicYear: '2026/2027',
    validFrom: '2026-11-01',
    validTo: '2027-10-31',
    totalHoursRequested: 0,
    totalHoursPlanned: 0,
    status: 'draft',
    notes: null,
    schedules: [
      {
        id: 1,
        dayOfWeek: 1,
        startTime: '10:00',
        endTime: '12:00',
        roomId: null,
        bookingType: 'lezione',
      },
    ],
    ...over,
  }) as unknown as MonteOreProposal;

describe('MonteOre page: blocchi e azioni dal server', () => {
  beforeEach(() => getMine.mockReset());

  it('mostra i blocchi restituiti dal server e disabilita l invio', async () => {
    getMine.mockResolvedValue({
      proposal: proposal({
        workflow: workflow({
          blockers: [{ code: 'HOURS_BELOW_THRESHOLD', message: 'Servono almeno 100 ore' }],
        }),
      }),
    });
    renderWithProviders(<MonteOre />);
    expect(await screen.findByText('Servono almeno 100 ore')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invia al coordinatore/ })).toBeDisabled();
  });

  it('abilita l invio quando il server dichiara submit consentito', async () => {
    getMine.mockResolvedValue({
      proposal: proposal({
        workflow: workflow({
          ready: true,
          actions: {
            teacher: {
              editPattern: true,
              selectDates: true,
              submit: true,
              requestAmendment: false,
            },
            admin: workflow().actions.admin,
          },
        }),
      }),
    });
    renderWithProviders(<MonteOre />);
    const button = await screen.findByRole('button', { name: /Invia al coordinatore/ });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText(/Per inviare la proposta/)).not.toBeInTheDocument();
  });
});
