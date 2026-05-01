# 🎵 Cadenza

### La piattaforma italiana per i Conservatori di Musica

**Gestione aule · Strumenti musicali · Eventi · Compliance PA italiana**

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
- **Approval workflow** per aule speciali (sala concerti, auditorium)
- **Anti-ghost booking**: check-in tramite QR code stampato in aula, auto-cancellazione con grace period
- **Waitlist** con claim window e auto-promote
- Vista settimanale aule × giorni con export PDF A4 landscape per edificio
- iCal export per ogni utente con token

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

### 📢 Bacheca avvisi e comunicazione

- Avvisi con audience filter: tutti / per ruolo / per corso / per edificio
- 11 template email editabili (booking, loan, waitlist, approval, announcement)
- Mail server settings con cifratura AES-256-GCM su DB

### 🤖 Bot messaging

- 4 adapter pluggable: **Telegram** (production-ready), WhatsApp Cloud API, Signal `signal-cli`, Email IMAP (scaffold)
- Comandi: `/help`, `/book`, `/list`, `/cancel`, `/check`, wizard 3-step
- Binding via OTP 6 caratteri, riusa `bookingValidator` (no bypass di regole/quote)
- Webhook con verifica HMAC, rate-limit 30/min + 200/giorno

### 📊 Analytics & reporting

- Heatmap occupazione settimanale 7×24
- Top 10 aule e top utenti per ore
- No-show rate con trend 8 settimane
- Export CSV (BOM UTF-8) e report PDF mensili
- Audit log append-only con retention 24 mesi

### 🔒 Sicurezza & compliance

- **2FA via codice email** (OTP 6 cifre, scadenza 10 min, bcrypt cost 8, 10 recovery code)
- **JWT** 2h + `tokenVersion` (logout effettivo) + bcrypt cost 12
- **CSP rigorosa** (`default-src 'self'`), HSTS preload, COOP/CORP, Permissions-Policy
- **Sentry** v10 con scrubbing PII ricorsivo + utente anonimizzato SHA-256
- **Pacchetto GDPR-PA italiana** (Garante 06/2021): cookie banner, `UserConsent` append-only, export art. 20, delete art. 17, re-consent al cambio versione
- **EXCLUDE constraint** PostgreSQL (`bookings_no_overlap`) come rete di sicurezza anti-overlap a livello DB
- **`paranoid: true`** (soft-delete) su 10 modelli sensibili

### 🔐 Autenticazione

- Email + password locale
- **OAuth Google** e **OAuth Microsoft 365 / Entra ID** (config UI con secret cifrati)
- Profilo completo con `matricola` e `courseId` per studenti
- Roadmap: SPID/CIE (Sprint 6), LDAP/AD (Sprint enterprise)

### 🌍 Internazionalizzazione

UI completamente tradotta in **italiano** (default), **inglese** e **spagnolo**, con `i18next` + `dayjs` locale. Persistenza preferenza in `localStorage`. Errori del backend mappati via `error.code` stabili (es. `BOOKING_CONFLICT`, `EMAIL_ALREADY_REGISTERED`).

### 📥 Integrazioni gestionali

- **Import Isidata** (Liv A — manuale CSV/XLSX): allineamento anagrafica utenti via export del registro elettronico più diffuso nei conservatori italiani. Diff engine con preview + apply transazionale.
- Roadmap: sync bidirezionale Esse3/Isidata, export ANIS/MIUR.

---

## 3. Stack tecnologico

### Backend

| Tecnologia        | Ruolo                                              |
| ----------------- | -------------------------------------------------- |
| Node.js ≥ 18      | Runtime                                            |
| Express 4         | Framework HTTP                                     |
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
| React 18 + TypeScript     | UI                                           |
| Vite                      | Build tool / dev server con HMR              |
| Tailwind CSS 3            | Sistema di design utility-first              |
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

| Componente    | Tecnologia                                                    |
| ------------- | ------------------------------------------------------------- |
| Database      | PostgreSQL 16 (con `EXCLUDE` constraint anti-overlap)         |
| Reverse proxy | nginx + Let's Encrypt (cert. via certbot)                     |
| Deploy        | VPS Ubuntu 24.04 — script `install.sh` idempotente            |
| Monitoring    | Sentry v10 (opt-in)                                           |
| Testing       | Vitest 77 test backend + Playwright 4 E2E + 10 component test |
| CI/CD         | GitHub Actions (backend + frontend + E2E gate)                |

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
├── scripts/install.sh                 → installer VPS Ubuntu idempotente
└── README.md                          → questo file
```

---

## 5. Quick start

### Prerequisiti

- Node.js ≥ 18 (consigliato 20)
- PostgreSQL 16 (consigliato in produzione) **oppure** SQLite (default in sviluppo, zero-config)
- npm ≥ 9

### Sviluppo

```bash
# Backend (porta 3000)
cd backend
npm install
npm run dev

# Frontend (porta 5173, /api proxied to :3000)
cd frontend
npm install
npm run dev
```

Apri `http://localhost:5173`. Credenziali admin di default seedate:

```
email:    admin@conservatorio.it
password: Admin123!
```

> Cambia subito la password al primo login. La 2FA admin è obbligatoria con grace period 7 giorni.

### Produzione

```bash
# Build frontend
cd frontend && npm run build           # output in frontend/dist

# Avvia backend (serve API + dist)
cd backend && npm start
```

Per un deploy completo su VPS Ubuntu 24.04 (con nginx + Let's Encrypt + scheduler) usare lo script `scripts/install.sh` (idempotente, supporta modalità domain HTTPS / IP-only / IP self-signed). Vedi [`docs/install.md`](docs/install.md) per la guida passo-passo (esempio Hetzner incluso).

### Comandi utili

| Comando                                 | Effetto                                  |
| --------------------------------------- | ---------------------------------------- |
| `npm run dev` (backend)                 | Avvia con nodemon                        |
| `DB_SYNC_MODE=alter npm run db:migrate` | Applica modifiche allo schema (sviluppo) |
| `npm run seed` (backend)                | Re-seed admin + livelli + regole         |
| `npm test` (backend)                    | Vitest backend (SQLite in-memory)        |
| `npm run test:e2e` (frontend)           | Playwright E2E                           |

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

| Documento                                                 | Contenuto                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md)                 | Architettura del sistema (IT/EN), modelli dati, routing, i18n, check-in, prestiti |
| [`SECURITY.md`](docs/SECURITY.md)                         | 2FA email OTP — flusso, enforcement admin, recovery, riferimenti normativi        |
| [`SSO.md`](docs/SSO.md)                                   | Setup SSO Microsoft 365 / Entra ID e Google Workspace passo-passo                 |
| [`BOT-MESSAGING.md`](docs/BOT-MESSAGING.md)               | Bot Telegram / WhatsApp / Signal / Email — setup, comandi, costi, sicurezza       |
| [`INTEGRATIONS-ISIDATA.md`](docs/INTEGRATIONS-ISIDATA.md) | Import manuale anagrafiche da Isidata (CSV/XLSX) con preview + diff transazionale |
| [`BACKUP.md`](docs/BACKUP.md)                             | Backup automatico, restore via UI admin, upload remoto (S3, Hetzner, rclone, GPG) |
| [`db-constraints.md`](docs/db-constraints.md)             | EXCLUDE constraint anti-overlap su PostgreSQL — debug e procedura emergenza       |
| [`DEPLOY.md`](docs/DEPLOY.md)                             | Procedure di deploy in produzione                                                 |
| [`TESTING.md`](docs/TESTING.md)                           | Strategia di test, copertura, esecuzione locale e CI                              |
| [`install.md`](docs/install.md)                           | Guida installazione VPS (esempio Hetzner) con `install.sh`                        |

### Materiale strategico (interno)

| Documento                                                                | Contenuto                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [`develop.md`](develop.md)                                               | Roadmap di sviluppo: stato attuale, sprint correnti, gap residui vs ASIMUT |
| [`develop-enterprise.md`](develop-enterprise.md)                         | Roadmap enterprise: LDAP/AD, SAML/IDEM-GARR, sync Esse3, RFID badge        |
| [`analisi.md`](analisi.md)                                               | Analisi competitiva (ASIMUT, EasyStaff, CINECA UP, NettunoPA), TAM/SAM/SOM |
| [`Cadenza_Presentazione_Prodotto.md`](Cadenza_Presentazione_Prodotto.md) | Deck di presentazione del prodotto (pricing, mercato, roadmap, rischi)     |
| [`Proposta.md`](Proposta.md)                                             | Proposta tecnico-commerciale per il sistema AFAM italiano                  |

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

**Copertura attuale**: 77 test backend integration + 10 component test frontend + 4 E2E Playwright. CI GitHub Actions con gate su label per gli E2E.

---

## 9. Stato del progetto e roadmap

### ✅ Production-ready

Le seguenti aree sono complete e in produzione:

- Core booking + waitlist + approval workflow + check-in QR anti-ghost
- Modulo prestiti strumenti completo (5 stati, scheduler, PDF, regole/quote)
- Bacheca avvisi audience-based + 11 mail template editabili
- Display kiosk (3 card configurabili, offline-soft, audience filter)
- 2FA email + Activity Hub admin
- PWA installabile (Service Worker, A2HS, offline kiosk)
- Pacchetto GDPR-PA italiana (Garante 06/2021)
- Bot messaging Telegram (gli altri 3 canali in scaffold completo)
- Vista settimanale + export PDF A4 landscape
- Bulk operations admin
- Analytics dashboard (heatmap, top, no-show, export)
- Import Isidata Liv A (manuale CSV/XLSX)
- i18n completa IT/EN/ES per le aree user-facing principali

### 🚧 Sprint correnti

- **Bot Telegram MVP** completo, scaffolding WhatsApp Cloud / Signal / Email
- Push notifications Web Push API
- Embed iframe per concerti pubblici
- Privacy granulare display kiosk

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
- Task management eventi (gap residuo vs ASIMUT documentato)

Dettaglio completo in [`develop.md`](develop.md) e [`develop-enterprise.md`](develop-enterprise.md).

---

## 10. Licenza

Cadenza è distribuita con un modello duale:

- **SaaS hosted** — piani Starter / Professional / Enterprise PA, licenza commerciale
- **Self-host** — sorgente + aggiornamenti + documentazione, licenza on-premise

Vedi [`Proposta.md`](Proposta.md) e [`Cadenza_Presentazione_Prodotto.md`](Cadenza_Presentazione_Prodotto.md) per il dettaglio dei piani e del pricing.

---

<div align="center">

**Cadenza · La musica merita il software migliore**

_© 2026 Danilo Russo · Documento generato dalla sintesi della documentazione di progetto_

</div>
