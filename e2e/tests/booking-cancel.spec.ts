import { test, expect, request } from '@playwright/test';

/**
 * Scenario: utente cancella la propria prenotazione.
 *
 * Coverage: DELETE /api/bookings/:id + invariante "status=cancelled" lato DB
 * (esposto come campo nella response GET di lista). Importante perché la
 * cancellazione è la pre-condizione affinché la waitlist faccia il claim e
 * l'aula torni libera per la pianificazione.
 *
 * Strategia API-first (no UI): la cancellazione è esposta da un singolo
 * endpoint REST; testarla via UI implicherebbe aprire un dialog di conferma
 * fragile in headless. Lo smoke spec del frontend già copre la navigazione
 * UI delle prenotazioni.
 */
test.describe('Booking: cancellazione da parte del proprietario', () => {
  test('studente crea booking, lo cancella, sparisce dagli attivi', async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });

    const login = await api.post('/api/auth/login', {
      data: { email: 'studente@test.local', password: 'Password1!' },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Trova un'aula prenotabile dal seed.
    const roomsRes = await api.get('/api/structure/rooms', { headers: auth });
    expect(roomsRes.ok()).toBeTruthy();
    const roomsBody = (await roomsRes.json()) as { rooms?: { id: number; isBookable?: boolean }[] };
    const rooms = roomsBody.rooms ?? [];
    const room = rooms.find((r) => r.isBookable !== false);
    expect(room, 'nessuna aula prenotabile nel seed').toBeTruthy();

    // Crea la booking — slot futuro per evitare check di "passato".
    const slot = new Date();
    slot.setUTCDate(slot.getUTCDate() + 2);
    slot.setUTCHours(9, 0, 0, 0);
    const startTime = slot.toISOString();
    const endTime = new Date(slot.getTime() + 60 * 60 * 1000).toISOString();

    const createRes = await api.post('/api/bookings', {
      headers: auth,
      data: {
        roomId: room!.id,
        startTime,
        endTime,
        type: 'lezione',
        purpose: 'E2E cancel test',
      },
    });
    expect(
      createRes.ok(),
      `POST /api/bookings dovrebbe creare la booking: ${createRes.status()} ${await createRes.text()}`,
    ).toBeTruthy();
    const created = (await createRes.json()) as { booking: { id: number; status: string } };
    const bookingId = created.booking.id;
    expect(created.booking.status).toBe('confirmed');

    // Cancellazione.
    const cancelRes = await api.delete(`/api/bookings/${bookingId}`, {
      headers: auth,
      data: { reason: 'E2E cancel' },
    });
    expect(
      cancelRes.ok(),
      `DELETE /api/bookings/${bookingId} dovrebbe avere successo: ${cancelRes.status()} ${await cancelRes.text()}`,
    ).toBeTruthy();

    // Verifica: la booking ora ha status=cancelled (fetch singola).
    const fetchRes = await api.get(`/api/bookings/${bookingId}`, { headers: auth });
    if (fetchRes.ok()) {
      const fresh = (await fetchRes.json()) as { booking?: { status: string } };
      const status = fresh.booking?.status ?? (fresh as unknown as { status?: string }).status;
      expect(status).toBe('cancelled');
    } else {
      // Alcuni backend rispondono 404 alle cancellate "dal punto di vista utente".
      // Entrambi i comportamenti sono accettabili — l'importante è che non sia più attiva.
      expect([404, 410]).toContain(fetchRes.status());
    }

    // Verifica: non compare più tra le mie booking attive.
    const mineRes = await api.get('/api/bookings/mine?status=upcoming', { headers: auth });
    if (mineRes.ok()) {
      const mineBody = (await mineRes.json()) as {
        bookings?: { id: number }[];
        items?: { id: number }[];
      };
      const items = mineBody.bookings ?? mineBody.items ?? [];
      expect(items.find((b) => b.id === bookingId)).toBeUndefined();
    }

    await api.dispose();
  });
});
