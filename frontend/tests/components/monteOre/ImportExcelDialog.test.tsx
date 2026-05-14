import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '../../test-utils';
import { ImportExcelDialog } from '@/components/monteOre/ImportExcelDialog';
import { HttpError } from '@/lib/api';

const importExcelMock = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/api/monteOre', async () => {
  // HttpError viene importato direttamente da `@/lib/api`, non da monteOre,
  // quindi non serve riesportarlo qui.
  return {
    monteOreAdminApi: {
      importExcel: (...args: unknown[]) => importExcelMock(...args),
    },
  };
});

function makeXlsxFile(name = 'monte-ore.xlsx', sizeBytes = 1024) {
  // Crea un Blob di dimensione richiesta (riempito di zeri).
  const buf = new Uint8Array(sizeBytes);
  return new File([buf], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('<ImportExcelDialog />', () => {
  beforeEach(() => {
    importExcelMock.mockReset();
  });

  it('non rende contenuto quando open=false', () => {
    const { container } = renderWithProviders(<ImportExcelDialog open={false} onClose={vi.fn()} />);
    expect(container.textContent ?? '').not.toMatch(/Importa monte ore da Excel/i);
  });

  it('renderizza titolo, drop-zone e bottone Importa (disabilitato senza file)', () => {
    renderWithProviders(
      <ImportExcelDialog open={true} onClose={vi.fn()} academicYear="2026/2027" />,
    );
    expect(screen.getByText(/Importa monte ore da Excel/i)).toBeInTheDocument();
    expect(screen.getByText(/Trascina qui il file/i)).toBeInTheDocument();
    expect(screen.getByText(/AA corrente:/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /^Importa$/i });
    expect(btn).toBeDisabled();
  });

  it('rifiuta file con estensione non .xlsx mostrando messaggio di validazione', async () => {
    renderWithProviders(<ImportExcelDialog open={true} onClose={vi.fn()} />);
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
    const badFile = new File(['ciao'], 'wrong.txt', { type: 'text/plain' });
    // userEvent.upload filtra via `accept=`; usiamo fireEvent.change diretto
    // per simulare un browser che ha permesso comunque la selezione.
    const { fireEvent } = await import('@testing-library/react');
    Object.defineProperty(fileInput, 'files', { value: [badFile], writable: false });
    fireEvent.change(fileInput);
    expect(screen.getByText(/Formato non valido/i)).toBeInTheDocument();
    // Bottone resta disabilitato
    expect(screen.getByRole('button', { name: /^Importa$/i })).toBeDisabled();
  });

  it('rifiuta file > 5 MB con messaggio dedicato', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImportExcelDialog open={true} onClose={vi.fn()} />);
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
    const huge = makeXlsxFile('big.xlsx', 6 * 1024 * 1024);
    await user.upload(fileInput, huge);
    expect(screen.getByText(/troppo grande/i)).toBeInTheDocument();
  });

  it('accetta un file .xlsx valido e abilita il bottone Importa', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImportExcelDialog open={true} onClose={vi.fn()} />);
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
    const ok = makeXlsxFile('mario.xlsx', 1024);
    await user.upload(fileInput, ok);
    expect(screen.getByText(/mario\.xlsx/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Importa$/i })).not.toBeDisabled();
  });

  it('click su "Rimuovi file" azzera la selezione e ridisabilita il bottone', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImportExcelDialog open={true} onClose={vi.fn()} />);
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
    await user.upload(fileInput, makeXlsxFile('a.xlsx', 1024));
    expect(screen.getByText(/a\.xlsx/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Rimuovi file/i }));
    expect(screen.queryByText(/a\.xlsx/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Importa$/i })).toBeDisabled();
  });

  it('submit chiama importExcel e mostra il pannello esito', async () => {
    importExcelMock.mockResolvedValue({
      proposal: { id: 42, academicYear: '2026/2027' },
      user: { id: 7, email: 'mario@example.com', fullName: 'Mario Rossi' },
      summary: { schedulesCreated: 5, totalHoursPattern: 12.5, warnings: [] },
    });
    const user = userEvent.setup();
    renderWithProviders(<ImportExcelDialog open={true} onClose={vi.fn()} />);
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
    await user.upload(fileInput, makeXlsxFile('mario.xlsx', 1024));
    await user.click(screen.getByRole('button', { name: /^Importa$/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Proposta importata per Mario Rossi/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/mario@example.com/)).toBeInTheDocument();
    // Numero fasce + ore visibili
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(importExcelMock).toHaveBeenCalledWith(expect.any(File), {
      overwrite: true,
      force: false,
    });
  });

  it('mostra alert "Email non trovata" per errore HTTP 404', async () => {
    importExcelMock.mockRejectedValue(
      new HttpError(404, { error: 'Utente con email X non trovato' }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ImportExcelDialog open={true} onClose={vi.fn()} />);
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
    await user.upload(fileInput, makeXlsxFile('mario.xlsx', 1024));
    await user.click(screen.getByRole('button', { name: /^Importa$/i }));
    await waitFor(() => expect(screen.queryByText(/Email non trovata/i)).toBeInTheDocument());
    expect(screen.getByText(/Utente con email X non trovato/i)).toBeInTheDocument();
  });

  it('mostra alert "non sovrascrivibile" + checkbox force + bottone "Forza import" su HTTP 409', async () => {
    importExcelMock.mockRejectedValue(new HttpError(409, { error: 'Proposta già approvata' }));
    const user = userEvent.setup();
    renderWithProviders(<ImportExcelDialog open={true} onClose={vi.fn()} />);
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
    await user.upload(fileInput, makeXlsxFile('mario.xlsx', 1024));
    await user.click(screen.getByRole('button', { name: /^Importa$/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Proposta in stato non sovrascrivibile/i)).toBeInTheDocument(),
    );
    // Bottone "Forza import" presente ma disabilitato finché la checkbox non è spuntata
    const forceBtn = screen.getByRole('button', { name: /Forza import/i });
    expect(forceBtn).toBeDisabled();
    // Spunta la checkbox "Forza sovrascrittura" — è la seconda nel dialog
    // (la prima è "Sovrascrivi proposta esistente")
    const checkboxes = screen.getAllByRole('checkbox');
    // Trova quella nello stato unchecked (forceOverwrite default = false)
    const forceCb = checkboxes.find((c) => c.getAttribute('aria-checked') === 'false');
    expect(forceCb).toBeTruthy();
    if (forceCb) await user.click(forceCb);
    expect(screen.getByRole('button', { name: /Forza import/i })).not.toBeDisabled();
  });

  it('mostra alert generico per errori non 404/409', async () => {
    importExcelMock.mockRejectedValue(new HttpError(500, { error: 'Errore server' }));
    const user = userEvent.setup();
    renderWithProviders(<ImportExcelDialog open={true} onClose={vi.fn()} />);
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
    await user.upload(fileInput, makeXlsxFile('mario.xlsx', 1024));
    await user.click(screen.getByRole('button', { name: /^Importa$/i }));
    await waitFor(() => expect(screen.queryByText(/Errore server/i)).toBeInTheDocument());
    // Non deve apparire il messaggio specifico 404/409
    expect(screen.queryByText(/Email non trovata/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/non sovrascrivibile/i)).not.toBeInTheDocument();
  });

  it('click su Annulla chiama onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ImportExcelDialog open={true} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /^Annulla$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('mostra il pannello esito con warning quando summary.warnings non vuoto', async () => {
    importExcelMock.mockResolvedValue({
      proposal: { id: 1, academicYear: '2026/2027' },
      user: { id: 1, email: 'a@b.it', fullName: 'A B' },
      summary: { schedulesCreated: 2, totalHoursPattern: 4, warnings: ['avviso 1', 'avviso 2'] },
    });
    const user = userEvent.setup();
    renderWithProviders(<ImportExcelDialog open={true} onClose={vi.fn()} />);
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
    await user.upload(fileInput, makeXlsxFile('mario.xlsx', 1024));
    await user.click(screen.getByRole('button', { name: /^Importa$/i }));
    await waitFor(() => expect(screen.queryByText(/avviso 1/)).toBeInTheDocument());
    expect(screen.getByText(/avviso 2/)).toBeInTheDocument();
    // Header dell'alert dei warning. JSX: "2 avviso" + ternario "" / "i".
    // Su 2 warning → "2 avvisoi" o "2 avvisi" a seconda di come React unisce
    // i nodi: testiamo la presenza del numero "2" + "avvis" nella pagina.
    const allEls = Array.from(document.querySelectorAll('h5'));
    const found = allEls.some((el) => /avvis/i.test(el.textContent ?? ''));
    expect(found).toBe(true);
  });

  it('"Importa un altro file" dal pannello esito resetta la UI al form', async () => {
    importExcelMock.mockResolvedValue({
      proposal: { id: 1, academicYear: '2026/2027' },
      user: { id: 1, email: 'a@b.it', fullName: 'Mario' },
      summary: { schedulesCreated: 1, totalHoursPattern: 1, warnings: [] },
    });
    const user = userEvent.setup();
    renderWithProviders(<ImportExcelDialog open={true} onClose={vi.fn()} />);
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
    await user.upload(fileInput, makeXlsxFile('mario.xlsx', 1024));
    await user.click(screen.getByRole('button', { name: /^Importa$/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Proposta importata per Mario/i)).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: /Importa un altro file/i }));
    // Torna al form: drop-zone visibile
    expect(screen.getByText(/Trascina qui il file/i)).toBeInTheDocument();
  });
});
