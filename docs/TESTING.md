# Testing — Cadenza

Strategia di test su tre livelli:

| Livello                    | Tool                     | Cosa copre                                    | Dove sta                     |
| -------------------------- | ------------------------ | --------------------------------------------- | ---------------------------- |
| Unit / Integration backend | Vitest + Supertest       | Routes, services, middleware                  | `backend/tests/integration/` |
| Component frontend         | Vitest + Testing Library | UI in isolamento, mock API                    | `frontend/tests/components/` |
| E2E                        | Playwright               | Flussi utente reali (login → booking → claim) | `e2e/tests/`                 |

CI: `.github/workflows/ci.yml` esegue backend + frontend su ogni push/PR; E2E solo su `main`/`develop` o PR con label `e2e`.

---

## Comandi rapidi

### Backend

```bash
cd backend
npm test                # one-shot
npm run test:watch      # watch mode
npm run test:coverage   # coverage v8 in coverage/
npm run test:ci         # output minimal per CI
```

### Frontend

```bash
cd frontend
npm test
npm run test:watch
npm run test:coverage
```

### E2E

Prima volta (download dei browser, ~150 MB):

```bash
cd e2e
npm install
npm run install:browsers
```

Poi:

```bash
npm test                # headless
npm run test:headed     # apre Chromium
npm run test:ui         # UI mode (debug interattivo)
npm run report          # apre l'ultimo HTML report
```

L'E2E avvia automaticamente un backend SQLite in-memory con seed deterministico (vedi `e2e/fixtures/seed-e2e.js`) sulla porta `3199`. Per cambiarla: `E2E_BACKEND_PORT=4000 npm test`.

> **Pre-requisito**: il frontend deve essere già buildato (`frontend/dist`). Lo script E2E in CI lo fa automaticamente; in locale, esegui `cd frontend && npm run build` almeno una volta.

---

## Convenzioni

### BDD style

Usiamo il classico `describe → it`. Niente `test()`, niente nesting profondo (max 2 livelli).

```js
describe('POST /api/auth/login', () => {
  it('ritorna 200 con credenziali valide', async () => {
    /* ... */
  });
  it('ritorna 401 con password errata', async () => {
    /* ... */
  });
});
```

- `describe` nomina la **funzionalità** (rotta, componente, servizio).
- `it` descrive **un comportamento** osservabile, in italiano se è coerente con il contesto del progetto.
- Niente `should` ridondante: "ritorna 200 …" è meglio di "should return 200 …".

### Globals (no import)

Backend (`vitest.config.js`) e frontend (`vitest.config.ts`) hanno `globals: true`. Quindi **non importare** `describe`, `it`, `expect`, `beforeAll`, ecc. — sono iniettati nel global. Vitest 3 è ESM-only e l'import via `require('vitest')` non funzionerebbe in CommonJS (backend è CJS).

### Fixtures vs factories

- **Factories** (`backend/tests/factories.js`): per creare entità _vivi_ con valori di default ragionevoli e dipendenze auto-create. Usa quando ti serve un User/Booking/Room "tipico" e non ti interessa il valore esatto dei campi.
- **Fixtures** (`backend/tests/fixtures/*`): per dati statici (CSV di esempio, risposte JSON di provider terzi mockati) che vuoi committare e versionare.

Esempio di factory chain:

```js
const { user, authHeader } = await createAuthedUser({ role: 'studente' });
await createBookingRule({ role: 'studente' });
const room = await createRoom();

const res = await request(app)
  .post('/api/bookings')
  .set('Authorization', authHeader)
  .send({ roomId: room.id, startTime, endTime });
```

`createAuthedUser` ritorna anche un JWT pronto: niente `loginAndGetToken()` ripetuto in ogni test.

### Reset DB tra test

Backend: `beforeEach(() => globalThis.resetDatabase())` ricrea lo schema in-memory. È istantaneo (~5 ms su SQLite `:memory:`). NON chiudere mai `sequelize` in `afterAll` — i test successivi nel file successivo si troverebbero la connessione chiusa (vedi commento in `tests/setup.js`).

### Rate limiter

I limiter (`loginLimiter`, `registerLimiter`, `apiDefaultLimiter`, `gdprLimiter`) sono **disattivati di default** in `NODE_ENV=test` per non sporcare lo stato fra test. I test che vogliono verificare il limiter riattivano l'env localmente:

```js
describe('rate limiting', () => {
  beforeAll(() => {
    process.env.DISABLE_RATE_LIMIT = 'false';
  });
  afterAll(() => {
    process.env.DISABLE_RATE_LIMIT = 'true';
  });
  // ...
});
```

### Mock API frontend

`vi.mock('@/api/...')` deve essere chiamato **prima** di importare il componente che usa quell'API:

```ts
vi.mock('@/api/quotas', () => ({
  quotasApi: { list: vi.fn(), remove: vi.fn() /* ... */ },
}));
import { quotasApi } from '@/api/quotas';
import { QuotasManager } from '@/components/admin/QuotasManager';
```

Vitest hoista i `vi.mock` in cima al file in modo trasparente, ma per leggibilità conviene scriverli all'inizio.

### renderWithProviders

`frontend/tests/test-utils.tsx` espone `renderWithProviders(ui, { initialRoute })` che wrappa con `QueryClientProvider` + `MemoryRouter`. **Sempre** usare quello invece di `render()` diretto — i componenti reali assumono i provider attivi.

i18n nei test è inizializzato con `parseMissingKeyHandler: (key) => key`: ogni `t('foo.bar')` ritorna la chiave letterale `foo.bar`, che usiamo come ancoraggio nelle asserzioni (`screen.getByText('admin.quotas.empty_title')`).

---

## Cosa NON copriamo (e perché)

- **OAuth Google/Microsoft**: richiederebbe mock dei provider esterni o token Stripe-style. Out of scope.
- **Aggregazioni Postgres-only in `/admin/analytics`**: usano `EXTRACT(DOW FROM …)`, `::int` cast, sintassi che SQLite in-memory non supporta. Coperti i soli access control + validazione range; per le query aggregate andrebbe un job CI dedicato con Postgres in container.
- **Constraint EXCLUDE `bookings_no_overlap`**: solo Postgres. Il file `tests/integration/excludeConstraint.test.js` è skippato di default; per eseguirlo configura un Postgres di test e lancia `DB_DIALECT=postgres ... npx vitest run tests/integration/excludeConstraint.test.js`. Vedi `docs/db-constraints.md`.
- **Recurring booking**: non testato in integration al momento; pattern simile a "create booking" + verifica di N entry create.
- **PDF/CSV export**: testabile a livello di "200 OK + content-type". Skippato in questa prima passata.

---

## Aggiungere un nuovo test

1. Identifica il livello giusto. Bug in una funzione → unit. Endpoint che cambia comportamento → integration. Flusso UI con dipendenze multiple → E2E.
2. Per backend: aggiungi un file in `backend/tests/integration/<area>.test.js`. Riusa `factories.js` invece di duplicare boilerplate.
3. Per frontend component: aggiungi un file in `frontend/tests/components/<Component>.test.tsx`. Mocca le API con `vi.mock`.
4. Per E2E: aggiungi un file `e2e/tests/<scenario>.spec.ts`. Se serve un nuovo dato seed, modifica `e2e/fixtures/seed-e2e.js`.
5. Esegui localmente i comandi del livello modificato. Non fare commit se i test del tuo livello sono rossi.

---

## Coverage

Soglie **bloccanti** (`backend/vitest.config.js`, esito CI fallisce sotto target):

| Asse       | Soglia | Misurato 2026-05-12 |
| ---------- | ------ | ------------------- |
| Statements | ≥ 61 % | 62.39 %             |
| Lines      | ≥ 63 % | 64.47 %             |
| Functions  | ≥ 65 % | 66.14 %             |
| Branches   | ≥ 50 % | 51.16 %             |

Le soglie crescono con il coverage: floor = misurato − ~1.5 punti, così nuovi test alzano la barra mentre regressioni vengono bloccate dal CI. Quando aggiungi test che migliorano la copertura, alza anche le soglie.

Stato 2026-05-12: **763 test backend** (12 skipped postgres-only). I servizi parser CSV (`structureImporter`, `instrumentImporter`) e `twoFa` sono ora al 100 % / 88 % / 100 %; il TODO test-debt in `vitest.config.js` è chiuso. Per il frontend la soglia è ≥ 60 % su tutti gli assi (`vitest.config.ts`), misurato 66.97 %.

Per area frontend i test componenti coprono i critici (BookingFormDialog, QuotasManager, Heatmap). Estendi in base al rischio.
