import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor, fireEvent } from '../../test-utils';
import { HttpError } from '@/lib/api';
import { ContractTypesPanel } from '@/components/admin/ContractTypesPanel';
import type { ContractTypeRow } from '@/types';

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (m: string) => toastError(m), info: vi.fn() },
  Toaster: () => null,
}));

const listMock = vi.fn();
const updateMock = vi.fn();
const impactMock = vi.fn();
vi.mock('@/api/contractTypes', () => ({
  contractTypesApi: {
    list: () => listMock(),
    update: (id: number, payload: unknown) => updateMock(id, payload),
    impact: (id: number) => impactMock(id),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

const row: ContractTypeRow = {
  id: 5,
  instituteId: 1,
  code: 'supplente',
  label: 'Supplente',
  defaultHours: 100,
  hoursMode: 'minimum',
  requiresIndividualHours: false,
  bypassDayConstraintDefault: false,
  isSystem: false,
  isActive: true,
  sortOrder: 1,
};

const impact = {
  contractType: { id: 5, code: 'supplente', label: 'Supplente', defaultHours: 100 },
  usersAffectedCount: 3,
  usersAffected: [],
  usersWithOverrideCount: 0,
  draftProposalsCount: 0,
};

async function submitEdit() {
  renderWithProviders(<ContractTypesPanel />);
  const editButtons = await screen.findAllByLabelText('Modifica Supplente');
  fireEvent.click(editButtons[0]!);
  fireEvent.click(await screen.findByRole('button', { name: 'Salva modifiche' }));
}

describe('ContractTypesPanel · conferma impatto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue({ contractTypes: [row] });
    impactMock.mockResolvedValue(impact);
  });

  it('un 409 IMPACT_CONFIRM_REQUIRED (HttpError.payload) apre il dialog di impatto', async () => {
    updateMock.mockRejectedValue(
      new HttpError(409, {
        error: 'Conferma impatto richiesta',
        code: 'IMPACT_CONFIRM_REQUIRED',
        usersAffectedCount: 3,
      }),
    );
    await submitEdit();
    expect(await screen.findByText('Conferma cambio soglia ore')).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('un altro errore HTTP mostra il toast e non apre il dialog', async () => {
    updateMock.mockRejectedValue(new HttpError(409, { error: 'Codice già esistente', code: 'X' }));
    await submitEdit();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByText('Conferma cambio soglia ore')).toBeNull();
  });
});
