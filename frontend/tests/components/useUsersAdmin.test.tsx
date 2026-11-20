import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllProviders } from '../test-utils';
import { useUsersAdmin } from '@/pages/admin/users/useUsersAdmin';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock('@/contexts/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));
vi.mock('@/api/users', () => ({ usersApi: { list: mocks.list } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mk = (id: number, firstName: string, status: 'pending' | 'approved') => ({
  id,
  firstName,
  lastName: 'Test',
  email: `${firstName.toLowerCase()}@x.it`,
  role: 'studente',
  status,
  isActive: true,
});

describe('useUsersAdmin', () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.list.mockResolvedValue({
      users: [mk(1, 'Admin', 'approved'), mk(2, 'Anna', 'pending'), mk(3, 'Luca', 'approved')],
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AllProviders initialRoute="/admin/users">{children}</AllProviders>
  );

  it('applica la ricerca testuale e il tab di default', async () => {
    const { result } = renderHook(() => useUsersAdmin(), { wrapper });
    await waitFor(() => {
      expect(result.current.filtered).toHaveLength(3);
    });
    expect(result.current.tab).toBe('users');
    act(() => {
      result.current.setSearch('anna');
    });
    expect(result.current.filtered.map((u) => u.id)).toEqual([2]);
  });

  it('toggleAll esclude l utente corrente; pendingSelected tiene solo i pending', async () => {
    const { result } = renderHook(() => useUsersAdmin(), { wrapper });
    await waitFor(() => {
      expect(result.current.filtered).toHaveLength(3);
    });
    act(() => {
      result.current.toggleAll(true);
    });
    expect([...result.current.selected].sort()).toEqual([2, 3]);
    expect(result.current.pendingSelected.map((u) => u.id)).toEqual([2]);
    act(() => {
      result.current.toggleOne(3, false);
    });
    expect([...result.current.selected]).toEqual([2]);
  });

  it('resetta la selezione al cambio filtro', async () => {
    const { result } = renderHook(() => useUsersAdmin(), { wrapper });
    await waitFor(() => {
      expect(result.current.filtered).toHaveLength(3);
    });
    act(() => {
      result.current.toggleOne(2, true);
    });
    expect(result.current.selected.size).toBe(1);
    act(() => {
      result.current.setRoleFilter('docente');
    });
    await waitFor(() => {
      expect(result.current.selected.size).toBe(0);
    });
  });
});
