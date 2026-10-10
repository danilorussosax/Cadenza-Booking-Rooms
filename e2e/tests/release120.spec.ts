import { test, expect } from '@playwright/test';
import { loginAs } from './_helpers';

test('annunci personali raggiungibili dalla navigazione', async ({ page }) => {
  await loginAs(page, { email: 'studente@test.local', password: 'Password1!' });
  await page.locator('a[href="/announcements"]').first().click();
  await expect(page).toHaveURL(/\/announcements$/);
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Bacheca avvisi', exact: true }),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText('404');
});

test('link waitlist mantiene la destinazione attraverso il login', async ({ page }) => {
  await page.goto('/waitlist/claim/999999');
  await expect(page).toHaveURL(/\/login$/);
  if (!(await page.locator('#email').isVisible()))
    await page.getByRole('button', { name: /accedi con email/i }).click();
  await page.locator('#email').fill('studente@test.local');
  await page.locator('#password').fill('Password1!');
  await page.getByRole('button', { name: /^accedi$/i }).click();
  await expect(page).toHaveURL(/\/waitlist\/claim\/999999$/);
  await expect(page.getByRole('status').filter({ hasText: /non disponibile/i })).toBeVisible();
});
