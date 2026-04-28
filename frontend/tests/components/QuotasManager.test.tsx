import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '../test-utils';

// Mock di quotasApi PRIMA dell'import del componente, così il componente
// chiama il mock invece dell'API reale.
vi.mock('@/api/quotas', () => ({
  quotasApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

// Mock di sonner: i toast sparano altrimenti errori in jsdom.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { quotasApi } from '@/api/quotas';
import { QuotasManager } from '@/components/admin/QuotasManager';

const mocked = quotasApi as unknown as {
  list: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

describe('<QuotasManager />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mostra l'empty state quando non ci sono quote", async () => {
    mocked.list.mockResolvedValueOnce({ quotas: [] });
    renderWithProviders(<QuotasManager />);

    // Empty state — la chiave i18n "admin.quotas.empty_title" non è
    // tradotta nei test (usiamo il fallback i18n minimal): viene resa
    // come la chiave stessa.
    await waitFor(() => expect(screen.getByText('admin.quotas.empty_title')).toBeInTheDocument());
  });

  it('elenca le quote in tabella', async () => {
    mocked.list.mockResolvedValueOnce({
      quotas: [
        {
          id: 1,
          role: 'studente',
          scopeKind: 'roomType',
          scopeValue: 'studio',
          maxHoursPerWeek: 10,
          maxHoursPerDay: 4,
          isActive: true,
        },
        {
          id: 2,
          role: 'docente',
          scopeKind: 'global',
          scopeValue: '*',
          maxHoursPerWeek: 0,
          maxHoursPerDay: 6,
          isActive: false,
        },
      ],
    });
    renderWithProviders(<QuotasManager />);

    // Aspetta che le righe vengano renderizzate
    await waitFor(() => {
      expect(screen.getByText('10 h')).toBeInTheDocument();
      expect(screen.getByText('6 h')).toBeInTheDocument();
    });
    // Riga inattiva → mostra "—" per le 0
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('apre il dialog di conferma alla pressione del cestino', async () => {
    const user = userEvent.setup();
    mocked.list.mockResolvedValueOnce({
      quotas: [
        {
          id: 42,
          role: 'studente',
          scopeKind: 'global',
          scopeValue: '*',
          maxHoursPerWeek: 5,
          maxHoursPerDay: 0,
          isActive: true,
        },
      ],
    });
    mocked.remove.mockResolvedValueOnce({ message: 'ok' });

    renderWithProviders(<QuotasManager />);
    await waitFor(() => screen.getByText('5 h'));

    // Trova il button "delete" (title=common.delete) e cliccalo
    const deleteBtn = screen.getByTitle('common.delete');
    await user.click(deleteBtn);

    // Il ConfirmDeleteDialog mostra il bottone "Elimina" (testo italiano hardcoded)
    expect(await screen.findByRole('button', { name: 'Elimina' })).toBeInTheDocument();
  });
});
