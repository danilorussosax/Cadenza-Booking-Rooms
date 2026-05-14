import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils';

// Mock toast: silenzioso.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const previewMock = vi.fn();
const applyMock = vi.fn();
const runsMock = vi.fn();
const compareMock = vi.fn();

vi.mock('@/api/integrations', async () => {
  // Manteniamo i type ma sovrascriviamo le funzioni con i mock.
  const actual = await vi.importActual<typeof import('@/api/integrations')>('@/api/integrations');
  return {
    ...actual,
    integrationsApi: {
      preview: (...args: unknown[]) => previewMock(...args),
      apply: (...args: unknown[]) => applyMock(...args),
      runs: (...args: unknown[]) => runsMock(...args),
      comparePrevious: (...args: unknown[]) => compareMock(...args),
    },
  };
});

import { IsidataImportContent } from '@/pages/admin/integrations/IsidataImport';

const basePreview = {
  token: '1-1234-abc.xlsx',
  hash: 'f'.repeat(64),
  headers: ['Matricola', 'Cognome', 'Nome'],
  headerMap: { externalId: 'Matricola' },
  detectedHeaders: ['Matricola', 'Cognome', 'Nome', 'Email'],
  effectiveMapping: {
    matricola: 'Matricola',
    externalId: 'Matricola',
    email: 'Email',
    firstName: 'Nome',
    lastName: 'Cognome',
    role: null,
    courseCode: null,
    courseName: null,
    status: null,
    contractType: null,
  },
  autoDetected: {
    matricola: 'Matricola',
    externalId: 'Matricola',
    email: 'Email',
    firstName: 'Nome',
    lastName: 'Cognome',
    role: null,
    courseCode: null,
    courseName: null,
    status: null,
    contractType: null,
  },
  summary: {
    fetched: 5,
    warnings: [],
    toCreate: 5,
    toUpdate: 0,
    toOrphan: 0,
  },
  softWarnings: [],
  safetyChecks: {
    totalActiveUsers: 100,
    deactivateCount: 0,
    createCount: 5,
    deactivateRatio: 0,
    warnings: [],
  },
  diff: { toCreate: [], toUpdate: [], toOrphan: [] },
};

function makeFile() {
  return new File([new Uint8Array([1, 2, 3])], 'isidata.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function goToPreview() {
  // Simula upload file: trova l'input nascosto e firma un cambio.
  const input = document.getElementById('isidata-file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [makeFile()] });
  fireEvent.change(input);
  // Click su Anteprima
  const previewBtn = await screen.findByRole('button', { name: /preview_action|Anteprima/i });
  fireEvent.click(previewBtn);
}

describe('<IsidataImportContent /> — safety warnings', () => {
  beforeEach(() => {
    previewMock.mockReset();
    applyMock.mockReset();
    runsMock.mockReset();
    compareMock.mockReset();
    runsMock.mockResolvedValue({ runs: [] });
  });

  it('renderizza il banner critico + seconda checkbox quando ci sono warning critical', async () => {
    previewMock.mockResolvedValue({
      ...basePreview,
      summary: { ...basePreview.summary, toOrphan: 30, toCreate: 0 },
      safetyChecks: {
        totalActiveUsers: 100,
        deactivateCount: 30,
        createCount: 0,
        deactivateRatio: 0.3,
        warnings: [
          {
            level: 'critical',
            code: 'MASS_DEACTIVATION',
            message: 'Saranno disattivati 30 utenti (30% del totale).',
          },
        ],
      },
    });

    renderWithProviders(<IsidataImportContent />);
    await goToPreview();

    // Banner critico visibile.
    const critical = await screen.findByTestId('safety-critical');
    expect(critical).toBeInTheDocument();
    expect(critical.textContent).toMatch(/MASS_DEACTIVATION/);

    // Seconda checkbox presente.
    const ack = screen.getByTestId('critical-ack-checkbox') as HTMLInputElement;
    expect(ack).toBeInTheDocument();
    expect(ack.checked).toBe(false);

    // Bottone Applica disabilitato finché entrambe non sono spuntate.
    const apply = screen.getByTestId('apply-button') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('non mostra la seconda checkbox quando non ci sono warning critici', async () => {
    previewMock.mockResolvedValue(basePreview);
    renderWithProviders(<IsidataImportContent />);
    await goToPreview();

    // Attendi che la preview sia caricata: l'apply-button esiste.
    await screen.findByTestId('apply-button');
    expect(screen.queryByTestId('critical-ack-checkbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('safety-critical')).not.toBeInTheDocument();
  });

  it('mostra la sezione soft warnings con counter quando popolata', async () => {
    previewMock.mockResolvedValue({
      ...basePreview,
      softWarnings: [
        {
          code: 'UNKNOWN_COURSE_CODE',
          courseCode: 'IGN-001',
          count: 12,
          msg: '12 utenti con courseCode "IGN-001" non riconosciuto: courseId non impostato.',
        },
      ],
    });

    renderWithProviders(<IsidataImportContent />);
    await goToPreview();

    await waitFor(() => {
      expect(screen.getByTestId('soft-warnings')).toBeInTheDocument();
    });
  });
});

describe('<IsidataImportContent /> — mapping UI guidata', () => {
  beforeEach(() => {
    previewMock.mockReset();
    applyMock.mockReset();
    runsMock.mockReset();
    compareMock.mockReset();
    runsMock.mockResolvedValue({ runs: [] });
  });

  it('renderizza la tabella di mapping con una riga per ogni target field', async () => {
    previewMock.mockResolvedValue(basePreview);
    renderWithProviders(<IsidataImportContent />);
    await goToPreview();

    // Aspetta la card di mapping
    await screen.findByTestId('mapping-card');
    // 10 target fields previsti
    const targets = [
      'matricola',
      'externalId',
      'email',
      'firstName',
      'lastName',
      'role',
      'courseCode',
      'courseName',
      'status',
      'contractType',
    ];
    for (const t of targets) {
      expect(screen.getByTestId(`mapping-row-${t}`)).toBeInTheDocument();
      expect(screen.getByTestId(`mapping-select-${t}`)).toBeInTheDocument();
    }
  });

  it('cambiare un select segna lo stato come manual + abilita il bottone reload', async () => {
    previewMock.mockResolvedValue(basePreview);
    renderWithProviders(<IsidataImportContent />);
    await goToPreview();

    await screen.findByTestId('mapping-card');

    // Inizialmente, il bottone "Ricarica" è disabilitato (no delta).
    const reloadBtn = screen.getByTestId('mapping-reload') as HTMLButtonElement;
    expect(reloadBtn.disabled).toBe(true);

    // Cambia un select: role da non-mappato a "Nome" (anche se non realistico,
    // testa la transizione di stato).
    const roleSelect = screen.getByTestId('mapping-select-role') as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'Nome' } });
    expect(roleSelect.value).toBe('Nome');

    // Ora il reload è abilitato (mapping dirty).
    expect(reloadBtn.disabled).toBe(false);
  });

  it('"Ripristina automatico" riporta i Select ai valori auto-detected', async () => {
    previewMock.mockResolvedValue(basePreview);
    renderWithProviders(<IsidataImportContent />);
    await goToPreview();

    await screen.findByTestId('mapping-card');

    const roleSelect = screen.getByTestId('mapping-select-role') as HTMLSelectElement;
    // role inizialmente è null nell'autoDetected → option value=""
    expect(roleSelect.value).toBe('');
    // Cambia a "Nome"
    fireEvent.change(roleSelect, { target: { value: 'Nome' } });
    expect(roleSelect.value).toBe('Nome');

    // Click "Ripristina auto"
    const resetBtn = screen.getByTestId('mapping-reset-auto');
    fireEvent.click(resetBtn);

    // role torna a "" (non mappato, valore auto-detected)
    expect((screen.getByTestId('mapping-select-role') as HTMLSelectElement).value).toBe('');
  });
});

describe('<IsidataImportContent /> — confronto con run precedente', () => {
  beforeEach(() => {
    previewMock.mockReset();
    applyMock.mockReset();
    runsMock.mockReset();
    compareMock.mockReset();
  });

  it('click su "Confronta con precedente" apre il dialog', async () => {
    runsMock.mockResolvedValue({
      runs: [
        {
          id: 42,
          configId: null,
          instituteId: null,
          provider: 'isidata',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          triggeredBy: 'manual',
          status: 'success',
          fetched: 10,
          created: 3,
          updated: 5,
          skipped: 0,
          orphaned: 2,
          errors: 0,
          errorPayload: null,
          diffSnapshot: null,
          createdAt: new Date().toISOString(),
          actor: null,
        },
      ],
    });
    compareMock.mockResolvedValue({
      previous: null,
      current: {
        id: 42,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        status: 'success',
        createdCount: 3,
        updatedCount: 5,
        deactivatedCount: 2,
      },
      hasPrevious: false,
      changes: null,
    });

    renderWithProviders(<IsidataImportContent />);
    // Aspetta il bottone "compare" del primo run
    const btn = await screen.findByTestId('compare-run-42');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByTestId('compare-dialog')).toBeInTheDocument();
    });
    // hasPrevious=false → mostra messaggio "compare_empty"
    await waitFor(() => {
      expect(compareMock).toHaveBeenCalledWith(42);
    });
  });
});
