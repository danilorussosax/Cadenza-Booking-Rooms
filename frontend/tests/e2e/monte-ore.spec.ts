import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  if (!(await page.locator('#email').isVisible()))
    await page.getByRole('button', { name: /accedi con email/i }).click();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('Password1!');
  await page.getByRole('button', { name: /^accedi$/i }).click();
  await expect(page).toHaveURL(/dashboard/);
  const cookies = page.getByRole('dialog', { name: 'Preferenze cookie' });
  if (await cookies.isVisible())
    await cookies.getByRole('button', { name: 'Rifiuta', exact: true }).click();
  await page.waitForLoadState('networkidle');
  return await page.evaluate(() => localStorage.getItem('conservatory_token'));
}

test('monte ore: proposta → aula definitiva → variazione modificata → email accodata', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const adminLogin = await request.post('/api/auth/login', {
    data: { email: 'admin@test.local', password: 'Password1!' },
  });
  const adminLoginBody = (await adminLogin.json()) as { token: string };
  expect(
    (
      await request.post('/api/admin/monte-ore/academic-years/2027%2F2028/activate-for-teachers', {
        headers: { Authorization: `Bearer ${adminLoginBody.token}` },
        data: { active: true },
      })
    ).ok(),
  ).toBeTruthy();
  const teacherToken = await login(page, 'monte@test.local');
  const headers = { Authorization: `Bearer ${teacherToken}` };
  const mine = await request.get('/api/monte-ore/me?year=2027/2028', { headers });
  expect(mine.ok()).toBeTruthy();
  const { proposal } = (await mine.json()) as { proposal: { id: number } };
  expect(
    (
      await request.post('/api/monte-ore/me/schedules', {
        headers,
        data: {
          academicYear: '2027/2028',
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '10:00',
          roomId: null,
          bookingType: 'lezione',
        },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post('/api/monte-ore/me/regenerate-slots', {
        headers,
        data: { academicYear: '2027/2028' },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post('/api/monte-ore/me/slots/select', {
        headers,
        data: {
          academicYear: '2027/2028',
          dateFrom: '2027-11-01',
          dateTo: '2027-11-08',
          isActive: true,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto('/monte-ore');
  await expect(page.getByText('✓ Piano conforme al contratto')).toBeVisible();
  await page
    .getByRole('button', { name: /invia.*coordinatore|invia proposta/i })
    .first()
    .click();
  await expect(page.getByText('In attesa di approvazione', { exact: true })).toBeVisible();

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const adminToken = await login(admin, 'admin@test.local');
  await admin.evaluate(() => localStorage.setItem('monteOre.admin.selectedYear', '2027/2028'));
  await admin.goto('/admin/monte-ore');
  await admin.getByText('Workflow Monte', { exact: false }).first().click();
  // Le aule possono arrivare prima dell'anteprima: l'assegnazione deve attendere gli slot.
  let releasePreview: () => void = () => undefined;
  const previewGate = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  await admin.route('**/api/admin/monte-ore/*/preview', async (route) => {
    if (route.request().method() === 'GET') await previewGate;
    await route.continue();
  });
  await admin.getByRole('button', { name: 'Verifica aule e approva' }).click();
  const approval = admin.getByRole('dialog', { name: 'Verifica piano e aule', exact: true });
  await expect(approval.getByRole('heading', { name: 'Verifica piano e aule' })).toBeVisible();
  try {
    await expect(approval.locator('select').first()).toBeDisabled();
  } finally {
    releasePreview();
  }
  await approval.locator('select').first().selectOption({ label: 'Aula 101' });
  await approval.getByRole('button', { name: 'Verifica piano e aule', exact: true }).click();
  await expect(
    approval.getByText('Nessun conflitto: piano pronto per l’approvazione'),
  ).toBeVisible();
  await approval.getByRole('button', { name: 'Approva e crea prenotazioni' }).click();
  await expect(approval).not.toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Richiedi variazione', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Lezione da modificare').selectOption({ index: 1 });
  await editor.getByLabel('Inizio', { exact: true }).fill('10:00');
  await editor.getByLabel('Fine', { exact: true }).fill('11:00');
  await editor.getByLabel('Motivazione').fill('Cambio didattica');
  await editor.getByRole('button', { name: 'Invia richiesta' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByText('Richieste inviate: 1/3 · Disponibili: 2')).toBeVisible();

  await admin.goto('/admin/monte-ore');
  await admin.getByRole('button', { name: /richieste variazioni/i }).click();
  await admin.getByRole('button', { name: 'Rivedi / modifica' }).click();
  const review = admin.getByRole('dialog');
  await review.getByLabel('Inizio', { exact: true }).fill('11:00');
  await review.getByLabel('Fine', { exact: true }).fill('12:00');
  await review.getByLabel('Motivazione').fill('Aula libera dalle 11');
  await review.getByRole('button', { name: 'Modifica e approva' }).click();
  await expect(review).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Storico variazioni/ }).click();
  await expect(page.getByText('Aula libera dalle 11')).toBeVisible();
  await expect(page.getByText('Email: accodata')).toBeVisible();
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  const outbox = await request.get('/api/admin/mail-outbox', { headers: adminHeaders });
  expect(outbox.ok()).toBeTruthy();
  const raw = await outbox.text();
  expect(raw).toContain('monte_ore_modified');
  const final = await request.get(`/api/admin/monte-ore/${proposal.id}`, { headers: adminHeaders });
  const body = (await final.json()) as {
    proposal: { requestCount: number; totalHoursPlanned: number };
  };
  expect(body.proposal.requestCount).toBe(1);
  expect(body.proposal.totalHoursPlanned).toBe(2);
  await adminContext.close();
});
