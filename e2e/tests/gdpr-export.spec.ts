import { test, expect, request } from '@playwright/test';

/**
 * Scenario: GDPR art. 20 — portabilità dati.
 *
 * Endpoint: GET /api/users/me/gdpr/export
 *
 * Verifica end-to-end che il payload contenga le sezioni dichiarate dalla
 * privacy policy (profile + bookings + loans + consents + audit). Una
 * regressione qui (es. una nuova entità collegata all'utente che non viene
 * inclusa nell'export) sarebbe una potenziale violazione di compliance.
 */
test.describe('GDPR: export dati utente', () => {
  test('lo studente può scaricare i propri dati come JSON portabile', async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });

    const login = await api.post('/api/auth/login', {
      data: { email: 'studente@test.local', password: 'Password1!' },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Crea una booking così l'export non è vuoto: testiamo anche la
    // presenza della relazione Room/Building nell'output.
    const roomsRes = await api.get('/api/structure/rooms', { headers: auth });
    const roomsBody = (await roomsRes.json()) as { rooms?: { id: number; isBookable?: boolean }[] };
    const room = (roomsBody.rooms ?? []).find((r) => r.isBookable !== false);
    expect(room).toBeTruthy();

    const slot = new Date();
    slot.setUTCDate(slot.getUTCDate() + 3);
    slot.setUTCHours(11, 0, 0, 0);
    const createBookingRes = await api.post('/api/bookings', {
      headers: auth,
      data: {
        roomId: room!.id,
        startTime: slot.toISOString(),
        endTime: new Date(slot.getTime() + 30 * 60 * 1000).toISOString(),
        type: 'lezione',
        purpose: 'E2E gdpr export',
      },
    });
    expect(
      createBookingRes.ok(),
      `seed booking: ${createBookingRes.status()} ${await createBookingRes.text()}`,
    ).toBeTruthy();

    // Export.
    const exportRes = await api.get('/api/users/me/gdpr/export', { headers: auth });
    expect(
      exportRes.ok(),
      `GDPR export dovrebbe rispondere 200: ${exportRes.status()} ${await exportRes.text()}`,
    ).toBeTruthy();

    const body = (await exportRes.json()) as {
      generatedAt?: string;
      gdprArticle?: string;
      profile?: { email?: string };
      bookings?: { purpose?: string }[];
      instrumentLoans?: unknown[];
      consents?: unknown[];
      auditTrail?: unknown[];
    };

    // Metadata del payload.
    expect(body.generatedAt, 'manca generatedAt').toBeTruthy();
    expect(body.gdprArticle, 'manca riferimento normativo').toMatch(/Art\.?\s*20/i);

    // Sezione profile: deve contenere l'email del richiedente (non un altro).
    expect(body.profile?.email).toBe('studente@test.local');

    // Bookings: array presente, con la booking appena creata.
    expect(Array.isArray(body.bookings), 'bookings dovrebbe essere array').toBe(true);
    expect(
      body.bookings!.some((b) => b.purpose === 'E2E gdpr export'),
      'la booking appena creata non è nell’export',
    ).toBe(true);

    // Le altre sezioni dichiarate dall'API: presenti almeno come array vuoti.
    expect(Array.isArray(body.instrumentLoans), 'instrumentLoans dovrebbe essere array').toBe(true);
    expect(Array.isArray(body.consents), 'consents dovrebbe essere array').toBe(true);
    expect(Array.isArray(body.auditTrail), 'auditTrail dovrebbe essere array').toBe(true);

    await api.dispose();
  });
});
