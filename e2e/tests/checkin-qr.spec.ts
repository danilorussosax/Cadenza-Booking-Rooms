import { test, expect } from '@playwright/test';

/**
 * Check-in QR — flow docente.
 *
 * Pre-condizioni dal seed E2E:
 *  - docente@test.local con booking attiva su Aula 101 (now-15min → now+45min)
 *  - Aula 101 con requireCheckIn=true e qrToken='e2e-room-101-qr-fixed-token-12345'
 *
 * Spec:
 *  1. Login API → ottieni JWT del docente
 *  2. GET /api/bookings/checkin-candidates?roomId=... → la booking corrente è
 *     eleggibile e compare nella lista
 *  3. POST /api/bookings/:id/checkin con qrToken corretto → 200 + checkedInAt
 *  4. POST di nuovo → 409 ALREADY_CHECKED_IN
 *  5. (negativo) qrToken sbagliato → 400/403 INVALID_TOKEN o simili
 */
const QR_TOKEN = 'e2e-room-101-qr-fixed-token-12345';

test.describe('Check-in QR docente', () => {
  test('flusso completo: candidates → checkin OK → re-checkin 409', async ({ request }) => {
    // 1. Login docente
    const loginRes = await request.post('/api/auth/login', {
      data: { email: 'docente@test.local', password: 'Password1!' },
    });
    expect(loginRes.ok()).toBe(true);
    const token: string = (await loginRes.json()).token;

    // 2. Trova Aula 101
    const roomsRes = await request.get('/api/structure/rooms', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rooms = (await roomsRes.json()).rooms as Array<{ id: number; name: string }>;
    const room = rooms.find((r) => r.name === 'Aula 101');
    expect(room).toBeDefined();

    // 3. Lista candidati al check-in
    const candRes = await request.get(`/api/bookings/checkin-candidates?roomId=${room!.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(candRes.ok()).toBe(true);
    const candidatesBody = await candRes.json();
    // La risposta è { bookings: [...], config: { earlyMinutes, graceMinutes } }
    // oppure { roomCheckInDisabled: true } se l'aula non richiede check-in.
    expect(candidatesBody.roomCheckInDisabled).not.toBe(true);
    expect(Array.isArray(candidatesBody.bookings)).toBe(true);
    expect(candidatesBody.bookings.length).toBeGreaterThan(0);

    const bookingId = candidatesBody.bookings[0].id;

    // 4. Check-in con token QR corretto
    const checkinRes = await request.post(`/api/bookings/${bookingId}/checkin`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { qrToken: QR_TOKEN },
    });
    expect(checkinRes.status()).toBe(200);
    const checkinBody = await checkinRes.json();
    expect(checkinBody.booking.checkedInAt).toBeTruthy();

    // 5. Re-check-in dopo successo → 409 ALREADY_CHECKED_IN
    const reCheckRes = await request.post(`/api/bookings/${bookingId}/checkin`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { qrToken: QR_TOKEN },
    });
    expect(reCheckRes.status()).toBe(409);
    expect((await reCheckRes.json()).code).toBe('ALREADY_CHECKED_IN');
  });
});
