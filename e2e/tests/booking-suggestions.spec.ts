import { test, expect } from '@playwright/test';

/**
 * §2.11 Slot alternativi su conflitto (v1.11.2) + cache validation (v1.12).
 *
 * Verifica fine-to-end via API REST chiamata dal browser context:
 *  - admin crea booking blocker (now+1h, +1h) in Aula 101
 *  - studente tenta lo stesso slot → backend ritorna 400/409 con
 *    code=BOOKING_CONFLICT e suggestions[] non vuoto
 *  - i suggestions hanno la shape attesa (reason ∈ enum, roomId,
 *    startTime/endTime ISO)
 *
 * Niente interazione con il calendar UI (vedi login-booking.spec test.fixme
 * per il problema noto). Questo spec valida il CONTRATTO API che il
 * frontend BookingSuggestionsPanel consuma — un test integration "via
 * browser" è perfetto per coprire il path completo auth+route+payload.
 */
test.describe('Booking suggestions su 409', () => {
  test('studente vede payload suggestions[] su slot occupato', async ({ request }) => {
    // 1. Login come admin (token JWT).
    const adminRes = await request.post('/api/auth/login', {
      data: { email: 'admin@test.local', password: 'Password1!' },
    });
    expect(adminRes.ok()).toBe(true);
    const adminToken: string = (await adminRes.json()).token;

    // 2. Recupera l'Aula 101 dal catalogo aule.
    const roomsRes = await request.get('/api/structure/rooms', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const rooms = (await roomsRes.json()).rooms as Array<{ id: number; name: string }>;
    const aula101 = rooms.find((r) => r.name === 'Aula 101');
    expect(aula101, 'seed E2E deve avere Aula 101').toBeDefined();

    // 3. Slot futuro deterministico (domani 10:00-11:00 UTC).
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(10, 0, 0, 0);
    const endTime = new Date(tomorrow.getTime() + 60 * 60 * 1000);
    const slot = {
      startTime: tomorrow.toISOString(),
      endTime: endTime.toISOString(),
    };

    // 4. Admin prenota lo slot → 201.
    const blockerRes = await request.post('/api/bookings', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { roomId: aula101!.id, ...slot, type: 'lezione' },
    });
    expect(blockerRes.status()).toBe(201);

    // 5. Studente login.
    const studRes = await request.post('/api/auth/login', {
      data: { email: 'studente@test.local', password: 'Password1!' },
    });
    expect(studRes.ok()).toBe(true);
    const studToken: string = (await studRes.json()).token;

    // 6. Studente tenta lo STESSO slot → 400/409 con suggestions.
    const conflictRes = await request.post('/api/bookings', {
      headers: { Authorization: `Bearer ${studToken}` },
      data: {
        roomId: aula101!.id,
        ...slot,
        type: 'studio_individuale',
      },
    });
    expect([400, 409]).toContain(conflictRes.status());
    const body = await conflictRes.json();
    expect(body.code).toBe('BOOKING_CONFLICT');
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(body.suggestions.length).toBeGreaterThan(0);

    // 7. Shape di una suggestion. Reason ∈ enum noto.
    const reasonsExpected = new Set([
      'same_room_shifted_30_after',
      'same_room_shifted_30_before',
      'same_room_shifted_60_after',
      'same_room_shifted_60_before',
      'same_room_shifted_120_after',
      'similar_room_same_time',
      'same_room_next_day',
      'same_room_two_days_later',
    ]);
    for (const s of body.suggestions) {
      expect(typeof s.roomId).toBe('number');
      expect(typeof s.startTime).toBe('string');
      expect(typeof s.endTime).toBe('string');
      expect(reasonsExpected.has(s.reason)).toBe(true);
    }

    // 8. Privacy: studente NON vede ownerLabel (visibile solo a docente/admin).
    if (body.conflictsWith) {
      expect(body.conflictsWith.ownerLabel).toBeNull();
    }
  });
});
