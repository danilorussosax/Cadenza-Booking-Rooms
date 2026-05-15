# 🎵 Cadenza

### La piattaforma italiana per i Conservatori di Musica

**Gestione aule · Strumenti musicali · Eventi · Compliance PA italiana**

> 🇬🇧 [Read this page in English](README.en.md)

---

## Indice

1. [Cos'è Cadenza](#1-cosè-cadenza)
2. [Caratteristiche principali](#2-caratteristiche-principali)
3. [Stack tecnologico](#3-stack-tecnologico)
4. [Struttura del repository](#4-struttura-del-repository)
5. [Quick start](#5-quick-start)
6. [Configurazione e variabili d'ambiente](#6-configurazione-e-variabili-dambiente)
7. [Documentazione](#7-documentazione)
8. [Test](#8-test)
9. [Stato del progetto e roadmap](#9-stato-del-progetto-e-roadmap)
10. [Licenza](#10-licenza)

---

## 1. Cos'è Cadenza

Cadenza è un'applicazione web full-stack per la gestione delle prenotazioni di aule, sale prove, sale concerti e dell'inventario strumenti di un Conservatorio di Musica. Permette a **studenti, docenti e amministratori** di prenotare gli spazi con regole differenziate per ruolo, di gestire i prestiti degli strumenti e di pubblicare concerti ed eventi su un display kiosk pubblico.

L'applicazione è organizzata come **monorepo**:

```
Cadenza/
├── backend/          → API REST in Node.js / Express + Sequelize
├── frontend/         → SPA React + TypeScript + Vite
└── docs/             → Documentazione tecnica e operativa
```

In produzione il backend serve sia gli endpoint `/api/*` sia il bundle React buildato (`frontend/dist/`), agendo da web-server unico dietro nginx.

**Target di mercato**: i 79 conservatori statali italiani + ~50 istituti pareggiati AFAM. Il prodotto è progettato per la PA italiana fin dalle fondamenta (GDPR-Garante, SPID-ready, MEPA-ready), distinguendosi così dai competitor internazionali generalisti.

---

## 2. Caratteristiche principali

### 🏛️ Room booking

- Prenotazione self-service con grid 30 minuti, 7-23
- Regole e quote configurabili per ruolo (durata min/max, anticipo, finestra oraria, quota settimanale)
- **Eccezioni con scope per ruolo + aula** (`block` o `time_window`): override temporanei per ristrutturazioni, sessioni esami, masterclass, con anteprima sovrapposizioni storiche e batch-cancel transazionale
- **Approval workflow** per aule speciali (sala concerti, auditorium)
- **Anti-ghost booking**: check-in tramite QR code stampato in aula, auto-cancellazione con grace period (esonerabile per singola aula con `Room.requireCheckIn=false`)
- **Waitlist** con claim window e auto-promote
- **Dashboard** con toggle "1 giorno · 3 giorni" sul calendario (preferenza persistita per browser, frecce di navigazione coerenti con la modalità)
- Vista settimanale aule × giorni con export PDF A4 landscape per edificio
- iCal export per ogni utente con token (emette RRULE preciso per le serie ricorrenti — Outlook/Google riconoscono la cadenza nativa)
- **Prenotazioni ricorrenti (MRBS-style)**: regole `daily`/`weekly` con `interval`, `byWeekday`, `endDate` ed `excludeDates` (festività). Una sola call crea fino a 52 occorrenze validate individualmente, con opzione `skipConflicts` per ignorare le date in conflitto e creare solo quelle valide. Cancellazione singola occorrenza o serie intera (preserva le occorrenze passate per audit)

### 🎻 Inventario strumenti musicali _(esclusivo)_

- Catalogo completo con famiglie (archi, fiati legni/ottoni, tastiere, percussioni…)
- Modulo prestiti completo: workflow `requested → active → returned`, con auto-overdue
- PDF di consegna e restituzione firmati
- Reminder T-2 giorni e notifiche overdue automatiche
- Regole e quote per famiglia, corso e ruolo
- Import/export CSV idempotente

### 📺 Display kiosk pubblico

- Tre card configurabili: prenotazioni, concerti, avvisi
- Rotazione building / concerti / annunci con timer per-edificio
- Modalità offline-soft via Service Worker (banner "Connessione persa")
- Privacy granulare: opzione per nascondere i nomi sul display per edificio
- **Restrizione per IP** (opzionale): limita la visibilità del kiosk e degli endpoint `/api/public/*` ai soli IP dell'istituto via nginx — vedi [`docs/KIOSK_IP_ALLOWLIST.md`](docs/KIOSK_IP_ALLOWLIST.md)

### 📢 Bacheca avvisi e comunicazione

- Avvisi con audience filter: tutti / per ruolo / per corso / per edificio
- 11 template email editabili (booking, loan, waitlist, approval, announcement)
- Mail server settings con cifratura AES-256-GCM su DB

### ✉️ Sistema email robusto _(outbox pattern)_

- **Coda persistente** `mail_outbox`: ogni invio passa da una tabella prima dello SMTP — niente email perse su flap del provider
- **Worker async** con backoff esponenziale (60s → 16min) + `dead` dopo 5 tentativi, gestito da `mailOutboxScheduler` (tick 15s, batch 20)
- **Idempotency key naturale** (`booking:42:confirmation`) → doppio click admin = no-op
- **Try-sync-then-enqueue** per email di sicurezza (codici 2FA): tentativo sincrono per latenza utente, fallback async su errore
- **Connection pool SMTP** condiviso tra worker e invii sincroni (`pool: true, maxConnections: 3`)
- **Multi-istanza ready**: `FOR UPDATE SKIP LOCKED` su Postgres
- **Throttle per destinatario** (configurabile da UI, default disabilitato): max N email/h allo stesso indirizzo, anti-flapping. Le email security bypassano sempre
- **Hard-bounce detection** da SMTP 5xx (550/551/553/511/521): marca l'utente come bounced e salta future enqueueMail finché un admin non riattiva l'indirizzo
- **Pagina admin "Coda email"** con filtri per stato, ricerca, retry manuale per le `dead`, health endpoint con `transporter.verify()`
- **Cleanup automatico** delle righe `sent` oltre 30gg (le `dead` restano per audit)

### 🤖 Bot messaging

- 4 adapter pluggable: **Telegram** (production-ready), WhatsApp Cloud API, Signal `signal-cli`, Email IMAP (scaffold)
- Comandi: `/aule` (lista aule), `/agenda [data]` (snapshot giorno), `/book` (**wizard a 5 step**: sede → aula → quando → tipo → conferma — step univoci saltati), `/list`, `/cancel`, `/check`, `/help`
- Binding via OTP 6 caratteri, riusa `bookingValidator` (no bypass di regole/quote)
- Webhook con verifica HMAC, rate-limit 30/min + 200/giorno
- **Setup Telegram in 1 click**: dato il `botToken` di @BotFather, Cadenza genera il webhook secret, registra il webhook su Telegram, pubblica la lista comandi e le descrizioni. Niente curl, niente `openssl rand`

### 📊 Analytics & reporting

- Heatmap occupazione settimanale 7×24
- Top 10 aule e top utenti per ore
- No-show rate con trend 8 settimane
- Export CSV (BOM UTF-8) e report PDF mensili
- Audit log append-only con retention 24 mesi

### 🔒 Sicurezza & compliance

- **2FA via codice email** (OTP 6 cifre, scadenza 10 min, bcrypt cost 8, 10 recovery code)
- **JWT** 2h + `tokenVersion` (logout effettivo) + bcrypt cost 12
- **CSP rigorosa** (`default-src 'self'`), HSTS preload, COOP/CORP, Permissions-Policy — scanner pubblici: **securityheaders.com A+**, **Mozilla Observatory A+**, **SSL Labs A**, **HSTS Preload eligible**
- **Sentry** v10 con scrubbing PII ricorsivo + utente anonimizzato SHA-256
- **Pacchetto GDPR-PA italiana** (Garante 06/2021): cookie banner, `UserConsent` append-only, export art. 20, delete art. 17, re-consent al cambio versione
- **EXCLUDE constraint** PostgreSQL (`bookings_no_overlap`) come rete di sicurezza anti-overlap a livello DB
- **`paranoid: true`** (soft-delete) su 10 modelli sensibili

### 🔐 Autenticazione

- Email + password locale
- **OAuth Google** e **OAuth Microsoft 365 / Entra ID** (config UI con secret cifrati)
- **Password reset self-service via email**: link signed (SHA-256 hex), valido 1h, monouso. Anti-enumeration (200 generico anche su email inesistente), rate-limit doppio (3/30min per IP + 3/h per utente). Il reset invalida tutte le sessioni JWT esistenti (`tokenVersion++`) e sblocca eventuale account lockout
- Profilo completo con `matricola` e `courseId` per studenti
- Roadmap: SPID/CIE (Sprint 6), LDAP/AD (Sprint enterprise)

### 💾 Business continuity

- **Mirror Excel periodico** delle prenotazioni su disco (default `/var/cadenza/sync/`), una tab per ogni edificio con celle colorate per tipo (`studio_individuale` verde, `lezione` azzurro, `prova` ambra, `concerto` rosa, `altro` viola) e merge orizzontale dei blocchi multi-slot — replica fedele del Display kiosk
- Sync della cartella su cloud personale (OneDrive / Dropbox / pCloud / iCloud / Google Drive) via `rclone` + cron OS — indipendente dal backend: se Cadenza è giù, l'ultima copia del foglio resta nel cloud, la portineria la apre dal telefono. Direzione volutamente unidirezionale (Cadenza → file): le modifiche al foglio NON tornano nel DB, niente conflict resolution oscura al ripristino. Setup completo in [docs/EXCEL_SYNC.md](docs/EXCEL_SYNC.md)
- Backup automatico DB + uploads (snapshot tar.gz con retention giornaliera/settimanale/mensile)

### 🌍 Internazionalizzazione

UI completamente tradotta in **italiano** (default), **inglese**, **spagnolo**, **tedesco** e **francese**, con `i18next` + `dayjs` locale. Persistenza preferenza in `localStorage`. Errori del backend mappati via `error.code` stabili (es. `BOOKING_CONFLICT`, `EMAIL_ALREADY_REGISTERED`).

### ♿ Accessibilità WCAG 2 AA

- Skip link "Vai al contenuto" e landmark `<main>` esplicito su tutte le pagine
- Messaggi di errore form collegati via `aria-describedby` + `role="alert"` (form admin completi)
- Rispetto di `prefers-reduced-motion` (animazioni disabilitate quando l'utente lo richiede a livello OS)
- Fallback testuali per i grafici della dashboard (heatmap, top, trend no-show)
- Test automatici: **axe-core** in unit (`vitest-axe`) e in E2E (`@axe-core/playwright`)

### 📱 Mobile UX

- Viewport in unità `dvh` (no scroll bug iOS Safari con address bar)
- `inputmode="numeric"` su matricola e campi numerici
- Conferma `beforeunload` su form con modifiche non salvate
- **Banner offline globale** (Service Worker) e **bottom-nav** mobile per le aree principali
- Dialog responsive: full-screen su `<sm`, bottom-sheet con drag handle su mobile
- Tabelle admin → **card-stack** su `<sm` (no overflow orizzontale)

### 📥 Integrazioni gestionali

- **Import Isidata** (Liv A — manuale CSV/XLSX): allineamento anagrafica utenti via export del registro elettronico più diffuso nei conservatori italiani. Diff engine con preview + apply transazionale.
- **Mapping UI guidata** (v1.5.1): dropdown per target (`externalId`, `email`, `role`, `courseCode`, `contractType`, ...) — niente più JSON manuale. Persistenza opzionale per browser.
- **Soglie di sicurezza pre-apply** (v1.5.1): banner ambra ≥ 10 % disattivazioni, banner rosso critical ≥ 20 % con seconda checkbox di conferma. Protegge dagli import distrofici (file Excel sbagliato).
- **Import `contractType` docenti + lookup `courseCode → Course`** (v1.5.1): la colonna "Qualifica" Isidata mappa su `User.contractType` (titolare / contratto_orario / supplente) e imposta la soglia Monte Ore default; gli studenti vengono assegnati al corso Cadenza tramite codice.
- **Diff "ultimi 2 run"** (v1.5.1): icona ⟷ nella cronologia import che apre un dialog con 4 sezioni colorate — 🟢 nuovi rientri / 🔴 nuove disattivazioni / 🟡 cambi ripetuti (potenziali typo) / 🟣 utenti rientrati. Per audit retrospettivi.
- Roadmap: sync bidirezionale Esse3/Isidata, export ANIS/MIUR.

### 🛡️ Admin UX

- **Macro pagina "Gestione prenotazioni"** (v1.5.1): una sola voce di sidebar (`/admin/bookings-management`) con 3 tab a card grandi — **Regole** (⚖️ ambra) · **Tipi prenotazione** (🏷️ verde) · **Approvazioni** (📋 blu, badge counter `N`). I vecchi URL `/admin/rules`, `/admin/booking-types`, `/admin/approvals` restano funzionanti come redirect.
- Larghezza coerente con le altre pagine admin (`max-w-6xl`), badge in tempo reale sulle richieste in attesa.
- **Dashboard "Stato sistema"** (`/admin/ops`, v1.7.0): 5 widget at-a-glance aggiornati ogni 10s — VPS (CPU/RAM/disco con semafori 70/90%), database (connessioni, dimensione, top tabelle), coda email (pending con età del più vecchio), backup (ultimo + età), scheduler interni (stato e ultimo tick di 5 worker). Endpoint `GET /api/admin/ops/snapshot` admin-only con cache server-side 5s.

---

## 3. Stack tecnologico

### Backend

| Tecnologia        | Ruolo                                              |
| ----------------- | -------------------------------------------------- |
| Node.js ≥ 18      | Runtime                                            |
| Express 5         | Framework HTTP                                     |
| Sequelize 6       | ORM (PostgreSQL · supporta SQLite e MySQL)         |
| Passport          | Strategie auth (local · Google OAuth2 · Microsoft) |
| bcryptjs          | Hash password                                      |
| jsonwebtoken      | JWT firmati                                        |
| express-validator | Validazione input                                  |
| dayjs             | Gestione date / fusi orari                         |
| pdfkit            | Generazione PDF (loan, report)                     |
| sharp             | Resize immagini (logo, foto strumenti)             |
| qrcode            | Generazione QR check-in                            |
| pino              | Logger strutturato con scrubbing PII               |

### Frontend

| Tecnologia                | Ruolo                                        |
| ------------------------- | -------------------------------------------- |
| React 19 + TypeScript 6   | UI                                           |
| Vite 8                    | Build tool / dev server con HMR              |
| Tailwind CSS 4            | Sistema di design utility-first              |
| shadcn/ui (Radix UI)      | Componenti accessibili                       |
| Framer Motion             | Animazioni di transizione                    |
| Lucide React              | Icone vettoriali                             |
| TanStack Query            | Cache e sincronizzazione dati server         |
| React Router v6           | Routing client-side                          |
| React Hook Form + Zod     | Form e validazione                           |
| Sonner                    | Notifiche toast                              |
| i18next + react-i18next   | Internazionalizzazione (it · en · es)        |
| vite-plugin-pwa + Workbox | Service Worker, precache, offline-soft kiosk |

### Infrastruttura

| Componente    | Tecnologia                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database      | PostgreSQL 16 (con `EXCLUDE` constraint anti-overlap)                                                                                                                       |
| Reverse proxy | nginx + Let's Encrypt (cert. via certbot)                                                                                                                                   |
| Deploy        | VPS Ubuntu 24.04 — script `install.sh` idempotente                                                                                                                          |
| Operations    | `pg-tune-4gb.sh` (Postgres tuning idempotente per VPS piccole, `ALTER SYSTEM` reversibile) · `KIOSK_IP_ALLOWLIST.md` (restrizione nginx del kiosk) · dashboard `/admin/ops` |
| Monitoring    | Sentry v10 (opt-in) + dashboard ops in-app                                                                                                                                  |
| Testing       | Vitest 1.386 test backend + 177 component/lib + Playwright 5 spec E2E                                                                                                       |
| CI/CD         | GitHub Actions (backend + frontend + E2E gate)                                                                                                                              |

---

## 4. Struttura del repository

```
Cadenza/
├── backend/
│   ├── server.js                      → bootstrap Express + sync DB + seed
│   ├── config/database.js             → istanza Sequelize
│   ├── models/                        → un file per modello + index.js (relazioni)
│   ├── routes/                        → un file per area (auth, users, bookings, …)
│   ├── middleware/auth.js             → authenticate, requireRole, enforceAdminTwoFa
│   ├── services/
│   │   ├── bookingValidator.js        → regole pre-insert/update
│   │   ├── twoFa.js                   → 2FA email OTP
│   │   ├── messaging/                 → bot adapter pluggable + intent
│   │   ├── retentionScheduler.js      → cleanup audit 24 mesi
│   │   ├── reminderScheduler.js       → reminder T-2gg, ghost cancel, overdue
│   │   ├── backupScheduler.js         → backup giornaliero in-process
│   │   └── integrations/              → Isidata import + base provider
│   ├── lib/
│   │   ├── crypto.js                  → AES-256-GCM per secret cifrati a riposo
│   │   ├── preSyncMigrations.js       → bookings_no_overlap su Postgres
│   │   └── dbErrors.js                → mapper errori Sequelize → HTTP
│   ├── seeders/initial.js             → admin di default + livelli + regole
│   └── tests/                         → vitest integration tests
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx                   → Provider tree (Theme · QueryClient · Router · Auth)
│   │   ├── App.tsx                    → Definizione delle route
│   │   ├── pages/                     → auth, admin, Display, Profile, Booking, …
│   │   ├── components/
│   │   │   ├── ui/                    → primitives shadcn
│   │   │   ├── layout/                → AppLayout · AuthLayout
│   │   │   ├── bookings/              → BookingFormDialog, MultiRoomTimetable, …
│   │   │   └── admin/                 → form dialogs CRUD
│   │   ├── contexts/                  → AuthContext · ThemeContext
│   │   ├── api/                       → un modulo per area
│   │   ├── lib/                       → api wrapper, date helper, utils
│   │   ├── i18n/locales/              → it.json · en.json · es.json
│   │   └── types/index.ts             → interfacce TypeScript condivise
│   └── e2e/                           → Playwright spec
│
├── docs/                              → documentazione tecnica (vedi § 7)
├── scripts/
│   ├── install.sh                     → installer VPS Ubuntu idempotente
│   └── pg-tune-4gb.sh                 → tuning Postgres reversibile per VPS 4 GB
├── develop.md                         → roadmap dev (piano eventi + backlog ops)
└── README.md                          → questo file
```

---

## 5. Quick start

### Prerequisiti

- Node.js ≥ 18 (consigliato 20)
- PostgreSQL 16 (consigliato in produzione) **oppure** SQLite (default in sviluppo, zero-config)
- npm ≥ 9

### Sviluppo

#### Setup automatico macOS (consigliato)

Lo script `scripts/setup-macos.sh` installa o aggiorna **tutto** lo stack in una volta sola: Xcode CLT, Node ≥ 20, PostgreSQL 16, git, dipendenze npm dei 3 workspace, `backend/.env` con secret generati, utente + database Postgres, schema iniziale e seeder admin.

```bash
# Default: Homebrew (mainstream)
bash scripts/setup-macos.sh                # interattivo
bash scripts/setup-macos.sh --yes          # senza conferme
bash scripts/setup-macos.sh --dry-run      # mostra cosa farebbe
bash scripts/setup-macos.sh --reset-db     # DROP + ricrea il DB (distruttivo)

# ⭐ Senza Homebrew (curl + fnm + Postgres.app)
bash scripts/setup-macos.sh --no-brew      # niente brew, niente sudo (eccetto Xcode CLT)
```

Idempotente in entrambe le modalità: rilanciandolo aggiorna i pacchetti già presenti (`brew upgrade` o `fnm install`) e preserva l'`.env` esistente (con backup automatico). Compatibile Apple Silicon e Intel.

**Quando usare `--no-brew`**: se non vuoi/non puoi installare Homebrew (policy aziendale, no sudo, preferenza personale per tool user-local). Userà:

- **[fnm](https://github.com/Schniz/fnm)** per Node — gestione versioni multiple senza pollution di sistema
- **[Postgres.app](https://postgresapp.com)** per PostgreSQL — `.app` nativo Mac con menu-bar
- **git** già fornito da Xcode CLT

#### Setup manuale (qualsiasi OS)

Setup iniziale (una volta sola, dalla root del repo):

```bash
npm install                       # devtool root: husky, lint-staged, commitlint, prettier
npm --prefix backend install
npm --prefix frontend install
```

Avvio dev combinato (backend nodemon su :3000 + frontend vite su :5173):

```bash
npm run dev                       # entrambi in parallelo nello stesso terminale
# oppure, su due terminali separati:
npm run dev:backend
npm run dev:frontend
```

Apri `http://localhost:5173`. Credenziali admin di default seedate:

```
email:    admin@conservatorio.it
password: Admin123!
```

> Cambia subito la password al primo login. La 2FA admin è obbligatoria con grace period 7 giorni.

### Produzione

```bash
npm run build                     # build frontend → frontend/dist
npm run start                     # avvia backend (serve API + dist statico)
```

Per un deploy completo su VPS Ubuntu 24.04 (con nginx + Let's Encrypt + scheduler) usare lo script `scripts/install.sh` (idempotente, supporta modalità domain HTTPS / IP-only / IP self-signed). Vedi [`docs/install.md`](docs/install.md) per la guida passo-passo (esempio Hetzner incluso).

### Comandi utili (dalla root)

| Comando                                                  | Effetto                                                 |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                                            | Backend + frontend in parallelo (Ctrl+C ferma entrambi) |
| `npm run dev:backend`                                    | Solo backend con nodemon                                |
| `npm run dev:frontend`                                   | Solo frontend con vite                                  |
| `npm run build`                                          | Build frontend (`frontend/dist`)                        |
| `npm run start`                                          | Backend produzione (serve API + dist)                   |
| `npm run test`                                           | Vitest backend + frontend                               |
| `npm run lint`                                           | ESLint frontend                                         |
| `npm run format`                                         | Prettier su tutto il monorepo                           |
| `npm --prefix backend run seed`                          | Re-seed admin + livelli + regole                        |
| `DB_SYNC_MODE=alter npm --prefix backend run db:migrate` | Applica modifiche allo schema (sviluppo)                |

---

## 6. Configurazione e variabili d'ambiente

Le variabili principali (file `.env` nel `backend/`):

### Database

```env
DB_DIALECT=postgres                # o sqlite
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cadenza
DB_USER=cadenza
DB_PASSWORD=...
DB_SSL=false
```

### Auth & Security

```env
JWT_SECRET=...                     # stringa lunga random
ENCRYPTION_KEY=...                 # 32 byte hex, per cifrare secret messaging/oauth
TWO_FA_TTL_MIN=10                  # scadenza codice 2FA email
TWO_FA_MAX_ATTEMPTS=5
TWO_FA_GRACE_DAYS=7                # grace period admin per attivare 2FA
TWO_FA_ISSUER="Conservatorio · Cadenza"
```

### SMTP (richiesto per 2FA email)

```env
SMTP_HOST=smtp.tuoprovider.it
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@conservatorio.it
SMTP_PASS=...
SMTP_FROM="Conservatorio · Cadenza <noreply@conservatorio.it>"
```

### Check-in & ghost booking

```env
CHECKIN_EARLY_MINUTES=5            # quanto prima si può fare check-in
GHOST_GRACE_MINUTES=15             # tolleranza prima dell'auto-cancel
FRONTEND_URL=https://cadenza.example.it
```

### Backup automatico

```env
BACKUP_AUTO_ENABLED=true           # scheduler interno
BACKUP_TICK_HOUR=2                 # ora locale del backup giornaliero
BACKUP_TICK_MINUTE=30
AUTO_RESTART_ENABLED=false         # se true, abilita restart endpoint
```

> **Sub-set minimo per partire**: `JWT_SECRET`, `ENCRYPTION_KEY`, e configurazione SMTP. Tutto il resto ha default sensati.

---

## 7. Documentazione

La cartella `docs/` contiene la documentazione tecnica e operativa completa:

| Documento                                                 | Contenuto                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md)                 | Architettura del sistema (IT/EN), modelli dati, routing, i18n, check-in, prestiti    |
| [`SECURITY.md`](docs/SECURITY.md)                         | 2FA email OTP — flusso, enforcement admin, recovery, riferimenti normativi           |
| [`SSO.md`](docs/SSO.md)                                   | Setup SSO Microsoft 365 / Entra ID e Google Workspace passo-passo                    |
| [`BOT-MESSAGING.md`](docs/BOT-MESSAGING.md)               | Bot Telegram / WhatsApp / Signal / Email — setup, comandi, costi, sicurezza          |
| [`INTEGRATIONS-ISIDATA.md`](docs/INTEGRATIONS-ISIDATA.md) | Import manuale anagrafiche da Isidata (CSV/XLSX) con preview + diff transazionale    |
| [`BACKUP.md`](docs/BACKUP.md)                             | Backup automatico, restore via UI admin, upload remoto (S3, Hetzner, rclone, GPG)    |
| [`db-constraints.md`](docs/db-constraints.md)             | EXCLUDE constraint anti-overlap su PostgreSQL — debug e procedura emergenza          |
| [`DEPLOY.md`](docs/DEPLOY.md)                             | Flusso `./deploy.sh` (8 step), setup SSH alias, verifiche PWA, troubleshooting nginx |
| [`TESTING.md`](docs/TESTING.md)                           | Strategia di test, copertura, esecuzione locale e CI                                 |
| [`install.md`](docs/install.md)                           | Guida installazione VPS (esempio Hetzner) con `install.sh`                           |
| [`KIOSK_IP_ALLOWLIST.md`](docs/KIOSK_IP_ALLOWLIST.md)     | Restrizione `/display` + `/api/public/*` ai soli IP dell'istituto via nginx          |

### Materiale strategico (riservato)

I documenti commerciali e di posizionamento sono mantenuti **fuori dal repo pubblico** (gestione pricing, target, dati di mercato sensibili). Disponibili su richiesta a Direttori / Responsabili IT.

| Documento                             | Contenuto                                                                                                                              | Stato                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`develop.md`](develop.md)            | Roadmap di sviluppo: piano gestione eventi (5 fasi · ~11 gg vs ASIMUT) + **backlog post-1.6.0** (7 voci security/ops/perf, ~12 gg)     | ✅ Versionato                            |
| `Proposta.md`                         | Proposta tecnico-commerciale + benchmark competitivo (ASIMUT, EasyStaff/EasyRoom Zucchetti) + TCO 10 anni + piano migrazione · v2.2 IT | 📄 Fuori repo                            |
| `Cadenza_Presentazione_Direzione.pdf` | Deck di 18 slide rivolto a Direttori / Presidenti / DSGA — feature parity, costi, compliance PA                                        | 📄 Fuori repo                            |
| `develop-enterprise.md`               | Roadmap enterprise (LDAP/AD, SAML 2.0 IDEM-GARR, sync Esse3, RFID badge)                                                               | 🚧 In lavorazione, non ancora rilasciato |

---

## 8. Test

```bash
# Backend integration (Vitest + SQLite in-memory)
cd backend
npm test

# Singola suite
npx vitest run tests/integration/auth.test.js

# Test EXCLUDE constraint (richiede Postgres dedicato)
DB_DIALECT=postgres DB_HOST=localhost DB_NAME=cadenza_test \
DB_USER=cadenza DB_PASSWORD=... DB_SSL=false \
npx vitest run tests/integration/excludeConstraint.test.js

# Component test frontend (Vitest + Testing Library)
cd frontend
npm test

# E2E Playwright
cd frontend
npm run test:e2e
```

**Copertura attuale**: **1.386** test backend (70 file integration + unit) + **177** component test frontend (19 file, 10 dei quali a11y `vitest-axe`) + **5 spec** E2E Playwright (login-booking, waitlist-claim, a11y, instrument-loan, admin-approve) — **1.568 test totali**. Soglie bloccanti: backend stmts ≥72 / lines ≥73 / funcs ≥78 / branches ≥60, frontend stmts ≥60 / lines ≥60 / funcs ≥50 / branches ≥50 — tutti gli 8 assi sopra 60 % di copertura misurata aggregata. CI GitHub Actions a 4 job paralleli (backend / postgres / frontend / E2E).

**Suite di stabilità (v1.5.1)** — vanno oltre lo unit/integration classico, ognuna documentata in [`docs/TESTING.md`](docs/TESTING.md):

- **Backup roundtrip** (`backend/tests/integration/backupRoundtrip.test.js`): `performBackup()` → estrae tar.gz → riapre lo snapshot con connessione separata → verifica conteggi e join nominativi vs DB vivo.
- **Time-travel calendario** (`backend/tests/unit/timeTravel.test.js`): 20 test su rollover AA, finestra submission Monte Ore, Computus pasquale 2024-2033, override admin (fake timers).
- **Playwright E2E smoke** (`frontend/tests/e2e/smoke.spec.ts`): golden path login UI → booking via API → lista → logout, su backend SQLite in-memory che serve anche la SPA. Comandi: `npm run e2e` / `npm run e2e:ui` / `npm run e2e:headed`.
- **Soak test harness** (`loadtest/soak.sh` + `loadtest/SOAK.md`): k6 5 RPS costanti per N ore + sampler Node (memoria pm2, FD count, latenza `/api/ready`) + tail logs. Report Markdown con grafici ASCII unicode e verdict leak automatico. `brew install k6` richiesto. `npm run soak` (default 4h). Lancia su **staging** la notte prima di un rollout maggiore — non in CI.

---

## 9. Stato del progetto e roadmap

### ✅ Production-ready

Le seguenti aree sono complete e in produzione:

- Core booking + waitlist + approval workflow + check-in QR anti-ghost
- Modulo prestiti strumenti completo (5 stati, scheduler, PDF, regole/quote)
- Bacheca avvisi audience-based + 11 mail template editabili
- Display kiosk (3 card configurabili, offline-soft, audience filter, **restrizione IP nginx opzionale**)
- 2FA email + Activity Hub admin
- PWA installabile (Service Worker, A2HS, offline kiosk)
- Pacchetto GDPR-PA italiana (Garante 06/2021)
- Bot messaging Telegram (gli altri 3 canali in scaffold completo)
- Vista settimanale + export PDF A4 landscape
- Bulk operations admin
- Analytics dashboard (heatmap, top, no-show, export)
- Import Isidata Liv A (manuale CSV/XLSX)
- i18n completa IT/EN/ES/DE/FR per le aree user-facing principali
- **Accessibilità WCAG 2 AA** (skip link, landmark, ARIA su form, reduced-motion, fallback testuali grafici, axe-core in unit + E2E)
- **Mobile UX** (viewport `dvh`, bottom-nav, Dialog bottom-sheet su `<sm`, tabelle admin card-stack, offline banner globale)
- **Sistema email robusto** (outbox pattern + retry, throttle per destinatario, hard-bounce detection, pagina admin "Coda email" + health, cleanup automatico)
- **Dashboard ops `/admin/ops`** (v1.7.0): diagnostica at-a-glance di VPS · Postgres · MailOutbox · Backup · Scheduler con polling 10s e cache server 5s
- **Toolkit hardening operativo** (v1.7.0): script `pg-tune-4gb.sh` idempotente per Postgres + guida nginx IP allowlist per il kiosk

### 🚧 Sprint correnti

- **Bot Telegram MVP** completo, scaffolding WhatsApp Cloud / Signal / Email
- Push notifications Web Push API
- Embed iframe per concerti pubblici
- **Backlog post-1.6.0** (security/ops/perf): 7 voci consolidate in [`develop.md`](develop.md) §2 — device token per kiosk mobili, PIN ruotabile via mail, monitor esterno con alert, PgBouncer + PM2 cluster mode, slow query digest, QR code dinamico sul display

### 🔵 Roadmap PA italiana

- **SPID / CIE** login (registrazione AgID + integrazione, ~3-4 sett dev + 2-3 mesi processo)
- **PEC** integration (comunicazioni ufficiali)
- **Conservazione sostitutiva** PDF con firma digitale + marca temporale RFC 3161
- Export **ANIS / MIUR** (adempimento AFAM)
- Sync bidirezionale **Esse3** / Isidata Liv B/C

### 🔵 Roadmap enterprise

- **LDAP / Active Directory** authentication
- **SAML 2.0** federation (IDEM-GARR)
- Integrazione **RFID badge** (per i conservatori che dispongono di lettori sulle porte)
- Task management eventi (gap vs ASIMUT): piano architetturale completo in [`develop.md`](develop.md) (5 fasi · ~11 gg dev · MVP demo-ready dopo Fase 1)

Dettaglio completo in [`develop.md`](develop.md) (versionato) e `develop-enterprise.md` (in lavorazione, fuori repo).

---

## 10. Licenza

**Cadenza è software proprietario closed-source. Copyright © 2026 Danilo Russo. Tutti i diritti riservati.**

Il codice sorgente, la documentazione, gli asset e i materiali allegati sono proprietà esclusiva dell'Autore e sono protetti dalle leggi italiane e internazionali sul diritto d'autore (L. 633/1941 art. 171-ter e 174-bis, Direttiva 2001/29/CE).

**Vietato senza accordo scritto preventivo dell'Autore**:

- Clonare, forkare, mirrorare o ridistribuire il codice (anche modificato), su qualsiasi piattaforma
- Eseguire il software in produzione, staging o demo al di fuori dei termini di una licenza attiva
- Estrarre il codice/documentazione per addestrare o valutare modelli di machine learning
- Rimuovere o alterare le note di copyright

Cadenza è distribuita con due modelli commerciali:

- **SaaS hosted** — piani Starter / Professional / Enterprise PA, licenza commerciale
- **Self-host** — sorgente + aggiornamenti + documentazione, licenza on-premise per istituto

Per ottenere una licenza: scrivi a `danilorussosax@gmail.com` con oggetto "Cadenza — Richiesta licenza".

Testo integrale della licenza nel file [`LICENSE`](LICENSE) alla root del repository. Pricing dettagliato, piani commerciali e benchmark competitivo in `Proposta.md` v2.2 e `Cadenza_Presentazione_Direzione.pdf` (deck 18 slide) — mantenuti fuori dal repository e disponibili su richiesta.

---

<div align="center">

**Cadenza · La musica merita il software migliore**

_© 2026 Danilo Russo · Documento generato dalla sintesi della documentazione di progetto_

</div>
