import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Smoke "golden path" E2E: l'unico test che deve sempre passare prima di
 * promuovere una build. Esercita backend + frontend in modalità prod-like
 * (SPA buildata servita dal backend, SQLite in-memory, seed deterministico).
 *
 * Flusso:
 *  1. login UI come admin (form email/password)
 *  2. verifica redirect su /dashboard
 *  3. crea una prenotazione via API con il JWT messo in localStorage dal
 *     login (più resiliente del form: il dialog di /booking richiede
 *     interazione con il calendario per pre-fillare gli slot orari, fragile
 *     in CI headless — il test della form vive nei test di componente)
 *  4. naviga a /my-bookings e verifica che la prenotazione compaia in lista
 *  5. logout — verifica redirect a /login
 *
 * Credenziali: seed deterministico `e2e/fixtures/seed-e2e.js`
 *   admin@test.local / Password1!  (role: admin, status: approved)
 *
 * Risorse: Aula 101 (id varia, la troviamo via GET /api/structure/...).
 */

const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'Password1!';

interface RoomLite {
  id: number;
  name: string;
  isBookable: boolean;
}

/**
 * Risolve un'aula prenotabile interrogando le API pubbliche del backend.
 * In alternativa potremmo hard-codare l'id, ma il seed potrebbe cambiare
 * ordinamento di create: questo è più robusto.
 */
async function findBookableRoom(api: APIRequestContext, token: string): Promise<RoomLite> {
  const res = await api.get('/api/structure/rooms', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `GET /api/structure/rooms ha risposto ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { rooms?: RoomLite[] } | RoomLite[];
  const rooms = Array.isArray(body) ? body : (body.rooms ?? []);
  const bookable = rooms.find((r) => r.isBookable !== false);
  expect(bookable, 'Nessuna aula prenotabile nel seed E2E').toBeTruthy();
  return bookable as RoomLite;
}

test('golden path: login → crea booking via API → vede in lista → logout', async ({
  page,
  request,
  baseURL,
}) => {
  // -------- 1. Login UI --------
  await page.goto('/login');

  // La pagina di login mostra prima la vista "choices" (OAuth + CTA email).
  // Cliccare la CTA "Accedi con email" monta il form classico (campi #email/#password).
  const emailInput = page.locator('#email');
  if (!(await emailInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /accedi con email/i }).click();
  }
  await emailInput.fill(ADMIN_EMAIL);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /^accedi$/i }).click();

  // -------- 2. Redirect post-login --------
  await expect(page).toHaveURL(/\/dashboard/);

  // Estraiamo il JWT che il frontend ha salvato in localStorage per
  // chiamare le API senza dover stub-are la network.
  const token = await page.evaluate(() => localStorage.getItem('conservatory_token'));
  expect(token, 'JWT non trovato in localStorage dopo il login').toBeTruthy();

  // -------- 3. Crea booking via API --------
  const room = await findBookableRoom(request, token!);

  // Slot: domani 14:00–15:00 UTC. La regola BookingRule per admin nel seed
  // E2E è permissiva (allowedStartTime 00:00–23:59, maxAdvanceDays 90),
  // quindi qualsiasi giorno entro 90 va bene.
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(14, 0, 0, 0);
  const start = tomorrow.toISOString();
  const end = new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString();

  const createRes = await request.post('/api/bookings', {
    headers: {
      Authorization: `Bearer ${token!}`,
      'Content-Type': 'application/json',
    },
    data: {
      roomId: room.id,
      startTime: start,
      endTime: end,
      type: 'lezione',
      purpose: 'E2E smoke booking',
    },
  });
  expect(
    createRes.ok(),
    `POST /api/bookings ha risposto ${createRes.status()}: ${await createRes.text()}`,
  ).toBeTruthy();
  const created = (await createRes.json()) as { booking: { id: number; purpose: string } };
  expect(created.booking?.id).toBeGreaterThan(0);

  // -------- 4. Verifica in /my-bookings --------
  await page.goto('/my-bookings');
  // Header pagina visibile (la rotta è lazy + carica via React Query).
  // `first()` perché lo stesso titolo compare sia nella topbar sia nel main:
  // ci basta una qualunque delle due visibili per certificare che la rotta
  // è montata.
  await expect(
    page.getByRole('heading', { level: 1, name: /le mie prenotazioni/i }).first(),
  ).toBeVisible();

  // La booking creata appare in lista: cerchiamo il `purpose` univoco.
  // Pattern flessibile su classi/struttura: ci basta che il testo compaia.
  await expect(page.getByText(/E2E smoke booking/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // -------- 5. Logout --------
  // Il logout vive nel menu utente (avatar in topbar). Il flusso UI varia
  // a seconda del breakpoint, quindi facciamo logout in modo idempotente:
  // chiamiamo POST /api/auth/logout via API e ripuliamo lo storage, poi
  // verifichiamo che / rediriga a /login.
  await page.request.post('/api/auth/logout', {
    headers: { Authorization: `Bearer ${token!}` },
  });
  await page.evaluate(() => {
    localStorage.removeItem('conservatory_token');
  });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);

  // Sanity: l'host risponde sull'origin atteso (utile in caso di mis-config).
  expect(baseURL).toMatch(/^http:\/\/localhost:\d+$/);
});
