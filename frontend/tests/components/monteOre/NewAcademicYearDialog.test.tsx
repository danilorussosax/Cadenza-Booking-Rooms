import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '../../test-utils';
import { NewAcademicYearDialog } from '@/components/monteOre/NewAcademicYearDialog';

const previewMock = vi.fn();
const createMock = vi.fn();
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/monteOre', () => ({
  monteOreAdminApi: {
    previewAcademicYear: (...args: unknown[]) => previewMock(...args),
    createAcademicYear: (...args: unknown[]) => createMock(...args),
  },
}));
const preview = () => ({
  settings: {
    academicYear: '2026/2027',
    academicYearStart: '2026-11-01',
    academicYearEnd: '2027-10-31',
    lessonsStartDate: '2026-11-02',
    lessonsEndDate: '2027-10-31',
    submissionWindowStart: '2026-09-01',
    submissionWindowEnd: '2026-10-31',
    minRequiredHours: 324,
    maxAmendmentsPerYear: 3,
  },
  suspensions: [],
  warnings: [],
  availableDays: [0, 50, 50, 50, 50, 50, 50],
});
const props = { open: true, onClose: vi.fn(), existingYears: [], suggestedYear: '2026/2027' };
beforeEach(() => {
  vi.clearAllMocks();
  previewMock.mockResolvedValue(preview());
  createMock.mockResolvedValue({ settings: { status: 'draft' } });
});

describe('New academic year wizard', () => {
  it('requires a preview before creating and can save a draft', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewAcademicYearDialog {...props} />);
    expect(screen.queryByRole('button', { name: 'Salva bozza' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Controlla anteprima' }));
    await user.click(await screen.findByRole('button', { name: 'Salva bozza' }));
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ academicYear: '2026/2027', publish: false }),
      ),
    );
  });
  it('editing preview requires revalidation before publication', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewAcademicYearDialog {...props} />);
    await user.click(screen.getByRole('button', { name: 'Controlla anteprima' }));
    const hours = await screen.findByLabelText('Soglia minima ore');
    await user.clear(hours);
    await user.type(hours, '200');
    expect(screen.queryByRole('button', { name: 'Pubblica anno' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aggiorna anteprima' }));
    await user.click(await screen.findByRole('button', { name: 'Pubblica anno' }));
    expect(previewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ minRequiredHours: 200 }) }),
    );
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ publish: true })),
    );
  });
  it('resets on reopening with a different suggested year', async () => {
    const { rerender } = renderWithProviders(<NewAcademicYearDialog {...props} />);
    rerender(<NewAcademicYearDialog {...props} open={false} />);
    rerender(<NewAcademicYearDialog {...props} suggestedYear="2027/2028" />);
    expect(screen.getByLabelText('Anno accademico')).toHaveValue('2027/2028');
  });
  it('blocks invalid and existing years', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewAcademicYearDialog {...props} suggestedYear="2026/2028" />);
    expect(screen.getByRole('button', { name: 'Controlla anteprima' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Anno accademico'));
    expect(screen.getByRole('button', { name: 'Controlla anteprima' })).toBeDisabled();
  });
  it('shows server errors without allowing a save', async () => {
    previewMock.mockRejectedValue(new Error('Calendario non valido'));
    renderWithProviders(<NewAcademicYearDialog {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Controlla anteprima' }));
    expect(await screen.findByText('Calendario non valido')).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
