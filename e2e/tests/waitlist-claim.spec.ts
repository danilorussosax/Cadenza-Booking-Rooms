import { test, expect, request } from '@playwright/test';

/**
 * Scenario: conflict → join waitlist → claim.
 *
 * Strategia mista per non dipendere da timing UI:
 *  - Login API per ottenere il token JWT.
 *  - Un primo utente prenota uno slot.
 *  - Un secondo utente tenta lo stesso slot → conflict → join waitlist.
 *  - Cancella la prima prenotazione → la entry waitlist viene notificata.
 *  - Il secondo utente riscatta la entry (claim) → 201 + booking creata.
 *
 * Per il test usiamo solo lo studente@test.local (proprietario = stesso
 * utente). Per simulare due utenti distinti aggiungeremmo un altro user
 * nel seed: questa è la versione "minima" che verifica la logica della
 * coda end-to-end via API.
 */
test.describe('Waitlist: conflict → claim', () => {
  test('un utente in coda riceve la notifica e riscatta', async ({ baseURL }) => {
    const ctx = await request.newContext({ baseURL });

    // Login admin (ha autorizzazione su tutto)
    const loginAdmin = await ctx.post('/api/auth/login', {
      data: { email: 'admin@test.local', password: 'Password1!' },
    });
    expect(loginAdmin.status()).toBe(200);
    const adminToken: string = (await loginAdmin.json()).token;
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };

    // Login studente
    const loginStud = await ctx.post('/api/auth/login', {
      data: { email: 'studente@test.local', password: 'Password1!' },
    });
    expect(loginStud.status()).toBe(200);
    const studToken: string = (await loginStud.json()).token;
    const studHeaders = { Authorization: `Bearer ${studToken}` };

    // Recupera la prima room
    const roomsRes = await ctx.get('/api/structure/rooms', { headers: adminHeaders });
    expect(roomsRes.status()).toBe(200);
    const room = (await roomsRes.json()).rooms[0];

    // Slot deterministico (+3 giorni, 13:00 UTC) per non collidere con
    // booking-suggestions.spec ("+1 giorno 10:00 UTC", blocker non
    // cancellato) o login-booking.spec ("+2 giorni 15:00 local").
    // L'orario flakkato pre-fix (top-of-hour locale) faceva 1/24 fail in CI.
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 3);
    start.setUTCHours(13, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    // L'admin prenota lo slot
    const adminBooking = await ctx.post('/api/bookings', {
      headers: adminHeaders,
      data: {
        roomId: room.id,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      },
    });
    expect(adminBooking.status()).toBe(201);

    // Lo studente tenta lo stesso slot → conflict
    const studBookingFail = await ctx.post('/api/bookings', {
      headers: studHeaders,
      data: {
        roomId: room.id,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      },
    });
    expect([400, 409]).toContain(studBookingFail.status());

    // Lo studente entra in waitlist
    const joinWl = await ctx.post('/api/bookings/waitlist', {
      headers: studHeaders,
      data: {
        roomId: room.id,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      },
    });
    expect(joinWl.status()).toBe(201);
    const entryId: number = (await joinWl.json()).entry.id;

    // Cancella la prenotazione admin → l'hook afterDestroy/afterUpdate
    // notifica il primo in coda
    const adminBookingId: number = (await adminBooking.json()).booking.id;
    const cancel = await ctx.delete(`/api/bookings/${adminBookingId}`, {
      headers: adminHeaders,
    });
    expect(cancel.status()).toBeLessThan(400);

    // Lo studente riscatta la entry: il backend la marca come claimed
    // e crea la booking
    const claim = await ctx.post(`/api/bookings/waitlist/${entryId}/claim`, {
      headers: studHeaders,
    });
    expect(claim.status()).toBe(201);
    const claimBody = await claim.json();
    expect(claimBody.booking.userId).toBeDefined();
  });
});
