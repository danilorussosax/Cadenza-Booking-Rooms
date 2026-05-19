import { test, expect, request } from '@playwright/test';

/**
 * Scenario: GET /api/loans (admin) — pagination headers + cap massimo.
 *
 * Valida end-to-end il refactor v1.11 di /api/loans che ora usa
 * `findAndCountAll` + lib/pagination invece di un findAll non bounded.
 * Senza paginazione un istituto con migliaia di prestiti storici drenava
 * memoria sulla list-route admin.
 *
 * Strategia API-only: la list-route admin non ha UI dedicata che esponga
 * limit/offset (la dashboard prestiti filtra per status); il contratto da
 * congelare qui è quello degli header X-Total-Count / X-Limit / X-Offset.
 */
test.describe('Admin: /api/loans pagination contract', () => {
  test('limit/offset funzionano + cap massimo a 500', async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });

    // Admin login.
    const adminLogin = await api.post('/api/auth/login', {
      data: { email: 'admin@test.local', password: 'Password1!' },
    });
    expect(adminLogin.ok()).toBeTruthy();
    const { token: adminToken } = (await adminLogin.json()) as { token: string };
    const adminAuth = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

    // Studente login (per popolare i loan come utente reale, evitando di
    // bypassare le regole admin-only).
    const studLogin = await api.post('/api/auth/login', {
      data: { email: 'studente@test.local', password: 'Password1!' },
    });
    expect(studLogin.ok()).toBeTruthy();
    const { token: studToken } = (await studLogin.json()) as { token: string };
    const studAuth = { Authorization: `Bearer ${studToken}`, 'Content-Type': 'application/json' };

    // Recupera lo strumento dal seed.
    const instRes = await api.get('/api/instruments', { headers: studAuth });
    expect(instRes.ok()).toBeTruthy();
    const instBody = (await instRes.json()) as { instruments?: { id: number }[] };
    const instrument = (instBody.instruments ?? [])[0];
    expect(instrument, 'nessuno strumento nel seed').toBeTruthy();

    // Crea 5 richieste di prestito a intervalli disgiunti (evita LOAN_CONFLICT
    // sullo stesso item nello stesso periodo).
    const created: number[] = [];
    for (let i = 0; i < 5; i++) {
      const from = new Date();
      from.setUTCDate(from.getUTCDate() + 1 + i * 10);
      const to = new Date(from);
      to.setUTCDate(to.getUTCDate() + 2);
      const res = await api.post('/api/loans', {
        headers: studAuth,
        data: {
          instrumentId: instrument!.id,
          fromDate: from.toISOString().slice(0, 10),
          toDate: to.toISOString().slice(0, 10),
          notes: `E2E pagination #${i}`,
        },
      });
      expect(
        res.ok(),
        `POST /api/loans #${i} dovrebbe creare il prestito: ${res.status()} ${await res.text()}`,
      ).toBeTruthy();
      const body = (await res.json()) as { loan: { id: number } };
      created.push(body.loan.id);
    }

    // Pagina 1 di 3 → 2 elementi + X-Total-Count >= 5.
    const page1 = await api.get('/api/loans?limit=2&offset=0', { headers: adminAuth });
    expect(page1.ok()).toBeTruthy();
    const page1Body = (await page1.json()) as { loans: unknown[] };
    expect(page1Body.loans).toHaveLength(2);
    expect(page1.headers()['x-limit']).toBe('2');
    expect(page1.headers()['x-offset']).toBe('0');
    // Su DB fresco il seed non crea loan: il count deve essere esattamente 5
    // (i nostri). Su DB non-fresco potrebbe essere >5 ma mai <5.
    const total = Number(page1.headers()['x-total-count']);
    expect(total).toBeGreaterThanOrEqual(5);

    // Pagina 2: altri 2.
    const page2 = await api.get('/api/loans?limit=2&offset=2', { headers: adminAuth });
    expect(page2.ok()).toBeTruthy();
    const page2Body = (await page2.json()) as { loans: { id: number }[] };
    expect(page2Body.loans).toHaveLength(2);

    // Le pagine non si sovrappongono.
    const idsPage1 = (page1Body.loans as { id: number }[]).map((l) => l.id);
    const idsPage2 = page2Body.loans.map((l) => l.id);
    for (const id of idsPage2) {
      expect(idsPage1).not.toContain(id);
    }

    // Cap anti-DoS: richiesta con limit gigante → server clamp a MAX_LIMIT=500.
    const huge = await api.get('/api/loans?limit=999999', { headers: adminAuth });
    expect(huge.ok()).toBeTruthy();
    expect(Number(huge.headers()['x-limit'])).toBeLessThanOrEqual(500);

    await api.dispose();
  });
});
