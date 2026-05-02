import { test, expect } from '@playwright/test';
import { loginAs } from './_helpers';

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
  // FIXME: il flow attuale di /booking richiede di cliccare una fascia
  // oraria nel calendar per pre-popolare startTime/endTime nel dialog.
  // Cliccare solo "Nuova prenotazione" lascia il form incompleto e il
  // submit fallisce silenziosamente. Refactor del test richiesto:
  // simulare il click in cella oraria 10:00 della griglia, oppure
  // popolare i campi datetime-local direttamente. Tracciato come
  // follow-up — fuori scope mobile-UX sprint.
  test.fixme('flusso completo', async ({ page }) => {
    await loginAs(page, { email: 'studente@test.local', password: 'Password1!' });

    // Andiamo alla pagina di prenotazione e aspettiamo che l'header
    // sia idratato (lazy-loaded route con data fetching iniziale).
    await page.goto('/booking');
    await expect(page.getByRole('heading', { name: /prenota un'?aula/i })).toBeVisible({
      timeout: 10000,
    });

    // Click "Nuova prenotazione" → apre il dialog di create.
    // `filter({ hasText })` invece di `name` perché alcuni snapshot di
    // Playwright separano il text dall'icona in modi che fanno fallire
    // l'accessible-name match.
    const newBtn = page
      .getByRole('button')
      .filter({ hasText: /nuova prenotazione/i })
      .first();
    await newBtn.click();

    // Il dialog è aperto. Lo selezioniamo come scope per evitare di
    // confondere il combobox del dialog con quello della toolbar
    // /booking (entrambi mostrano "Aula 101 · Edificio A").
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Selettore Aula (primo combobox del dialog)
    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /aula 101/i }).click();

    // Submit del form. Pattern stretto per evitare "Salva come template".
    await dialog.getByRole('button', { name: /conferma prenotazione/i }).click();

    // Verifica notifica di successo (toast Sonner). Il pattern stretto
    // evita strict-mode violation con elementi che contengono "prenotazione"
    // (titolo dialog, sidebar header, ecc).
    await expect(page.getByText(/prenotazione creata/i)).toBeVisible({ timeout: 5000 });

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
