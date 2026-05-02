import { expect, type Page } from '@playwright/test';

/**
 * Helper di login condiviso fra gli E2E business.
 *
 * La pagina /login ha due viste: 'choices' (OAuth + CTA email) e 'email'
 * (form classico). Quando si arriva su /login senza un redirect interno
 * la vista iniziale è 'choices', quindi serve cliccare "Accedi con email"
 * prima di poter compilare il form.
 *
 * Naviga verso /login, gestisce le due viste in modo idempotente,
 * compila credenziali, attende il redirect a /dashboard.
 */
export async function loginAs(
  page: Page,
  creds: { email: string; password: string },
): Promise<void> {
  await page.goto('/login');
  const emailInput = page.locator('#email');
  // Se la vista corrente è 'choices', il campo email non è ancora montato:
  // clicca la CTA "Accedi con email" che lo fa apparire.
  if (!(await emailInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /accedi con email/i }).click();
  }
  await emailInput.fill(creds.email);
  await page.locator('#password').fill(creds.password);
  await page.getByRole('button', { name: /^accedi$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
