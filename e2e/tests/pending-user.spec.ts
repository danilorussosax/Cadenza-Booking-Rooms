import { test, expect, request } from '@playwright/test';

/**
 * Scenario: utente con status='pending' fa login ma non può usare rotte
 * funzionali finché un admin non lo approva.
 *
 * Strategia: registriamo un docente FRESCO via /api/auth/register (un
 * docente diventa sempre 'pending' alla registrazione, vedi routes/auth.js).
 * Non usiamo il pending del seed (`pending@test.local`) perché lo spec
 * admin-approve può approvarlo prima/dopo questo test, rendendo l'ordine
 * di esecuzione un'incognita.
 *
 * Cosa copre:
 *  - registrazione docente ritorna token + user.status='pending';
 *  - le rotte applicative protette da `requireApproved` rispondono 403
 *    con code=ACCOUNT_PENDING — invariante critica per la sicurezza
 *    (un utente non approvato non deve poter creare prenotazioni o
 *    chiedere prestiti).
 */
test.describe('Auth: utente pending — login ammesso, azioni bloccate', () => {
  test('docente appena registrato: POST /api/bookings → 403 ACCOUNT_PENDING', async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });

    // Email univoca per non collidere con esecuzioni concorrenti / repeats.
    const email = `pending-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
    const password = 'Password1Strong!';

    const regRes = await api.post('/api/auth/register', {
      data: {
        email,
        password,
        firstName: 'Pend',
        lastName: 'Test',
        role: 'docente',
      },
    });
    expect(
      regRes.ok(),
      `register dovrebbe ritornare 2xx: ${regRes.status()} ${await regRes.text()}`,
    ).toBeTruthy();
    const { token, user } = (await regRes.json()) as {
      token: string;
      user: { status: string; role: string };
    };
    expect(token).toBeTruthy();
    expect(user.role).toBe('docente');
    expect(user.status, 'docente fresco deve essere pending').toBe('pending');

    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Una rotta che NON richiede `approved` (es. /api/auth/me) deve ancora
    // funzionare — l'utente può vedere il proprio profilo per capire perché
    // l'app gli mostra la barriera.
    const meRes = await api.get('/api/auth/me', { headers: auth });
    expect(meRes.ok()).toBeTruthy();

    // Rotta di business: deve essere bloccata.
    const slot = new Date();
    slot.setUTCDate(slot.getUTCDate() + 1);
    slot.setUTCHours(15, 0, 0, 0);

    const bookingRes = await api.post('/api/bookings', {
      headers: auth,
      data: {
        roomId: 1,
        startTime: slot.toISOString(),
        endTime: new Date(slot.getTime() + 60 * 60 * 1000).toISOString(),
        type: 'lezione',
        purpose: 'E2E pending must fail',
      },
    });
    expect(bookingRes.status(), 'pending non dovrebbe poter creare booking').toBe(403);
    const errBody = (await bookingRes.json()) as { code?: string };
    expect(errBody.code).toBe('ACCOUNT_PENDING');

    // Idem per prestito strumento.
    const loanRes = await api.post('/api/loans', {
      headers: auth,
      data: {
        instrumentId: 1,
        fromDate: slot.toISOString().slice(0, 10),
        toDate: new Date(slot.getTime() + 5 * 86_400_000).toISOString().slice(0, 10),
      },
    });
    expect(loanRes.status(), 'pending non dovrebbe poter richiedere prestiti').toBe(403);
    const loanErr = (await loanRes.json()) as { code?: string };
    expect(loanErr.code).toBe('ACCOUNT_PENDING');

    await api.dispose();
  });
});
