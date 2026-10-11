import { test, expect } from '@playwright/test';
import { loginAs } from './_helpers';

test('prepare, preview, publish and switch academic years', async ({ page }) => {
  await loginAs(page, { email: 'admin@test.local', password: 'Password1!' });
  await page.goto('/admin/monte-ore/settings');
  await page.locator('#aa-select').click();
  await page.getByRole('option', { name: /Crea nuovo anno accademico/ }).click();
  await page
    .getByRole('dialog', { name: 'Crea nuovo anno accademico' })
    .getByLabel('Anno accademico', { exact: true })
    .fill('2033/2034');
  await page.getByRole('button', { name: 'Controlla anteprima' }).click();
  await expect(page.getByText('Sospensioni previste (6)')).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Crea nuovo anno accademico' })
    .getByLabel('Soglia minima ore', { exact: true })
    .fill('240');
  await expect(page.getByRole('button', { name: 'Pubblica anno', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aggiorna anteprima' }).click();
  await page.getByRole('button', { name: 'Salva bozza', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Crea nuovo anno accademico' })).toHaveCount(0);
  await expect(page.getByText('Bozza', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Avvia', exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="number"]').first()).toHaveValue('240');
  await page.getByRole('button', { name: 'Pubblica anno', exact: true }).click();
  await expect(page.getByText('Pubblicato', { exact: true })).toBeVisible();
  await expect(page.getByText('Invio chiuso', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Avvia', exact: true }).click();
  await page
    .getByRole('dialog', { name: /Avviare l'AA/ })
    .getByRole('button', { name: 'Avvia', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Ripristina automatico' })).toBeVisible();
  await page.getByRole('button', { name: 'Ripristina automatico' }).click();
  await page
    .getByRole('dialog', { name: /Ripristinare la selezione automatica/ })
    .getByRole('button', { name: 'Ripristina', exact: true })
    .click();
  // A second year must get its own default form, not the previous year's 240 hours.
  await page.locator('#aa-select').click();
  await page.getByRole('option', { name: /Crea nuovo anno accademico/ }).click();
  await page
    .getByRole('dialog', { name: 'Crea nuovo anno accademico' })
    .getByLabel('Anno accademico', { exact: true })
    .fill('2034/2035');
  await page.getByRole('button', { name: 'Controlla anteprima' }).click();
  await page.getByRole('button', { name: 'Pubblica anno', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Crea nuovo anno accademico' })).toHaveCount(0);
  await expect(page.locator('input[type="number"]').first()).toHaveValue('324');
  await page.locator('#aa-select').click();
  await page.getByRole('option', { name: /AA 2033\/2034/ }).click();
  await expect(page.locator('input[type="number"]').first()).toHaveValue('240');
});
