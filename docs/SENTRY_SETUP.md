# Cadenza · Sentry / Error Tracking · Setup operativo

> **Stato**: ✅ Già integrato nel codice (backend `lib/sentry.js` + frontend `lib/sentry.ts`).
> **Ciò che manca per la produzione**: 4 variabili d'ambiente, registrazione su `sentry.io`, smoke test, monitoraggio quote.
> **Tempo medio per attivare**: 30 minuti.

---

## 1. Cosa fa Sentry in Cadenza

| Capacità                                                                 | Dove                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Cattura errori non gestiti del backend (Express + Sequelize + bot)       | `backend/lib/sentry.js` + `Sentry.setupExpressErrorHandler(app)` |
| Cattura errori React non gestiti (ErrorBoundary)                         | `frontend/src/components/AppErrorBoundary.tsx`                   |
| Cattura errori frontend dei browser (window.onerror, unhandledrejection) | `Sentry.init()` automatico                                       |
| Tracing performance (10% campionamento)                                  | `tracesSampleRate: 0.1`                                          |
| Anonimizza l'`user.id` con SHA-256 + salt                                | `anonymousUserId()`                                              |
| Rimuove dati sensibili (password, token, codiceFiscale, matricola, …)    | `scrubObject()` su breadcrumb + event                            |
| Scarta noise applicativo (ECONNRESET, RATE_LIMITED, ResizeObserver)      | `ignoreErrors`                                                   |
| Endpoint smoke test admin-only                                           | `POST /api/admin/_sentry/test`                                   |
| Tag `request_id`, `user_role`, `release`, `environment`                  | `setRequestScope()`                                              |
| No-op silenzioso se `SENTRY_DSN` non impostato                           | utile per dev/test locali                                        |

**Compliance GDPR**: l'integrazione è **PII-safe by default**. Cadenza redatta automaticamente:

| Tipo dato                                                         | Valore inviato a Sentry         |
| ----------------------------------------------------------------- | ------------------------------- |
| `password`, `currentPassword`, `newPassword`                      | `[REDACTED]`                    |
| `token`, `accessToken`, `refreshToken`                            | `[REDACTED]`                    |
| `secret`, `clientSecret`, `apiKey`, `twoFaSecret`, `recoveryCode` | `[REDACTED]`                    |
| `codiceFiscale`, `matricola`, `vatNumber`, `fiscalCode`           | `[REDACTED]`                    |
| `email`, `firstName`, `lastName`, `phone`                         | `[PII]` (label, niente valore)  |
| `cookies`                                                         | `[REDACTED]`                    |
| `user.id`                                                         | hash SHA-256 (16 char) con salt |

---

## 2. Setup in 5 step

### 2.1 Creare un progetto su sentry.io

1. Vai su https://sentry.io/signup → crea account organizzazione (es. `cadenza-conservatorio`).
2. Nuovo progetto → Platform: **Node.js** → Name: `cadenza-backend`.
3. Nuovo progetto → Platform: **React** → Name: `cadenza-frontend`.
4. Annota i due **DSN** che Sentry mostra (formato `https://xxx@o000000.ingest.sentry.io/000000`).

> **Tier free Sentry**: 5.000 errori/mese + 10.000 transazioni/mese — sufficiente per un Conservatorio singolo. Se sfori, considera tracesSampleRate 0.05 invece di 0.1.

### 2.2 Generare il salt per l'anonimizzazione

Il salt rende l'hash dell'`user.id` non reversibile e differente fra ambienti.

```bash
# 32 byte hex casuali — usa lo stesso salt fra backend e frontend dello stesso ambiente
openssl rand -hex 32
```

Salva il risultato come `SENTRY_USER_ID_SALT` (backend) e `VITE_SENTRY_USER_ID_SALT` (frontend). **Non cambiare il salt** dopo il go-live, altrimenti perdi la correlazione storica fra eventi dello stesso utente.

### 2.3 Backend — variabili ambiente

In produzione (`/etc/cadenza.env` o systemd `EnvironmentFile=`):

```bash
# Obbligatorie
SENTRY_DSN=https://xxx@o000000.ingest.sentry.io/000000

# Fortemente consigliate
SENTRY_RELEASE=cadenza-backend@1.0.0     # bump ad ogni deploy
SENTRY_USER_ID_SALT=<output di openssl rand -hex 32>

# Opzionali (default ragionevoli)
SENTRY_TRACES_SAMPLE_RATE=0.1            # 0..1, quota transazioni APM
NODE_ENV=production                      # tag environment in Sentry
```

> Il backend chiama `require('./lib/sentry').init()` come **prima istruzione** in `server.js` (riga 10). Gli init successivi (Express, DB, Sequelize) sono già instrumentati.

### 2.4 Frontend — variabili build-time

In `frontend/.env.production` (o nel CI):

```bash
VITE_SENTRY_DSN=https://xxx@o000000.ingest.sentry.io/000000
VITE_SENTRY_RELEASE=cadenza-frontend@1.0.0
VITE_SENTRY_USER_ID_SALT=<lo stesso salt scelto sopra, ma NON quello del backend>
```

> Le `VITE_*` vengono **embedded a build time**, quindi rimboot del browser non basta: serve `npm run build` per propagare il DSN.

> ⚠ **Non riusare** lo stesso salt frontend/backend: il salt frontend è esposto nel bundle JS pubblico, va trattato come "non segreto". Genera due salt distinti per non leakare quello backend (che invece è privato).

### 2.5 Restart e smoke test

```bash
# Backend
sudo systemctl restart cadenza
sudo journalctl -u cadenza -f | grep -i sentry
# Atteso: niente output esplicito (init silenzioso). Se SENTRY_DSN è errato,
# Sentry lo segnala con WARN nel proprio canale (visibile in console SDK).

# Smoke test backend (login come admin, copia il bearer)
TOKEN="$(curl -s -X POST https://cadenza.example.it/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.it","password":"..."}' | jq -r .accessToken)"

curl -X POST https://cadenza.example.it/api/admin/_sentry/test \
  -H "Authorization: Bearer $TOKEN"
# Atteso: { "ok": true, "eventId": "abc123...", "message": "..." }
# Verifica subito su sentry.io → Issues: deve apparire l'errore "Sentry smoke test (intenzionale)"

# Smoke test frontend: apri devtools console e digita
window.__sentry_test = () => { throw new Error('frontend smoke test'); };
window.__sentry_test();
# AppErrorBoundary cattura, Sentry invia l'evento. Cerca su Issues frontend project.
```

---

## 3. Source maps (raccomandato, non obbligatorio)

Per stack trace leggibili nel frontend, abilita il caricamento dei source maps a build time.

```bash
# In CI/build pipeline
npm install --save-dev @sentry/vite-plugin

# vite.config.ts
import { sentryVitePlugin } from '@sentry/vite-plugin';
export default defineConfig({
  build: { sourcemap: true },
  plugins: [
    react(),
    sentryVitePlugin({
      org: 'cadenza-conservatorio',
      project: 'cadenza-frontend',
      authToken: process.env.SENTRY_AUTH_TOKEN,  // generato su sentry.io
      release: { name: process.env.VITE_SENTRY_RELEASE },
    }),
  ],
});
```

I source map vengono caricati su Sentry, **non** distribuiti pubblicamente. Lo stack trace mostrerà il file `.tsx` originale, non il bundle minificato.

---

## 4. Monitoraggio in produzione

### 4.1 Dashboards consigliate

Su sentry.io → Discover → New Query, salva queste 4 viste:

| Nome                        | Filtro                                                 | Uso                                                      |
| --------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `Backend last 24h`          | `project:cadenza-backend AND event.timestamp:>-24h`    | Spike recenti                                            |
| `Frontend errors per role`  | `project:cadenza-frontend GROUP BY tag:user_role`      | Capire se admin/docente/studente vedono problemi diversi |
| `Slow transactions backend` | `project:cadenza-backend AND transaction.duration:>2s` | Endpoint lenti                                           |
| `Top issues per release`    | `GROUP BY release`                                     | Regressioni post-deploy                                  |

### 4.2 Alert minimi consigliati

| Alert                | Condizione                         | Canale                 |
| -------------------- | ---------------------------------- | ---------------------- |
| Spike errori backend | > 50 eventi/h sostenuti per 30 min | Email admin + Telegram |
| Errore critico       | Issue con `level:fatal`            | Email immediate        |
| Quota mensile a 80%  | Sentry built-in                    | Email                  |

### 4.3 Privacy: cosa fare se un utente esercita art.17 GDPR (right-to-be-forgotten)

L'`user.id` in Sentry è già un **hash SHA-256** — non risalibile all'utente reale. Tuttavia, se Sentry conserva eventi correlati a uno specifico hash:

```bash
# Trova tutti gli eventi dell'utente (avendo l'id originale)
node -e "console.log(require('./backend/lib/sentry').anonymousUserId(USER_ID))"

# Su sentry.io → Issues → cerca user.id:<hash>
# Pulsante "Delete" sull'evento o "Discard" sull'issue.
```

Tempo retention default: **30 giorni** (developer plan), **90 giorni** (team plan). Configurabile in Sentry → Settings → Data Privacy.

---

## 5. Rollback rapido

Se Sentry inizia a segnalare errori critici post-deploy:

```bash
# Disabilita Sentry istantaneamente (no-op senza redeploy)
sudo systemctl stop cadenza
sudo sed -i 's/^SENTRY_DSN=/#SENTRY_DSN=/' /etc/cadenza.env
sudo systemctl start cadenza
```

Il backend è no-op senza `SENTRY_DSN`; nessun errore di runtime, solo telemetria spenta.

Per il frontend bisogna ribuildare **senza** `VITE_SENTRY_DSN` e ridistribuire — più lento (~5 min).

---

## 6. Checklist pre-go-live

- [ ] Account Sentry creato + 2 progetti (backend + frontend)
- [ ] DSN annotati in password manager
- [ ] `SENTRY_USER_ID_SALT` generato e archiviato (NON inviato via mail/chat)
- [ ] `.env` di produzione aggiornato con DSN, RELEASE, SALT
- [ ] `npm run build` frontend con `VITE_SENTRY_*` impostate
- [ ] Backend restartato, log puliti
- [ ] Smoke test admin: `POST /api/admin/_sentry/test` → eventId visibile su sentry.io
- [ ] Smoke test frontend: `throw new Error()` da console → evento visibile
- [ ] Source maps caricati (opzionale ma consigliato per FE)
- [ ] Alert configurati (almeno: spike errori + quota 80%)
- [ ] Dashboard salvata
- [ ] Documentazione interna aggiornata: dove leggere errori, chi è on-call

Tempo totale: **30 min** (account 5' + project 5' + env 10' + smoke 5' + alert 5').

---

## 7. Verifica integrazione (test automatici)

```bash
cd backend
node -e "
const sentry = require('./lib/sentry');
// 1) Init senza DSN → no-op
console.assert(sentry.init() === false);
console.assert(sentry.isInitialized() === false);

// 2) Anonymizzazione deterministica
const a = sentry.anonymousUserId(123);
const b = sentry.anonymousUserId(123);
console.assert(a === b && a.length === 16);

// 3) Scrubbing
const scrubbed = sentry.scrubObject({password:'X', email:'a@b.c', name:'Mario'});
console.assert(scrubbed.password === '[REDACTED]');
console.assert(scrubbed.email === '[PII]');
console.assert(scrubbed.name === 'Mario');

console.log('✓ Tutti i 3 test passano');
"
```

Output atteso: `✓ Tutti i 3 test passano`. Comando già eseguito durante l'audit del 30/4/2026.

---

## 8. Riferimenti

- Backend init: [`backend/lib/sentry.js`](../backend/lib/sentry.js)
- Frontend init: [`frontend/src/lib/sentry.ts`](../frontend/src/lib/sentry.ts)
- Error boundary React: [`frontend/src/components/AppErrorBoundary.tsx`](../frontend/src/components/AppErrorBoundary.tsx)
- Smoke endpoint: [`backend/app.js:285-310`](../backend/app.js)
- Env templates: [`backend/.env.example`](../backend/.env.example), [`frontend/.env.example`](../frontend/.env.example)
- Documentazione Sentry: https://docs.sentry.io/platforms/javascript/guides/express/

---

_Cadenza · Sentry Setup v1.0 · 30 aprile 2026 · Danilo Russo_
