import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/api/auth';
import { tokenStore } from '@/lib/api';
import type { User } from '@/types';
vi.mock('@/api/auth', () => ({ authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn() } }));
vi.mock('@/lib/sentry', () => ({ setSentryUser: vi.fn() }));
const user = { id: 2, role: 'admin', status: 'approved' } as User;
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
  return { client, ...renderHook(() => useAuth(), { wrapper }) };
}
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(authApi.logout).mockResolvedValue({ message: 'ok' } as never);
});
afterEach(() => localStorage.clear());
describe('session isolation', () => {
  it('clears private query data on account change and logout', async () => {
    const { result, client } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    client.setQueryData(['private'], { owner: 1 });
    vi.mocked(authApi.login).mockResolvedValue({ token: 'second', user });
    await act(async () => {
      await result.current.loginWithCredentials('b@test.it', 'password');
    });
    expect(client.getQueryData(['private'])).toBeUndefined();
    expect(result.current.user?.id).toBe(2);
    client.setQueryData(['private'], { owner: 2 });
    act(() => result.current.logout());
    expect(client.getQueryData(['private'])).toBeUndefined();
    expect(result.current.user).toBeNull();
  });
  it('retains credentials on transient /me errors and exits loading', async () => {
    tokenStore.set('valid');
    vi.mocked(authApi.me).mockRejectedValue(new Error('temporarily offline'));
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(tokenStore.get()).toBe('valid');
    expect(result.current.user).toBeNull();
    await act(async () => {
      await expect(result.current.setSessionToken('oauth')).rejects.toThrow('offline');
    });
    expect(result.current.loading).toBe(false);
    expect(tokenStore.get()).toBe('oauth');
  });
  it('ignores a /me response arriving after logout', async () => {
    tokenStore.set('old');
    let complete!: (value: { user: User }) => void;
    vi.mocked(authApi.me).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { result } = mount();
    act(() => result.current.logout());
    await act(async () => {
      complete({ user });
    });
    expect(result.current.user).toBeNull();
    expect(tokenStore.get()).toBeNull();
  });
});
