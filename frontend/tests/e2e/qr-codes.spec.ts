import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('QR aule: elenco, PNG autenticato, download e rigenerazione', async ({ page }) => {
  await page.goto('/login');
  if (!(await page.locator('#email').isVisible()))
    await page.getByRole('button', { name: /accedi con email/i }).click();
  await page.locator('#email').fill('admin@test.local');
  await page.locator('#password').fill('Password1!');
  await page.getByRole('button', { name: /^accedi$/i }).click();
  await expect(page).toHaveURL(/dashboard/);
  const cookies = page.getByRole('dialog', { name: 'Preferenze cookie' });
  if (await cookies.isVisible())
    await cookies.getByRole('button', { name: 'Rifiuta', exact: true }).click();

  const overview = page.waitForResponse((response) =>
    response.url().includes('/rooms/qr-overview'),
  );
  const pngResponse = page.waitForResponse((response) =>
    /\/rooms\/\d+\/qr(?:\?|$)/.test(response.url()),
  );
  await page.goto('/admin/server-settings?tab=qrcodes');
  expect((await overview).status()).toBe(200);
  const png = await pngResponse;
  expect(png.status()).toBe(200);
  expect(png.headers()['content-type']).toContain('image/png');
  const authorization = await png.request().headerValue('authorization');
  expect(authorization).toMatch(/^Bearer /);
  expect(png.url()).not.toContain('token=');

  const firstImage = page.getByRole('img', { name: /^QR / }).first();
  await expect(firstImage).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => firstImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBe(600);
  const firstUrl = await firstImage.getAttribute('src');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Scarica', exact: true }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^qr-.+\.png$/);
  const file = await download.path();
  expect(file).not.toBeNull();
  const bytes = await readFile(file!);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

  page.once('dialog', (dialog) => dialog.accept());
  const regenerated = page.waitForResponse((response) => response.url().endsWith('/qr/regenerate'));
  await page.getByRole('button', { name: 'Rigenera', exact: true }).first().click();
  expect((await regenerated).status()).toBe(200);
  await expect(firstImage).not.toHaveAttribute('src', firstUrl!);
  await expect
    .poll(() => firstImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBe(600);
});
