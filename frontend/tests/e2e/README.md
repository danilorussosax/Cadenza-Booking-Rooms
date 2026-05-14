# E2E smoke (Playwright)

Test end-to-end **golden path** del frontend Cadenza. Un singolo spec
(`smoke.spec.ts`) verifica che backend + SPA buildata + DB funzionino
insieme in modalità prod-like: login UI → crea prenotazione via API →
controllo lista in `/my-bookings` → logout.

> Per la suite E2E più ampia (admin approve, prestito strumenti, claim
> waitlist, a11y, ecc.) vedi la directory `e2e/` a root del repo: stessa
> infrastruttura backend, naming dei test diverso.

## Esecuzione

```bash
# Una volta (browser binaries, ~150 MB):
npx playwright install chromium --with-deps

# Smoke test:
npm --prefix frontend run e2e
```

Il primo giro costruisce la SPA in `frontend/dist` (`global-setup.ts`).
I giri successivi saltano la build se `dist/index.html` è presente —
forzare la rebuild con `E2E_FORCE_BUILD=1`.

## Pre-requisiti

- **PostgreSQL non serve**: il backend gira in modalità test con SQLite
  in-memory + seed deterministico (`e2e/fixtures/seed-e2e.js`).
- **Porte libere**: 3199 (backend E2E). Override con
  `E2E_BACKEND_PORT=3200 npm --prefix frontend run e2e`.
- **Build SPA**: `global-setup.ts` la garantisce automaticamente al primo
  avvio.

## Credenziali seed

L'admin disponibile dopo il seed:

- `admin@test.local` / `Password1!`

Altri utenti seedati per test futuri: `studente@test.local`,
`pending@test.local` (stessa password).

## Debug

```bash
# UI interattiva (time-travel, locator inspector):
npm --prefix frontend run e2e:ui

# Browser visibile invece di headless:
npm --prefix frontend run e2e:headed

# Apre il report HTML dell'ultimo run:
npm --prefix frontend run e2e:report
```

In caso di failure Playwright cattura screenshot + video + trace
(retain-on-failure) in `frontend/test-results/`.

## CI

In CI il test deve girare in un job separato dagli unit test perché
installa Chromium (~150 MB). Esempio job step:

```yaml
- name: E2E smoke
  run: |
    npm --prefix frontend ci
    npx --prefix frontend playwright install --with-deps chromium
    npm --prefix frontend run e2e
```

`CI=1` attiva `forbidOnly` + 2 retries + reporter HTML (artifact su
failure).
