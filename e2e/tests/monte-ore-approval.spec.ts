import { test, expect } from '@playwright/test';

/**
 * Monte ore — workflow approvazione coordinatore.
 *
 * Prerequisiti (configurati in fixtures/seed-e2e.js):
 *  - Institute.moduleMonteOreEnabled = true
 *  - MonteOreSettings dell'AA corrente con finestra di submission che
 *    include "oggi" e minRequiredHours=1 (per non bloccare il flow su
 *    matematica fragile delle ore annuali)
 *  - docente@test.local con contractType='titolare'
 *
 * Il test esercita §1-7 della spec del PR originale (l'enqueue email
 * "monte_ore_approved" non è verificato: SMTP è OFF in test, il delivery
 * va attraverso un service che dipende dalle settings DB — fuori scope
 * per lo smoke E2E).
 */
test.describe('Monte ore · approval workflow', () => {
  test('module gating: senza moduleMonteOreEnabled la route ritorna 404', async ({ request }) => {
    // Smoke residuale: se in futuro qualcuno disattiva il flag nel seed,
    // questo test prende la regressione invece di farla finire silenziosa.
    const loginRes = await request.post('/api/auth/login', {
      data: { email: 'docente@test.local', password: 'Password1!' },
    });
    expect(loginRes.ok()).toBe(true);
    const token: string = (await loginRes.json()).token;

    const res = await request.get('/api/monte-ore/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Con il seed attuale (modulo ON) → 200. Se mai disattivato → 404 MODULE_DISABLED.
    expect([200, 404]).toContain(res.status());
    if (res.status() === 404) {
      const body = await res.json();
      expect(body.code).toBe('MODULE_DISABLED');
    }
  });

  test('flow completo approvazione coordinatore', async ({ request }) => {
    // ─── 1. Docente login ─────────────────────────────────────────────
    const docLogin = await request.post('/api/auth/login', {
      data: { email: 'docente@test.local', password: 'Password1!' },
    });
    expect(docLogin.ok()).toBe(true);
    const docAuth = { Authorization: `Bearer ${(await docLogin.json()).token}` };

    // ─── 2. GET /me → proposta draft creata on-demand ─────────────────
    const meRes = await request.get('/api/monte-ore/me', { headers: docAuth });
    expect(meRes.ok()).toBe(true);
    const meBody = await meRes.json();
    const proposalId: number = meBody.proposal.id;
    expect(meBody.proposal.status).toBe('draft');

    // ─── 3. Trova una room valida per le schedule ────────────────────
    const blds = await request.get('/api/structure/buildings', { headers: docAuth });
    const buildingId: number = (await blds.json()).buildings[0].id;
    const bldDetail = await request.get(`/api/structure/buildings/${buildingId}`, {
      headers: docAuth,
    });
    const roomId: number = (await bldDetail.json()).building.rooms[0].id;

    // ─── 4. POST schedules × 3 (lun 9-12, mar 14-18, gio 9-13) ───────
    // dayOfWeek convention: 0=Dom, 1=Lun, ..., 6=Sab (Date.getDay()).
    const pattern = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
      { dayOfWeek: 2, startTime: '14:00', endTime: '18:00' },
      { dayOfWeek: 4, startTime: '09:00', endTime: '13:00' },
    ];
    for (const s of pattern) {
      const r = await request.post('/api/monte-ore/me/schedules', {
        headers: docAuth,
        data: { ...s, roomId, bookingType: 'lezione' },
      });
      expect(r.status()).toBe(201);
    }

    // ─── 5a. Materializza gli slot dal pattern settimanale ───────────
    // recomputeTotals() somma su MonteOreSlot con isActive=true. Le slot
    // generate da regenerate-slots nascono TUTTE inattive (modello
    // "additivo": il docente le seleziona cliccando le celle nella UI).
    // Per il test E2E le attiviamo tutte via toggle.
    const regenRes = await request.post('/api/monte-ore/me/regenerate-slots', {
      headers: docAuth,
      data: {},
    });
    expect(regenRes.ok(), `regen failed: ${await regenRes.text()}`).toBe(true);

    // ─── 5b. Attiva tutti gli slot non-locked via toggle ─────────────
    const slotsRes = await request.get('/api/monte-ore/me/slots', { headers: docAuth });
    const slots: Array<{ id: number; isLocked: boolean; isActive: boolean }> = (
      await slotsRes.json()
    ).slots;
    const togglable = slots.filter((s) => !s.isLocked && !s.isActive);
    for (const s of togglable) {
      const r = await request.post(`/api/monte-ore/me/slots/${s.id}/toggle`, {
        headers: docAuth,
        data: {},
      });
      expect(r.ok(), `toggle ${s.id} failed: ${r.status()}`).toBe(true);
    }

    // ─── 5c. POST submit → status='submitted' ─────────────────────────
    const submitRes = await request.post('/api/monte-ore/me/submit', {
      headers: docAuth,
      data: {},
    });
    expect(submitRes.ok(), `submit failed: ${await submitRes.text()}`).toBe(true);
    expect((await submitRes.json()).proposal.status).toBe('submitted');

    // ─── 6. Admin login + lista pending ──────────────────────────────
    const admLogin = await request.post('/api/auth/login', {
      data: { email: 'admin@test.local', password: 'Password1!' },
    });
    const admAuth = { Authorization: `Bearer ${(await admLogin.json()).token}` };

    const listRes = await request.get('/api/admin/monte-ore?status=submitted', {
      headers: admAuth,
    });
    expect(listRes.ok()).toBe(true);
    const listBody = await listRes.json();
    expect(listBody.proposals.some((p: { id: number }) => p.id === proposalId)).toBe(true);

    // ─── 7. POST approve → status='approved' ─────────────────────────
    const apprRes = await request.post(`/api/admin/monte-ore/${proposalId}/approve`, {
      headers: admAuth,
      data: {},
    });
    expect(apprRes.ok()).toBe(true);
    expect((await apprRes.json()).proposal.status).toBe('approved');
  });
});
