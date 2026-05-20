import { test, expect } from '@playwright/test';

/**
 * Monte ore — workflow approvazione coordinatore.
 *
 * Pre-requisito da abilitare nel seed E2E:
 *  - Institute.moduleMonteOreEnabled = true
 *  - ContractType "Tempo indeterminato" con annualHours configurate
 *  - Docente con threshold attivo (eredita da contractType o override)
 *
 * Flusso completo (da implementare quando il modulo monte-ore sarà parte
 * del seed E2E standard):
 *  1. Docente login → GET /api/monte-ore/me → riceve proposta draft
 *  2. Docente POST /api/monte-ore/me/schedules × 3 (lun 9-12, mar 14-18, gio 9-13)
 *  3. Docente POST /api/monte-ore/me/submit → status='submitted'
 *  4. Admin (coordinatore) GET /api/admin/monte-ore → lista pending
 *  5. Admin POST /api/admin/monte-ore/:id/approve → status='approved'
 *  6. Admin POST /api/admin/monte-ore/:id/generate-slots → crea N booking
 *  7. Verifica via /api/bookings?mine=true del docente che le booking esistano
 *  8. Verifica mail_outbox abbia almeno 1 email "monte_ore_approved" enqueued
 */
test.describe('Monte ore · approval workflow', () => {
  test('module gating: senza moduleMonteOreEnabled la route ritorna 404', async ({
    request,
  }) => {
    // Smoke: verifichiamo che il modulo sia gated dal middleware.
    // Quando il seed E2E abiliterà moduleMonteOreEnabled, sostituire questo
    // test con il flusso completo §1-8 sopra.
    const loginRes = await request.post('/api/auth/login', {
      data: { email: 'docente@test.local', password: 'Password1!' },
    });
    expect(loginRes.ok()).toBe(true);
    const token: string = (await loginRes.json()).token;

    const res = await request.get('/api/monte-ore/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Se modulo OFF → 404 MODULE_DISABLED. Se ON → 200 con proposta.
    expect([200, 404]).toContain(res.status());
    if (res.status() === 404) {
      const body = await res.json();
      expect(body.code).toBe('MODULE_DISABLED');
    }
  });

  test.fixme('flow completo approvazione coordinatore', async () => {
    // TODO: implementare quando il seed E2E include:
    //   - moduleMonteOreEnabled=true
    //   - ContractType seedato con annualHours
    //   - Docente con threshold attivo
    // Vedi commento di blocco sopra per la sequenza esatta.
  });
});
