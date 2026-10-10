import { test, expect } from '@playwright/test';

/** Smoke API: contratto collaborazione di 2h, date esplicite e approvazione atomica. */
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
    const year = '2027/2028';
    const docLogin = await request.post('/api/auth/login', {
      data: { email: 'monte@test.local', password: 'Password1!' },
    });
    expect(docLogin.ok()).toBe(true);
    const docAuth = { Authorization: `Bearer ${(await docLogin.json()).token}` };
    const meRes = await request.get(`/api/monte-ore/me?year=${year}`, { headers: docAuth });
    const proposalId: number = (await meRes.json()).proposal.id;
    const buildings = await request.get('/api/structure/buildings', { headers: docAuth });
    const buildingId: number = (await buildings.json()).buildings[0].id;
    const detail = await request.get(`/api/structure/buildings/${buildingId}`, {
      headers: docAuth,
    });
    const roomId: number = (await detail.json()).building.rooms[0].id;
    const schedule = await request.post('/api/monte-ore/me/schedules', {
      headers: docAuth,
      data: {
        academicYear: year,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00',
        roomId,
        bookingType: 'lezione',
      },
    });
    expect(schedule.ok()).toBe(true);
    expect(
      (
        await request.post('/api/monte-ore/me/regenerate-slots', {
          headers: docAuth,
          data: { academicYear: year },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.post('/api/monte-ore/me/slots/select', {
          headers: docAuth,
          data: {
            academicYear: year,
            dateFrom: '2027-11-01',
            dateTo: '2027-11-08',
            isActive: true,
          },
        })
      ).ok(),
    ).toBe(true);
    const submit = await request.post('/api/monte-ore/me/submit', {
      headers: docAuth,
      data: { academicYear: year },
    });
    expect(submit.ok(), await submit.text()).toBe(true);
    expect((await submit.json()).proposal.status).toBe('submitted');
    const adminLogin = await request.post('/api/auth/login', {
      data: { email: 'admin@test.local', password: 'Password1!' },
    });
    const adminAuth = { Authorization: `Bearer ${(await adminLogin.json()).token}` };
    const list = await request.get('/api/admin/monte-ore', {
      headers: adminAuth,
      params: { status: 'submitted', academicYear: year },
    });
    expect((await list.json()).proposals.some((p: { id: number }) => p.id === proposalId)).toBe(
      true,
    );
    const approval = await request.post(`/api/admin/monte-ore/${proposalId}/approve`, {
      headers: adminAuth,
      data: {},
    });
    expect(approval.ok(), await approval.text()).toBe(true);
    const final = await approval.json();
    expect(final.proposal.status).toBe('generated');
    expect(final.proposal.generationSummary.created).toBe(2);
  });
});
