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

Soglie **bloccanti** (esito CI fallisce sotto target). Tutti gli 8 assi (4 backend + 4 frontend) sopra 60 %.

**Backend** (`backend/vitest.config.js`):

| Asse       | Soglia | Misurato 2026-05-12 |
| ---------- | ------ | ------------------- |
| Statements | ≥ 72 % | **73.59 %**         |
| Lines      | ≥ 73 % | **74.91 %**         |
| Functions  | ≥ 78 % | **79.43 %**         |
| Branches   | ≥ 60 % | **62.27 %**         |

**Frontend** (`frontend/vitest.config.ts`):

| Asse       | Soglia | Misurato 2026-05-12 |
| ---------- | ------ | ------------------- |
| Statements | ≥ 60 % | **78.79 %**         |
| Lines      | ≥ 60 % | **80.98 %**         |
| Functions  | ≥ 50 % | **68.04 %**         |
| Branches   | ≥ 50 % | **61.17 %**         |

Le soglie crescono con il coverage: floor = misurato − ~1.5 punti, così nuovi test alzano la barra mentre regressioni vengono bloccate dal CI. Quando aggiungi test che migliorano la copertura, alza anche le soglie.

Stato 2026-05-12: **1.386 test backend** (12 skipped postgres-only, 70 file) + **177 frontend** (2 skipped, 19 file) + **5 spec E2E** = 1.568 test totali. Servizi parser CSV (`structureImporter`, `instrumentImporter`, `fieldMapping`) e `twoFa` al 100 % / 88 % / 100 % / 100 %. Scope frontend: `src/components/**` + `src/lib/**` (pages e dialog admin pesanti coperti via E2E). Esclusioni motivate backend: adapter messaging I/O esterno (telegram, signal_cli, email_imap, whatsapp_cloud), `routes/analytics.js` (coperto da job CI Postgres-only dedicato), `services/announcementEmail.js` (SMTP transporter).

Per area frontend i test componenti coprono i critici (BookingFormDialog, QuotasManager, Heatmap). Estendi in base al rischio.

---

## Test di stabilità (v1.5.1)

In v1.5.1 sono state aggiunte **4 nuove suite di stabilità** che vanno oltre lo unit/integration classico e verificano comportamenti emergenti del sistema (backup integrity, time-travel, smoke E2E, soak in lungo).

### 1. Backup roundtrip

- **File**: `backend/tests/integration/backupRoundtrip.test.js`
- **Cosa fa**: chiama `performBackup()`, estrae il tar.gz prodotto in una dir temporanea, apre la copia SQLite snapshottata con una **connessione Sequelize separata**, e verifica che i conteggi delle tabelle principali (`Users`, `Bookings`, `Rooms`, `Buildings`, `Institutes`, ...) e i join nominativi (`Booking → User → Room`) corrispondano riga-per-riga al DB vivo del test. Garantisce che il backup non perda dati silenziosamente per via di lock, race condition o tabelle dimenticate.
- **Skip**: la suite è skippata automaticamente se `DB_DIALECT !== 'sqlite'` o se l'eseguibile `tar` non è disponibile (es. Windows CI senza WSL).
- **Comando**: `npm --prefix backend test -- backupRoundtrip`

### 2. Time-travel calendario didattico

- **File**: `backend/tests/unit/timeTravel.test.js`
- **Cosa fa**: 20 test sui calcoli temporali del calendario didattico — rollover anno accademico (transizione 31 ottobre → 1 novembre), finestra di submission delle proposte Monte Ore (settembre-ottobre), Computus pasquale per gli anni 2024-2033, comportamento degli override admin sulle finestre. Tutti i test usano `vi.useFakeTimers()` per simulare il salto di data.
- **Comando**: `npm --prefix backend test -- timeTravel`

### 3. Playwright E2E smoke

- **File**: `frontend/tests/e2e/smoke.spec.ts`
- **Cosa fa**: golden path utente end-to-end — login UI con un utente seedato → creazione di una `Booking` via API (saltando la UI per velocità) → verifica che compaia nella lista `Le mie prenotazioni` → logout. Il backend gira con **SQLite in-memory** e serve anche la SPA buildata dal `backend/lib/serveStaticSpa.js`, in modo che il test giri come "monolite" senza nginx.
- **Setup**: `npx playwright install chromium` la prima volta (~150 MB di binari). Va fatto una sola volta per workstation; in CI è cached per workflow.
- **Comandi**:

  ```bash
  npm run e2e              # headless, ~3s, da CI o local
  npm run e2e:ui           # UI mode di Playwright, per debug interattivo
  npm run e2e:headed       # vede il browser Chromium aprirsi (utile in local quando il test sembra "non fare nulla")
  ```

- **CI**: job **separato** dagli unit test perché i binari Playwright sono pesanti e i tempi di setup peggiorerebbero la latenza del feedback. Triggered su `main`/`develop` o su PR con label `e2e`.

### 4. Soak test harness

- **Directory**: `loadtest/` (vedi `loadtest/SOAK.md` per i dettagli)
- **Script principale**: `loadtest/soak.sh` — orchestra tre processi in parallelo per N ore (default 4):
  1. **k6** (`loadtest/soak.js`) — 5 RPS costanti su un mix di endpoint realistici (read-heavy: 60% GET, 30% POST/PUT, 10% delete su test data).
  2. **Node sampler** (`loadtest/sampler.js`) — campiona ogni 30s: memoria del processo `cadenza-backend` da `pm2 jlist`, file descriptors aperti (`lsof | wc -l`), latenza di `/api/ready` (curl), CPU.
  3. **Tail di pm2 logs** per catturare crash o warning.
- **Output**: report aggregato in Markdown (`loadtest/reports/soak-YYYYMMDD-HHmm.md`) con grafici ASCII unicode (`▁▂▃▄▅▆▇█`) per RSS heap nel tempo, percentili p95/p99 di latenza per endpoint, **verdict leak** automatico (`HEALTHY` / `SUSPECT` / `LEAK_CONFIRMED`) basato sulla pendenza della curva RSS.
- **Pre-requisito**: `k6` installato — `brew install k6` su Mac, `apt install k6` su Linux.
- **Comandi**:

  ```bash
  npm run soak                # alias per "bash loadtest/soak.sh", durata di default
  ./loadtest/soak.sh 4        # 4 ore esplicite
  ./loadtest/soak.sh 8        # 8 ore (overnight)
  ```

- **Quando lanciarlo**: la **notte prima** di un rollout maggiore, su **staging** (mai in CI — è un test attivo da ore, non da secondi). Apri il report al mattino, controlla il verdict.

### Sommario comandi rapidi

```bash
# Singole suite di stabilità
npm --prefix backend test -- backupRoundtrip
npm --prefix backend test -- timeTravel

# E2E (richiede una volta: npx playwright install chromium)
npm run e2e
npm run e2e:ui          # debug
npm run e2e:headed      # vede il browser

# Soak (4h default, staging only, k6 richiesto)
npm run soak
```
