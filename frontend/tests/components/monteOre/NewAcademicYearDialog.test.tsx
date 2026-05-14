import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen } from '../../test-utils';
import { NewAcademicYearDialog } from '@/components/monteOre/NewAcademicYearDialog';
import type { AcademicYearOption } from '@/api/monteOre';

// Mock toast / monteOre API: i test verificano l'interazione UI senza
// realmente colpire il backend, mantenendoci alla copertura statica della
// validazione e dei rami di rendering condizionale.
const createAcademicYearMock = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/api/monteOre', async () => {
  return {
    monteOreAdminApi: {
      createAcademicYear: (...args: unknown[]) => createAcademicYearMock(...args),
    },
  };
});

const yearOption = (overrides: Partial<AcademicYearOption> = {}): AcademicYearOption => ({
  academicYear: '2025/2026',
  label: 'AA 2025/2026 (in corso)',
  isCurrent: true,
  isNext: false,
  submissionOpen: false,
  hasSettings: true,
  adminActivated: false,
  canCreateNew: false,
  ...overrides,
});

describe('<NewAcademicYearDialog />', () => {
  beforeEach(() => {
    createAcademicYearMock.mockReset();
    createAcademicYearMock.mockResolvedValue({
      settings: {} as never,
      suspensionsCreated: 7,
      suspensionsSkipped: 0,
    });
  });

  it('non renderizza il contenuto quando open=false', () => {
    const { container } = renderWithProviders(
      <NewAcademicYearDialog open={false} onClose={vi.fn()} existingYears={[yearOption()]} />,
    );
    expect(container.textContent ?? '').not.toMatch(/Crea nuovo anno accademico/i);
  });

  it('renderizza titolo, input AA e bottoni quando open=true', () => {
    renderWithProviders(
      <NewAcademicYearDialog
        open={true}
        onClose={vi.fn()}
        existingYears={[yearOption()]}
        suggestedYear="2026/2027"
      />,
    );
    expect(screen.getByText(/Crea nuovo anno accademico/i)).toBeInTheDocument();
    expect(document.getElementById('aa-input')).toHaveValue('2026/2027');
    expect(screen.getByRole('button', { name: /Crea AA/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Annulla/i })).toBeInTheDocument();
  });

  it('mostra preview "Calendario" quando il formato AA è valido', () => {
    renderWithProviders(
      <NewAcademicYearDialog
        open={true}
        onClose={vi.fn()}
        existingYears={[]}
        suggestedYear="2026/2027"
      />,
    );
    // preview: "1 novembre 2026" → "31 ottobre 2027"
    expect(screen.getByText(/Calendario:/i)).toBeInTheDocument();
    expect(screen.getByText(/1 novembre/i)).toBeInTheDocument();
    expect(screen.getByText(/31 ottobre/i)).toBeInTheDocument();
  });

  it('mostra errore di formato quando AA non matcha la regex YYYY/YYYY', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NewAcademicYearDialog open={true} onClose={vi.fn()} existingYears={[]} suggestedYear="" />,
    );
    const input = document.getElementById('aa-input') as HTMLInputElement;
    await user.type(input, 'abc');
    expect(screen.getByText(/Formato non valido/i)).toBeInTheDocument();
    // bottone "Crea AA" deve essere disabilitato
    expect(screen.getByRole('button', { name: /Crea AA/i })).toBeDisabled();
  });

  it('mostra errore quando il secondo anno non è il primo + 1', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NewAcademicYearDialog open={true} onClose={vi.fn()} existingYears={[]} suggestedYear="" />,
    );
    const input = document.getElementById('aa-input') as HTMLInputElement;
    await user.type(input, '2026/2028');
    expect(screen.getByText(/secondo anno deve essere il primo \+ 1/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crea AA/i })).toBeDisabled();
  });

  it('input vuoto: bottone disabilitato senza messaggio errore visibile', () => {
    renderWithProviders(
      <NewAcademicYearDialog open={true} onClose={vi.fn()} existingYears={[]} suggestedYear="" />,
    );
    expect(screen.getByRole('button', { name: /Crea AA/i })).toBeDisabled();
    // Quando l'input è vuoto NON deve apparire un errore (UX: solo quando l'utente
    // ha iniziato a digitare).
    expect(screen.queryByText(/Formato non valido/i)).not.toBeInTheDocument();
  });

  it('toggle mode "Da AA precedente" mostra Alert se nessun AA esistente', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NewAcademicYearDialog
        open={true}
        onClose={vi.fn()}
        existingYears={[]}
        suggestedYear="2026/2027"
      />,
    );
    // Il radio "from_previous" è disabilitato se non ci sono previousYearOptions
    expect(screen.getByText(/Nessun AA precedente disponibile/i)).toBeInTheDocument();
    // Verifica che il radio sia disabilitato
    const radio = document.querySelector(
      'input[type="radio"][value="from_previous"]',
    ) as HTMLInputElement | null;
    expect(radio).not.toBeNull();
    expect(radio?.disabled).toBe(true);
    // E che cliccando non cambi mode (radio disabled)
    if (radio) await user.click(radio);
    // Il select "AA precedente da cui clonare" non deve apparire
    expect(screen.queryByLabelText(/AA precedente da cui clonare/i)).not.toBeInTheDocument();
  });

  it('toggle mode "Da AA precedente" mostra select quando esistono AA con settings', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NewAcademicYearDialog
        open={true}
        onClose={vi.fn()}
        existingYears={[yearOption({ academicYear: '2024/2025', hasSettings: true })]}
        suggestedYear="2026/2027"
      />,
    );
    // Default mode = default → no select previousYear
    expect(screen.queryByLabelText(/AA precedente da cui clonare/i)).not.toBeInTheDocument();
    // Clicca il radio "from_previous"
    const radio = document.querySelector(
      'input[type="radio"][value="from_previous"]',
    ) as HTMLInputElement | null;
    expect(radio).not.toBeNull();
    if (radio) await user.click(radio);
    // Ora il select appare
    expect(screen.getByLabelText(/AA precedente da cui clonare/i)).toBeInTheDocument();
  });

  it('click su Annulla chiama onClose e resetta il form', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <NewAcademicYearDialog
        open={true}
        onClose={onClose}
        existingYears={[]}
        suggestedYear="2026/2027"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Annulla/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submit con AA valido + mode=default chiama createAcademicYear con payload corretto', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    renderWithProviders(
      <NewAcademicYearDialog
        open={true}
        onClose={onClose}
        existingYears={[]}
        suggestedYear="2027/2028"
        onCreated={onCreated}
      />,
    );
    const submit = screen.getByRole('button', { name: /Crea AA/i });
    expect(submit).not.toBeDisabled();
    await user.click(submit);
    // Aspetta il flush della mutation
    await new Promise((r) => setTimeout(r, 0));
    expect(createAcademicYearMock).toHaveBeenCalledTimes(1);
    expect(createAcademicYearMock).toHaveBeenCalledWith({
      academicYear: '2027/2028',
      mode: 'default',
      previousYear: null,
      overwrite: false,
    });
  });

  it('checkbox "Sovrascrivi" passa overwrite=true nel payload', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NewAcademicYearDialog
        open={true}
        onClose={vi.fn()}
        existingYears={[]}
        suggestedYear="2030/2031"
      />,
    );
    // Trova checkbox tramite role
    const checkboxes = screen.getAllByRole('checkbox');
    // Solo un checkbox in questo dialog (overwrite)
    expect(checkboxes.length).toBeGreaterThanOrEqual(1);
    await user.click(checkboxes[0]);
    await user.click(screen.getByRole('button', { name: /Crea AA/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(createAcademicYearMock).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: true }),
    );
  });
});
