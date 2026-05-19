import { test, expect, request } from '@playwright/test';

/**
 * Scenario: RBAC — uno studente NON deve poter chiamare endpoint admin.
 *
 * Copre il middleware `requireRole('admin')` su rotte che gestiscono dati
 * sensibili (gestione utenti, audit log, mail outbox, integrazioni). Una
 * regressione qui (es. un middleware dimenticato su una nuova rotta admin)
 * sarebbe un escalation di privilegio classico: meglio coprirlo end-to-end
 * con un token JWT vero invece che con un test unitario sul middleware.
 */
test.describe('RBAC: studente non accede ad endpoint admin', () => {
  test('studente riceve 403 sulle rotte admin core', async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });

    // Login API per ottenere il JWT senza passare per la UI (qui non ci
    // interessa il flusso di login, ci interessa l'authorization).
    const loginRes = await api.post('/api/auth/login', {
      data: { email: 'studente@test.local', password: 'Password1!' },
    });
    expect(loginRes.ok(), `login fallito: ${loginRes.status()}`).toBeTruthy();
    const { token } = (await loginRes.json()) as { token: string };
    expect(token).toBeTruthy();

    const authHeaders = { Authorization: `Bearer ${token}` };

    // Rotte rappresentative coperte da requireRole('admin'). Se una di
    // queste passa, vuol dire che il middleware è stato dimenticato.
    const adminEndpoints = [
      { method: 'GET' as const, url: '/api/users' },
      { method: 'GET' as const, url: '/api/admin/audit-log' },
      { method: 'GET' as const, url: '/api/admin/mail-outbox' },
      { method: 'GET' as const, url: '/api/admin/analytics' },
      { method: 'GET' as const, url: '/api/loans' },
    ];

    for (const endpoint of adminEndpoints) {
      const res = await api.fetch(endpoint.url, {
        method: endpoint.method,
        headers: authHeaders,
      });
      expect(
        res.status(),
        `studente non dovrebbe poter chiamare ${endpoint.method} ${endpoint.url} (status=${res.status()})`,
      ).toBe(403);
    }

    // Sanity: lo stesso studente PUÒ chiamare il suo /me.
    const me = await api.get('/api/auth/me', { headers: authHeaders });
    expect(me.ok(), `/api/auth/me dovrebbe rispondere 200 per studente: ${me.status()}`).toBeTruthy();

    await api.dispose();
  });
});
