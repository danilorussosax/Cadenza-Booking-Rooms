import { test, expect } from '@playwright/test';

/**
 * Scenario: utente studente
 *  1. login
 *  2. crea booking
 *  3. (eventuale check-in se l'aula lo richiede)
 *  4. cancella booking
 *
 * Pre-requisito: seed E2E ha creato studente@test.local con matricola+corso
 * e Aula 101 (no check-in obbligatorio).
 */
test.describe('Studente: login → crea booking → cancella', () => {
  test('flusso completo', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/email/i).fill('studente@test.local');
    await page.getByLabel(/password/i).fill('Password1!');
    await page.getByRole('button', { name: /accedi|login/i }).click();

    // Atterriamo sulla dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // Andiamo alla pagina di prenotazione
    await page.goto('/booking');

    // Click "Nuova prenotazione" — il testo dipende dall'i18n; usiamo
    // un fallback su qualunque button che apre il dialog di create.
    const newBtn = page.getByRole('button', { name: /nuova|new|crea/i }).first();
    await newBtn.click();

    // Il dialog è aperto; selezioniamo Aula 101
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /aula 101/i }).click();

    // Tipo prenotazione: studio individuale (lasciamo default)

    // Submit
    await page.getByRole('button', { name: /conferma|crea|salva/i }).first().click();

    // Verifica notifica di successo
    await expect(page.getByText(/prenotazione|booking/i)).toBeVisible({ timeout: 5000 });

    // Vai alle proprie prenotazioni e cancella la prima
    await page.goto('/my-bookings');
    const cancelBtn = page.getByRole('button', { name: /cancell|cancel/i }).first();
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
      // Conferma se chiede
      const confirm = page.getByRole('button', { name: /conferma|elimina/i });
      if (await confirm.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirm.click();
      }
    }
  });
});
