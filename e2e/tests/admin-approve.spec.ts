import { test, expect } from '@playwright/test';

/**
 * Scenario: admin approva un utente in stato pending.
 *
 * Pre-requisito: seed E2E ha creato pending@test.local con role='docente',
 * status='pending'.
 */
test.describe('Admin: approva utente pending', () => {
  test('login admin e approva docente in attesa', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('admin@test.local');
    await page.getByLabel(/password/i).fill('Password1!');
    await page.getByRole('button', { name: /accedi|login/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/admin/users');

    // Trova la riga del docente pending. Il selettore è laschino: il
    // componente reale potrebbe usare badge invece di testo. Cerchiamo
    // l'email come ancoraggio stabile.
    const row = page.getByRole('row', { name: /pending@test\.local/i });
    await expect(row).toBeVisible();

    // Cerca il bottone "Approva" nella riga.
    const approveBtn = row.getByRole('button', { name: /approva|approve/i });
    await approveBtn.click();

    // Dopo l'azione, lo status non dovrebbe più essere "pending".
    await expect(row).not.toContainText(/pending/i);
  });
});
