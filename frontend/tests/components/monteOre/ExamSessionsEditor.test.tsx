import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '../../test-utils';
import { ExamSessionsEditor } from '@/components/monteOre/ExamSessionsEditor';
import type { MonteOreSuspension } from '@/api/monteOre';

const listExamSessionsMock = vi.fn();
const createExamSessionMock = vi.fn();
const updateExamSessionMock = vi.fn();
const deleteExamSessionMock = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/api/monteOre', async () => {
  return {
    monteOreAdminApi: {
      listExamSessions: (...args: unknown[]) => listExamSessionsMock(...args),
      createExamSession: (...args: unknown[]) => createExamSessionMock(...args),
      updateExamSession: (...args: unknown[]) => updateExamSessionMock(...args),
      deleteExamSession: (...args: unknown[]) => deleteExamSessionMock(...args),
    },
  };
});

const mkSession = (overrides: Partial<MonteOreSuspension> = {}): MonteOreSuspension => ({
  id: 1,
  instituteId: 1,
  academicYear: '2026/2027',
  name: 'Sessione invernale',
  dateFrom: '2027-01-15',
  dateTo: '2027-02-15',
  kind: 'partial',
  category: 'exam_session',
  notes: null,
  ...overrides,
});

describe('<ExamSessionsEditor />', () => {
  beforeEach(() => {
    listExamSessionsMock.mockReset();
    createExamSessionMock.mockReset();
    updateExamSessionMock.mockReset();
    deleteExamSessionMock.mockReset();
  });

  it('mostra titolo card + bottone "Aggiungi sessione"', async () => {
    listExamSessionsMock.mockResolvedValue({ examSessions: [] });
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    expect(screen.getByText(/Sessioni d'esame/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aggiungi sessione/i })).toBeInTheDocument();
  });

  it('mostra empty state quando non ci sono sessioni', async () => {
    listExamSessionsMock.mockResolvedValue({ examSessions: [] });
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    await waitFor(() =>
      expect(screen.queryByText(/Nessuna sessione d'esame configurata/i)).toBeInTheDocument(),
    );
  });

  it('renderizza le righe quando ci sono sessioni', async () => {
    listExamSessionsMock.mockResolvedValue({
      examSessions: [
        mkSession({ id: 1, name: 'Invernale' }),
        mkSession({
          id: 2,
          name: 'Estiva',
          dateFrom: '2027-06-01',
          dateTo: '2027-07-15',
          notes: 'Solo orali',
        }),
      ],
    });
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    await waitFor(() => expect(screen.queryByText('Invernale')).toBeInTheDocument());
    expect(screen.getByText('Estiva')).toBeInTheDocument();
    expect(screen.getByText('Solo orali')).toBeInTheDocument();
    expect(screen.getByText('2027-01-15')).toBeInTheDocument();
  });

  it('click "Aggiungi sessione" apre dialog con campi vuoti', async () => {
    listExamSessionsMock.mockResolvedValue({ examSessions: [] });
    const user = userEvent.setup();
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    await user.click(screen.getByRole('button', { name: /Aggiungi sessione/i }));
    expect(screen.getByText(/Nuova sessione d'esame/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome/i)).toHaveValue('');
    // Bottone "Crea" disabilitato (form vuoto)
    expect(screen.getByRole('button', { name: /^Crea$/i })).toBeDisabled();
  });

  it('compila il form, submit chiama createExamSession con payload', async () => {
    listExamSessionsMock.mockResolvedValue({ examSessions: [] });
    createExamSessionMock.mockResolvedValue({ examSession: mkSession() });
    const user = userEvent.setup();
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    await user.click(screen.getByRole('button', { name: /Aggiungi sessione/i }));
    await user.type(screen.getByLabelText(/Nome/i), 'Sessione test');
    // Date inputs: fireEvent diretto perché user.type su input type=date in jsdom è inaffidabile
    const fromInput = screen.getByLabelText(/^Dal$/i) as HTMLInputElement;
    const toInput = screen.getByLabelText(/^Al$/i) as HTMLInputElement;
    // userEvent v14 può non gestire type=date; usiamo fireEvent.change
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(fromInput, { target: { value: '2027-01-10' } });
    fireEvent.change(toInput, { target: { value: '2027-01-25' } });
    expect(fromInput.value).toBe('2027-01-10');
    expect(toInput.value).toBe('2027-01-25');
    const createBtn = screen.getByRole('button', { name: /^Crea$/i });
    expect(createBtn).not.toBeDisabled();
    await user.click(createBtn);
    await waitFor(() => expect(createExamSessionMock).toHaveBeenCalled());
    expect(createExamSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        academicYear: '2026/2027',
        name: 'Sessione test',
        dateFrom: '2027-01-10',
        dateTo: '2027-01-25',
      }),
    );
  });

  it('mostra errore se dateFrom > dateTo (validazione client)', async () => {
    listExamSessionsMock.mockResolvedValue({ examSessions: [] });
    const user = userEvent.setup();
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    await user.click(screen.getByRole('button', { name: /Aggiungi sessione/i }));
    await user.type(screen.getByLabelText(/Nome/i), 'X');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByLabelText(/^Dal$/i), { target: { value: '2027-05-10' } });
    fireEvent.change(screen.getByLabelText(/^Al$/i), { target: { value: '2027-05-01' } });
    expect(
      screen.getByText(/La data di fine deve essere uguale o successiva/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Crea$/i })).toBeDisabled();
  });

  it('click su pencil apre il dialog pre-compilato in mode edit', async () => {
    listExamSessionsMock.mockResolvedValue({
      examSessions: [mkSession({ id: 9, name: 'Estiva 2027', notes: 'Note vecchie' })],
    });
    const user = userEvent.setup();
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    await waitFor(() => expect(screen.queryByText('Estiva 2027')).toBeInTheDocument());
    // I bottoni icon non hanno nome accessibile testuale: prendiamoli per ruolo
    // dalla riga della tabella. Selettore: tutti i bottoni 'icon' nella riga.
    const row = screen.getByText('Estiva 2027').closest('tr');
    expect(row).not.toBeNull();
    if (!row) return;
    const buttons = row.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    // Primo bottone = pencil (edit), secondo = trash
    await user.click(buttons[0]);
    expect(screen.getByText(/Modifica sessione d'esame/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome/i)).toHaveValue('Estiva 2027');
    // Bottone "Salva" (edit mode)
    expect(screen.getByRole('button', { name: /^Salva$/i })).toBeInTheDocument();
  });

  it('submit in edit mode chiama updateExamSession', async () => {
    listExamSessionsMock.mockResolvedValue({
      examSessions: [mkSession({ id: 42, name: 'Estiva 2027' })],
    });
    updateExamSessionMock.mockResolvedValue({ examSession: mkSession({ id: 42 }) });
    const user = userEvent.setup();
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    await waitFor(() => expect(screen.queryByText('Estiva 2027')).toBeInTheDocument());
    const row = screen.getByText('Estiva 2027').closest('tr');
    if (!row) throw new Error('row not found');
    const buttons = row.querySelectorAll('button');
    await user.click(buttons[0]); // pencil
    await user.click(screen.getByRole('button', { name: /^Salva$/i }));
    await waitFor(() => expect(updateExamSessionMock).toHaveBeenCalled());
    expect(updateExamSessionMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        name: 'Estiva 2027',
        dateFrom: '2027-01-15',
        dateTo: '2027-02-15',
      }),
    );
  });

  it('click su trash con confirm=true chiama deleteExamSession', async () => {
    listExamSessionsMock.mockResolvedValue({
      examSessions: [mkSession({ id: 7, name: 'Da cancellare' })],
    });
    deleteExamSessionMock.mockResolvedValue({ message: 'ok' });
    // Stub confirm
    const origConfirm = window.confirm;
    window.confirm = vi.fn(() => true);
    const user = userEvent.setup();
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    await waitFor(() => expect(screen.queryByText('Da cancellare')).toBeInTheDocument());
    const row = screen.getByText('Da cancellare').closest('tr');
    if (!row) throw new Error('row not found');
    const buttons = row.querySelectorAll('button');
    // Secondo bottone = trash
    await user.click(buttons[1]);
    await waitFor(() => expect(deleteExamSessionMock).toHaveBeenCalledWith(7));
    window.confirm = origConfirm;
  });

  it('click su trash con confirm=false NON chiama deleteExamSession', async () => {
    listExamSessionsMock.mockResolvedValue({
      examSessions: [mkSession({ id: 7, name: 'Mantieni' })],
    });
    const origConfirm = window.confirm;
    window.confirm = vi.fn(() => false);
    const user = userEvent.setup();
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    await waitFor(() => expect(screen.queryByText('Mantieni')).toBeInTheDocument());
    const row = screen.getByText('Mantieni').closest('tr');
    if (!row) throw new Error('row not found');
    const buttons = row.querySelectorAll('button');
    await user.click(buttons[1]);
    // Non chiama API
    expect(deleteExamSessionMock).not.toHaveBeenCalled();
    window.confirm = origConfirm;
  });

  it('click su Annulla nel dialog chiude e non chiama mutation', async () => {
    listExamSessionsMock.mockResolvedValue({ examSessions: [] });
    const user = userEvent.setup();
    renderWithProviders(<ExamSessionsEditor academicYear="2026/2027" />);
    await user.click(screen.getByRole('button', { name: /Aggiungi sessione/i }));
    expect(screen.getByText(/Nuova sessione d'esame/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Annulla$/i }));
    // dialog chiuso
    await waitFor(() =>
      expect(screen.queryByText(/Nuova sessione d'esame/i)).not.toBeInTheDocument(),
    );
    expect(createExamSessionMock).not.toHaveBeenCalled();
  });
});
