import { test, expect, request as plRequest } from '@playwright/test';
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
  test('flusso completo', async ({ page }) => {
    await loginAs(page, { email: 'studente@test.local', password: 'Password1!' });

    await page.goto('/booking');
    // h1 in main: "Prenota un'aula" (il banner ha un h1 piu' generico).
    // Match via locator+filter perche' role+name regex pareva non agganciare
    // l'accessible name su alcune versioni Playwright.
    await expect(page.locator('main h1').filter({ hasText: /prenota un.?aula/i })).toBeVisible({
      timeout: 15000,
    });

    // Lucide icon SVG sporca l'accessible name (img senza alt) → getByRole
    // con name regex non aggancia. Cerchiamo il button via il text node.
    const newBtn = page.locator('main button').filter({ hasText: /nuova prenotazione/i }).first();
    await expect(newBtn).toBeVisible({ timeout: 15000 });
    await newBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Selettore Aula (primo combobox del dialog)
    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /aula 101/i }).click();

    // Popola direttamente i campi datetime-local: il flow del calendar
    // (click su cella oraria) li pre-riempie via onSlotClick, ma in test
    // popolarli per ID è più deterministico. Slot: domani alle 10-11.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const ymd = tomorrow.toISOString().slice(0, 10);
    await dialog.locator('#startTime').fill(`${ymd}T10:00`);
    await dialog.locator('#endTime').fill(`${ymd}T11:00`);

    // Submit del form: il bottone in italiano dice "Prenota". Stretto via
    // `type=submit` per non beccare per errore il bottone "Salva come template"
    // che vive nello stesso footer.
    await dialog.locator('button[type="submit"]').click();

    await expect(page.getByText(/prenotazione creata/i)).toBeVisible({ timeout: 5000 });

    // Cleanup deterministico via API: la suite E2E condivide il backend
    // (reuseExistingServer in dev), quindi una booking lasciata in DB qui
    // genera conflitti negli spec successivi (es. waitlist-claim che usa
    // lo stesso slot di "domani"). Il click su /my-bookings UI sarebbe
    // best-effort, qui invece cancelliamo TUTTE le booking dello studente.
    const apiCtx = await plRequest.newContext({ baseURL: page.url().split('/').slice(0, 3).join('/') });
    const login = await apiCtx.post('/api/auth/login', {
      data: { email: 'studente@test.local', password: 'Password1!' },
    });
    const token = (await login.json()).token;
    const auth = { Authorization: `Bearer ${token}` };
    const mine = await apiCtx.get('/api/bookings?mine=true', { headers: auth });
    const bookings: Array<{ id: number }> = (await mine.json()).bookings ?? [];
    for (const b of bookings) {
      await apiCtx.delete(`/api/bookings/${b.id}`, { headers: auth });
    }
    await apiCtx.dispose();
  });
});
