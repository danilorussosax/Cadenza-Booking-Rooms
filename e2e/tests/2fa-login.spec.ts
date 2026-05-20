import { test, expect } from '@playwright/test';

/**
 * Login a due passaggi (2FA email OTP).
 *
 * Lo spec copre il PRIMO step end-to-end: form email/password → submit →
 * UI mostra il campo OTP (id `twofa-code`). Il secondo step (consumo del
 * codice e issue del JWT finale) è coperto dai test integration backend e
 * non è ripetibile in E2E senza un'API per leggere la `twoFaChallenge`
 * stored in DB (il codice viene mandato via email, in test l'SMTP è no-op).
 *
 * Verifiche aggiuntive:
 *  - request.post '/api/auth/login' su admin2fa restituisce needsTwoFa:true,
 *    un tempToken non vuoto e una maschera email coerente.
 *  - admin "normale" senza 2FA NON riceve needsTwoFa.
 */
test.describe('Login con 2FA email', () => {
  test('UI: dopo password appare il form OTP', async ({ page }) => {
    await page.goto('/login');

    // Vista 'choices' → entra in modalità email
    const emailInput = page.locator('#email');
    if (!(await emailInput.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /accedi con email/i }).click();
    }

    await emailInput.fill('admin2fa@test.local');
    await page.locator('#password').fill('Password1!');
    await page.getByRole('button', { name: /^accedi$/i }).click();

    // Forma OTP appare (id `twofa-code`). Per UI usiamo un selettore esplicito.
    await expect(page.locator('#twofa-code')).toBeVisible({ timeout: 10000 });
    // Non c'è ancora un JWT: l'URL NON deve essere /dashboard.
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test('API: admin con twoFaEnabled riceve needsTwoFa + tempToken', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'admin2fa@test.local', password: 'Password1!' },
    });
    // 200 anche per il primo step: il backend distingue tramite needsTwoFa.
    // (503 se SMTP down e impossibile inviare il codice — accettato).
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    if (res.status() === 200) {
      expect(body.needsTwoFa).toBe(true);
      expect(typeof body.tempToken).toBe('string');
      expect(body.tempToken.length).toBeGreaterThan(20);
      // Maschera email (twoFa.maskEmail mostra solo i primi caratteri):
      // es. "admin2fa@test.local" → "adm*****@test.local".
      expect(body.sentTo).toMatch(/^adm.+@test\.local$/);
      expect(typeof body.expiresInMinutes).toBe('number');
    } else {
      // SMTP non disponibile in test → 503 TWO_FA_SEND_FAILED, NO tempToken.
      expect(body.code).toBe('TWO_FA_SEND_FAILED');
      expect(body.tempToken).toBeUndefined();
    }
  });

  test('API: admin senza 2FA NON riceve needsTwoFa', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'admin@test.local', password: 'Password1!' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.needsTwoFa).toBeUndefined();
    expect(typeof body.token).toBe('string');
    expect(body.user).toBeDefined();
  });
});
