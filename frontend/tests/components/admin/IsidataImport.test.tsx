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

vi.mock('@/api/integrations', async () => {
  // Manteniamo i type ma sovrascriviamo le funzioni con i mock.
  const actual = await vi.importActual<typeof import('@/api/integrations')>('@/api/integrations');
  return {
    ...actual,
    integrationsApi: {
      preview: (...args: unknown[]) => previewMock(...args),
      apply: (...args: unknown[]) => applyMock(...args),
      runs: (...args: unknown[]) => runsMock(...args),
    },
  };
});

import { IsidataImportContent } from '@/pages/admin/integrations/IsidataImport';

const basePreview = {
  token: '1-1234-abc.xlsx',
  hash: 'f'.repeat(64),
  headers: ['Matricola', 'Cognome', 'Nome'],
  headerMap: { externalId: 'Matricola' },
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
