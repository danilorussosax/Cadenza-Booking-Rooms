import { test, expect } from '@playwright/test';

/**
 * Scenario: ciclo completo di prestito strumento.
 *  1. Studente richiede prestito (status: requested)
 *  2. Admin approva (status: active)
 *  3. Studente restituisce (status: returned)
 *
 * Pre-requisiti dal seed E2E:
 *  - studente@test.local (Password1!)
 *  - admin@test.local (Password1!)
 *  - Strumento "Violino E2E" (loanable, condizione 'ottimo')
 */

const STUDENT = { email: 'studente@test.local', password: 'Password1!' };
const ADMIN = { email: 'admin@test.local', password: 'Password1!' };

async function login(page, creds) {
  await page.goto('/login');
  // La login ha due viste: 'choices' (OAuth + email) e 'email' (form classico).
  // Se la vista corrente non è quella del form, clicca "Accedi con email".
  const emailInput = page.locator('#email');
  if (!(await emailInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /accedi con email/i }).click();
  }
  await emailInput.fill(creds.email);
  await page.locator('#password').fill(creds.password);
  await page.getByRole('button', { name: /^accedi$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await dismissModals(page);
}

/**
 * Chiude i dialog che bloccano l'app dopo il login:
 *  - Banner cookie tecnici (bottone "Accetta")
 *  - Dialog "Aggiornamento documenti legali" (checkbox + Accetta e continua)
 */
async function dismissModals(page) {
  // Legal docs dialog: checkbox di privacy + termini, poi accetta.
  const legalDialog = page.getByRole('dialog', { name: /aggiornamento dei documenti legali/i });
  if (await legalDialog.isVisible().catch(() => false)) {
    await legalDialog.getByRole('checkbox').first().check();
    await legalDialog.getByRole('checkbox').nth(1).check();
    await legalDialog.getByRole('button', { name: /accetta e continua/i }).click();
    await expect(legalDialog).not.toBeVisible();
  }
  // Cookie banner.
  const cookieAccept = page.getByRole('button', { name: /^accetta$/i });
  if (await cookieAccept.isVisible().catch(() => false)) {
    await cookieAccept.click();
  }
}

async function logout(page) {
  await page.context().clearCookies();
  await page.evaluate(() => { localStorage.clear(); });
}

function isoDate(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

test.describe('Prestito strumento: richiesta → approve → return', () => {
  test('flusso end-to-end completo', async ({ page }) => {
    // ─── 1. Studente richiede il prestito ─────────────────────────
    await login(page, STUDENT);

    await page.goto('/instruments');
    // Card del Violino E2E con bottone "Richiedi prestito"
    const card = page.locator('text=Violino E2E').locator('xpath=ancestor::*[contains(@class,"overflow-hidden")][1]');
    await expect(card).toBeVisible();

    // Click sul bottone "Richiedi prestito" della card
    await page.getByRole('button', { name: /richiedi prestito/i }).first().click();

    // Compila il dialog (date input native HTML5)
    await page.locator('#loan-from').fill(isoDate(1));
    await page.locator('#loan-to').fill(isoDate(7));

    // Submit
    await page.getByRole('button', { name: /invia richiesta/i }).click();

    // Toast di conferma
    await expect(page.getByText(/richiesta inviata/i)).toBeVisible({ timeout: 5000 });

    // Verifica che compaia in "In attesa"
    await page.goto('/my-loans');
    await page.getByRole('tab', { name: /in attesa/i }).click();
    await expect(page.getByText(/violino e2e/i).first()).toBeVisible();

    await logout(page);

    // ─── 2. Admin approva ─────────────────────────────────────────
    await login(page, ADMIN);

    await page.goto('/admin/instruments');
    // I macro-tab di /admin/instruments sono <button>, non Radix Tabs
    // → niente role=tab. Usa role=button con il label tradotto.
    await page.getByRole('button', { name: /tutti i prestiti/i }).click();

    // Trova la riga del Violino E2E e clicca il bottone "Approva"
    // (icon-button con title="Approva")
    const row = page.getByRole('row').filter({ hasText: /violino e2e/i }).first();
    await expect(row).toBeVisible();
    await row.getByTitle(/approva/i).click();

    // Conferma toast / nuovo stato
    await expect(page.getByText(/prestito approvato/i)).toBeVisible({ timeout: 5000 });

    await logout(page);

    // ─── 3. Studente segna restituito ─────────────────────────────
    await login(page, STUDENT);

    await page.goto('/my-loans');
    // Tab default = "In corso"; click sul bottone "Segna come restituito"
    const returnBtn = page.getByRole('button', { name: /segna come restituito/i });
    await expect(returnBtn).toBeVisible();
    await returnBtn.click();

    // Toast restituito
    await expect(page.getByText(/restituito/i).first()).toBeVisible({ timeout: 5000 });

    // La voce ora è in "Storico"
    await page.getByRole('tab', { name: /storico/i }).click();
    await expect(page.getByText(/violino e2e/i).first()).toBeVisible();
  });
});
