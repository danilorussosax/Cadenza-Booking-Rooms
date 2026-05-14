import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from '../../test-utils';
import { AdminAcademicYearSelector } from '@/components/monteOre/AcademicYearSelector';
import type { AcademicYearListResponse, AcademicYearOption } from '@/api/monteOre';

const listAcademicYearsMock = vi.fn();
const activateMock = vi.fn();
const createAcademicYearMock = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/api/monteOre', async () => {
  return {
    monteOreApi: {
      listAcademicYears: (...args: unknown[]) => listAcademicYearsMock(...args),
    },
    monteOreAdminApi: {
      activateAcademicYearForTeachers: (...args: unknown[]) => activateMock(...args),
      createAcademicYear: (...args: unknown[]) => createAcademicYearMock(...args),
    },
  };
});

const opt = (overrides: Partial<AcademicYearOption> = {}): AcademicYearOption => ({
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

const baseResponse = (): AcademicYearListResponse => ({
  items: [
    opt(),
    opt({
      academicYear: '2026/2027',
      label: 'AA 2026/2027 (prossimo)',
      isCurrent: false,
      isNext: true,
      submissionOpen: true,
    }),
  ],
  default: '2025/2026',
});

describe('<AdminAcademicYearSelector />', () => {
  beforeEach(() => {
    listAcademicYearsMock.mockReset();
    activateMock.mockReset();
    createAcademicYearMock.mockReset();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('mostra placeholder "Caricamento…" finché la query è in volo', () => {
    listAcademicYearsMock.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<AdminAcademicYearSelector value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText(/Anno accademico/i)).toBeInTheDocument();
    // Placeholder visibile (SelectValue mostra il placeholder finché value=='')
    expect(screen.getByText(/Caricamento…/i)).toBeInTheDocument();
  });

  it('al primo render risolve value via default e chiama onChange', async () => {
    listAcademicYearsMock.mockResolvedValue(baseResponse());
    const onChange = vi.fn();
    renderWithProviders(<AdminAcademicYearSelector value={undefined} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith('2025/2026');
  });

  it('preferisce il valore salvato in localStorage rispetto al default', async () => {
    listAcademicYearsMock.mockResolvedValue(baseResponse());
    try {
      localStorage.setItem('monteOre.admin.selectedYear', '2026/2027');
    } catch {
      /* ignore */
    }
    const onChange = vi.fn();
    renderWithProviders(<AdminAcademicYearSelector value={undefined} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith('2026/2027');
  });

  it('fallback alla prima opzione se default non è tra i candidati', async () => {
    listAcademicYearsMock.mockResolvedValue({
      items: [opt({ academicYear: '2030/2031', label: 'AA 2030/2031' })],
      default: '9999/0000',
    });
    const onChange = vi.fn();
    renderWithProviders(<AdminAcademicYearSelector value={undefined} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith('2030/2031');
  });

  it('non re-invoca onChange quando value è già definito', async () => {
    listAcademicYearsMock.mockResolvedValue(baseResponse());
    const onChange = vi.fn();
    renderWithProviders(<AdminAcademicYearSelector value="2025/2026" onChange={onChange} />);
    // Attendiamo che la query si risolva
    await waitFor(() => expect(listAcademicYearsMock).toHaveBeenCalled());
    // Non dovrebbe fare ulteriori onChange
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renderizza i badge contestuali per l'AA selezionato (in corso)", async () => {
    listAcademicYearsMock.mockResolvedValue(baseResponse());
    renderWithProviders(<AdminAcademicYearSelector value="2025/2026" onChange={vi.fn()} />);
    // Aspetta che il bottone "Attiva per docenti" appaia (segnale che selected è risolto)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Attiva per docenti/i })).toBeInTheDocument(),
    );
    // Badge "in corso": testo deve essere uno span Badge (dom < 50 chars).
    // Usiamo getAllByText e verifichiamo almeno uno renderizzato come <span> (badge).
    const matches = screen.getAllByText(/in corso/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renderizza badge "prossimo" + "submission aperta" per AA isNext', async () => {
    listAcademicYearsMock.mockResolvedValue(baseResponse());
    renderWithProviders(<AdminAcademicYearSelector value="2026/2027" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText(/submission aperta/i)).toBeInTheDocument());
    expect(screen.getAllByText(/prossimo/i).length).toBeGreaterThan(0);
  });

  it('mostra badge "attivato per docenti" + bottone "Disattiva" se adminActivated=true', async () => {
    listAcademicYearsMock.mockResolvedValue({
      items: [opt({ adminActivated: true })],
      default: '2025/2026',
    });
    renderWithProviders(<AdminAcademicYearSelector value="2025/2026" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText(/attivato per docenti/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Disattiva per docenti/i })).toBeInTheDocument();
  });

  it('mostra bottone "Attiva per docenti" se adminActivated=false e hasSettings=true', async () => {
    listAcademicYearsMock.mockResolvedValue(baseResponse());
    renderWithProviders(<AdminAcademicYearSelector value="2025/2026" onChange={vi.fn()} />);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Attiva per docenti/i })).toBeInTheDocument(),
    );
  });

  it('click su "Attiva per docenti" chiama activate API con (year, true)', async () => {
    activateMock.mockResolvedValue({ activated: null, deactivated: 0 });
    listAcademicYearsMock.mockResolvedValue(baseResponse());
    renderWithProviders(<AdminAcademicYearSelector value="2025/2026" onChange={vi.fn()} />);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Attiva per docenti/i })).toBeInTheDocument(),
    );
    screen.getByRole('button', { name: /Attiva per docenti/i }).click();
    await waitFor(() => expect(activateMock).toHaveBeenCalled());
    expect(activateMock).toHaveBeenCalledWith('2025/2026', true);
  });

  it('badge "non ancora creato" se selected.hasSettings=false', async () => {
    listAcademicYearsMock.mockResolvedValue({
      items: [
        opt({
          academicYear: '2027/2028',
          label: 'AA 2027/2028',
          isCurrent: false,
          isNext: false,
          hasSettings: false,
          canCreateNew: true,
        }),
      ],
      default: '2027/2028',
    });
    renderWithProviders(<AdminAcademicYearSelector value="2027/2028" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText(/non ancora creato/i)).toBeInTheDocument());
    // E NON mostra bottone toggle (richiede hasSettings)
    expect(screen.queryByRole('button', { name: /Attiva per docenti/i })).not.toBeInTheDocument();
  });

  it('non crasha se localStorage non è disponibile (readStoredYear catch)', async () => {
    // Simula throw su getItem
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('disabled');
    });
    listAcademicYearsMock.mockResolvedValue(baseResponse());
    const onChange = vi.fn();
    renderWithProviders(<AdminAcademicYearSelector value={undefined} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // Senza valore stored → usa default
    expect(onChange).toHaveBeenCalledWith('2025/2026');
    Storage.prototype.getItem = orig;
  });
});
