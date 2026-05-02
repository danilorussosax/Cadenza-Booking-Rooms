import { test, expect } from '@playwright/test';
import { loginAs } from './_helpers';

/**
 * Scenario: admin approva un utente in stato pending.
 *
 * Pre-requisito: seed E2E ha creato pending@test.local con role='docente',
 * status='pending'.
 */
test.describe('Admin: approva utente pending', () => {
  test('login admin e approva docente in attesa', async ({ page }) => {
    await loginAs(page, { email: 'admin@test.local', password: 'Password1!' });

    await page.goto('/admin/users');

    // Trova la riga del docente pending. Il selettore è laschino: il
    // componente reale potrebbe usare badge invece di testo. Cerchiamo
    // l'email come ancoraggio stabile.
    const row = page.getByRole('row', { name: /pending@test\.local/i });
    await expect(row).toBeVisible();

    // Cerca il bottone "Approva" nella riga.
    const approveBtn = row.getByRole('button', { name: /approva|approve/i });
    await approveBtn.click();

    // Dopo l'azione lo status passa a "Approvato". Il pattern italiano
    // "in attesa" evita di matchare l'email pending@test.local nella
    // stessa riga.
    await expect(row).not.toContainText(/in attesa/i);
    await expect(row).toContainText(/approvato/i);
  });
});
