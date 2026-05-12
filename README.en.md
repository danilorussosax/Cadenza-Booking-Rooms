# 🎵 Cadenza

### The Italian booking platform for Music Conservatories

**Room booking · Musical instruments · Events · Italian PA compliance**

> 🇮🇹 [Leggi questa pagina in italiano](README.md)

---

## Table of contents

1. [What is Cadenza](#1-what-is-cadenza)
2. [Key features](#2-key-features)
3. [Tech stack](#3-tech-stack)
4. [Repository layout](#4-repository-layout)
5. [Quick start](#5-quick-start)
6. [Configuration & environment variables](#6-configuration--environment-variables)
7. [Documentation](#7-documentation)
8. [Testing](#8-testing)
9. [Project status & roadmap](#9-project-status--roadmap)
10. [License](#10-license)

---

## 1. What is Cadenza

Cadenza is a full-stack web application that handles room, rehearsal and concert hall bookings, plus the musical-instrument inventory of a Music Conservatory. **Students, teachers and administrators** can book spaces under role-based rules, manage instrument loans and publish concerts and announcements on a public kiosk display.

The application is organised as a **monorepo**:

```
Cadenza/
├── backend/          → REST API in Node.js / Express + Sequelize
├── frontend/         → React + TypeScript + Vite SPA
└── docs/             → Technical and operational documentation (Italian)
```

In production the backend serves both `/api/*` endpoints and the compiled React bundle (`frontend/dist/`), acting as a single web server behind nginx.

**Market target**: the 79 Italian state conservatories + ~50 AFAM accredited institutes. The product is designed for the Italian PA (Public Administration) from the ground up (GDPR-Garante, SPID-ready, MEPA-ready), which differentiates it from generic international competitors.

---

## 2. Key features

### 🏛️ Room booking

- Self-service booking with a 30-minute grid, 7–23
- Per-role rules and quotas (min/max duration, lead time, allowed hours, weekly quota)
- **Exceptions scoped by role + room** (`block` or `time_window`): temporary overrides for renovations, exam sessions, masterclasses, with historical overlap preview and transactional batch-cancel
- **Approval workflow** for special rooms (concert hall, auditorium)
- **Anti-ghost booking**: check-in via QR code printed in the room, auto-cancellation with a grace period (skipped when `Room.requireCheckIn=false`)
- **Waitlist** with claim window and auto-promote
- **Dashboard** with a "1 day · 3 days" toggle (preference persisted per browser, navigation arrows aligned to the mode)
- Weekly view of rooms × days with PDF export (A4 landscape, per building)
- iCal export per user via personal token

### 🎻 Musical instrument inventory _(unique)_

- Full catalogue with families (strings, woodwinds/brass, keyboards, percussion…)
- Complete loan workflow: `requested → active → returned`, with auto-overdue
- Signed PDF for delivery and return
- T-2 day reminders and automatic overdue notifications
- Rules and quotas by family, course and role
- Idempotent CSV import/export

### 📺 Public kiosk display

- Three configurable cards: bookings, concerts, announcements
- Building / concerts / announcements rotation with per-building timers
- Soft-offline mode via Service Worker (a "Connection lost" banner)
- Granular privacy: option to hide names on the display per building

### 📢 Announcements board & communications

- Audience-filtered announcements: everyone / by role / by course / by building
- 11 editable email templates (booking, loan, waitlist, approval, announcement)
- Mail server settings with AES-256-GCM encryption at rest

### ✉️ Robust email system _(outbox pattern)_

- **Persistent queue** `mail_outbox`: every send goes through a table before SMTP — no emails lost when the provider flaps
- **Async worker** with exponential backoff (60s → 16min) + `dead` after 5 attempts, run by `mailOutboxScheduler` (tick 15s, batch 20)
- **Natural idempotency key** (`booking:42:confirmation`) → an admin double-click is a no-op
- **Try-sync-then-enqueue** for security emails (2FA codes): sync attempt for user latency, async fallback on error
- **Shared SMTP connection pool** between worker and sync sends (`pool: true, maxConnections: 3`)
- **Multi-instance ready**: `FOR UPDATE SKIP LOCKED` on Postgres
- **Per-recipient throttle** (configurable in the admin UI, disabled by default): max N emails/h to the same address, anti-flapping. Security emails always bypass it
- **Hard-bounce detection** from SMTP 5xx (550/551/553/511/521): the user is marked as bounced and further enqueueMail is skipped until an admin reactivates the address
- **Admin page "Email Queue"** with status filters, search, manual retry for `dead` rows, health endpoint using `transporter.verify()`
- **Automatic cleanup** of `sent` rows older than 30 days (`dead` ones are kept for audit)
- **Timezone-aware**: booking times in emails are formatted in `Institute.timezone` (default `Europe/Rome`), aligned with what users see in the app even when the Node process runs in UTC

### 🤖 Bot messaging

- 4 pluggable adapters: **Telegram** (production-ready), WhatsApp Cloud API, Signal `signal-cli`, Email IMAP (scaffold)
- Commands: `/aule` (rooms), `/agenda [date]` (day snapshot), `/book` (**5-step wizard**: site → room → when → type → confirm — single-option steps are skipped), `/list`, `/cancel`, `/check`, `/help`
- Binding via 6-character OTP, reuses `bookingValidator` (no bypass of rules/quotas)
- Webhook with HMAC verification, 30/min + 200/day rate limit
- **1-click Telegram setup**: given the `botToken` from @BotFather, Cadenza generates the webhook secret, registers the webhook with Telegram, publishes the command list and descriptions. No curl, no `openssl rand`

### 📊 Analytics & reporting

- Weekly 7×24 occupancy heatmap
- Top 10 rooms and top users by hours
- No-show rate with an 8-week trend
- CSV export (UTF-8 BOM) and monthly PDF reports
- Append-only audit log with 24-month retention

### 🔒 Security & compliance

- **2FA via email code** (6-digit OTP, 10-min expiry, bcrypt cost 8, 10 recovery codes)
- **JWT** 2h + `tokenVersion` (real logout) + bcrypt cost 12
- **Strict CSP** (`default-src 'self'`), HSTS preload, COOP/CORP, Permissions-Policy — public scanners: **securityheaders.com A+**, **Mozilla Observatory A+**, **SSL Labs A**, **HSTS Preload eligible**
- **Sentry** v10 with recursive PII scrubbing + SHA-256 anonymised user
- **Italian PA GDPR package** (Garante 06/2021): cookie banner, append-only `UserConsent`, art. 20 export, art. 17 delete, re-consent on policy version change
- **PostgreSQL EXCLUDE constraint** (`bookings_no_overlap`) as a DB-level anti-overlap safety net
- **`paranoid: true`** (soft-delete) on 10 sensitive models

### 🔐 Authentication

- Local email + password
- **Google OAuth** and **Microsoft 365 / Entra ID OAuth** (configurable in the UI with encrypted secrets)
- Profile completion with `matricola` and `courseId` for students
- Roadmap: SPID/CIE (Sprint 6), LDAP/AD (enterprise sprint)
- Step-by-step SSO setup with links to official Microsoft Learn / Google Cloud docs — see [`docs/SSO.md`](docs/SSO.md)

### 🌍 Internationalisation

UI fully translated into **Italian** (default), **English**, **Spanish**, **German** and **French**, with `i18next` + `dayjs` locale. Preference persisted in `localStorage`. Backend errors mapped via stable `error.code` values (e.g. `BOOKING_CONFLICT`, `EMAIL_ALREADY_REGISTERED`).

### ♿ WCAG 2 AA accessibility

- "Skip to content" link and explicit `<main>` landmark on every page
- Form error messages tied via `aria-describedby` + `role="alert"` (admin forms fully covered)
- Respects `prefers-reduced-motion` (animations disabled when the user requests it at the OS level)
- Textual fallbacks for dashboard charts (heatmap, tops, no-show trend)
- Automated tests: **axe-core** in unit (`vitest-axe`) and E2E (`@axe-core/playwright`)

### 📱 Mobile UX

- Viewport in `dvh` units (no iOS Safari scroll bug with the address bar)
- `inputmode="numeric"` on matricola and numeric fields
- `beforeunload` confirmation on forms with unsaved changes
- **Global offline banner** (Service Worker) and **bottom-nav** on mobile for the main areas
- Responsive dialogs: full-screen below `sm`, bottom-sheet with a drag handle on mobile
- Admin tables → **card stack** below `sm` (no horizontal overflow)
- Safe-area awareness: top toggles (language, theme) clear the iOS notch / status bar in PWA standalone

### 📥 Management-system integrations

- **Isidata import** (Tier A — manual CSV/XLSX): roster alignment via export from the electronic register most widely used in Italian conservatories. Diff engine with preview + transactional apply.
- Roadmap: bidirectional Esse3/Isidata sync, ANIS/MIUR export.

---

## 3. Tech stack

### Backend

| Technology        | Role                                                |
| ----------------- | --------------------------------------------------- |
| Node.js ≥ 18      | Runtime                                             |
| Express 5         | HTTP framework                                      |
| Sequelize 6       | ORM (PostgreSQL · SQLite and MySQL supported)       |
| Passport          | Auth strategies (local · Google OAuth2 · Microsoft) |
| bcryptjs          | Password hashing                                    |
| jsonwebtoken      | Signed JWT                                          |
| express-validator | Input validation                                    |
| dayjs             | Date / timezone handling                            |
| pdfkit            | PDF generation (loans, reports)                     |
| sharp             | Image resize (logo, instrument photos)              |
| qrcode            | Check-in QR generation                              |
| pino              | Structured logger with PII scrubbing                |

### Frontend

| Technology                | Role                                          |
| ------------------------- | --------------------------------------------- |
| React 19 + TypeScript 6   | UI                                            |
| Vite 8                    | Build tool / dev server with HMR              |
| Tailwind CSS 4            | Utility-first design system                   |
| shadcn/ui (Radix UI)      | Accessible components                         |
| Framer Motion             | Transition animations                         |
| Lucide React              | Vector icons                                  |
| TanStack Query            | Server-state cache and sync                   |
| React Router v6           | Client-side routing                           |
| React Hook Form + Zod     | Forms and validation                          |
| Sonner                    | Toast notifications                           |
| i18next + react-i18next   | Internationalisation (it · en · es · de · fr) |
| vite-plugin-pwa + Workbox | Service Worker, precache, soft-offline kiosk  |

### Infrastructure

| Component     | Technology                                                              |
| ------------- | ----------------------------------------------------------------------- |
| Database      | PostgreSQL 16 (with `EXCLUDE` anti-overlap constraint)                  |
| Reverse proxy | nginx + Let's Encrypt (cert via certbot)                                |
| Deploy        | VPS Ubuntu 24.04 — idempotent `install.sh` script                       |
| Monitoring    | Sentry v10 (opt-in)                                                     |
| Testing       | Vitest 1,386 backend tests + 177 component/lib + 5 Playwright E2E specs |
| CI/CD         | GitHub Actions (backend + frontend + E2E gate)                          |

---

## 4. Repository layout

```
Cadenza/
├── backend/
│   ├── server.js                      → Express bootstrap + DB sync + seed
│   ├── config/database.js             → Sequelize instance
│   ├── models/                        → one file per model + index.js (relations)
│   ├── routes/                        → one file per area (auth, users, bookings, …)
│   ├── middleware/auth.js             → authenticate, requireRole, enforceAdminTwoFa
│   ├── services/
│   │   ├── bookingValidator.js        → pre-insert/update rules
│   │   ├── twoFa.js                   → email-based 2FA OTP
│   │   ├── messaging/                 → pluggable bot adapters + intents
│   │   ├── retentionScheduler.js      → 24-month audit cleanup
│   │   ├── reminderScheduler.js       → T-2d reminders, ghost cancel, overdue
│   │   ├── backupScheduler.js         → in-process daily backup
│   │   └── integrations/              → Isidata import + provider base
│   ├── lib/
│   │   ├── crypto.js                  → AES-256-GCM for secrets at rest
│   │   ├── preSyncMigrations.js       → bookings_no_overlap on Postgres
│   │   └── dbErrors.js                → Sequelize → HTTP error mapper
│   ├── seeders/initial.js             → default admin + levels + rules
│   └── tests/                         → Vitest integration tests
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx                   → Provider tree (Theme · QueryClient · Router · Auth)
│   │   ├── App.tsx                    → Route definitions
│   │   ├── pages/                     → auth, admin, Display, Profile, Booking, …
│   │   ├── components/
│   │   │   ├── ui/                    → shadcn primitives
│   │   │   ├── layout/                → AppLayout · AuthLayout
│   │   │   ├── bookings/              → BookingFormDialog, MultiRoomTimetable, …
│   │   │   └── admin/                 → CRUD form dialogs
│   │   ├── contexts/                  → AuthContext · ThemeContext
│   │   ├── api/                       → one module per area
│   │   ├── lib/                       → api wrapper, date helper, utils
│   │   ├── i18n/locales/              → it.json · en.json · es.json · de.json · fr.json
│   │   └── types/index.ts             → shared TypeScript interfaces
│   └── e2e/                           → Playwright specs
│
├── docs/                              → technical documentation (see § 7)
├── scripts/install.sh                 → idempotent Ubuntu VPS installer
└── README.md                          → Italian version of this file
```

---

## 5. Quick start

### Prerequisites

- Node.js ≥ 18 (20 recommended)
- PostgreSQL 16 (recommended in production) **or** SQLite (zero-config default in development)
- npm ≥ 9

### Development

#### Automated macOS setup (recommended)

The `scripts/setup-macos.sh` script installs or upgrades the **entire** stack in one go: Xcode CLT, Node ≥ 20, PostgreSQL 16, git, npm dependencies for the 3 workspaces, `backend/.env` with generated secrets, Postgres user + database, initial schema and admin seeder.

```bash
# Default: Homebrew (mainstream)
bash scripts/setup-macos.sh                # interactive
bash scripts/setup-macos.sh --yes          # non-interactive
bash scripts/setup-macos.sh --dry-run      # show what it would do
bash scripts/setup-macos.sh --reset-db     # DROP + recreate the DB (destructive)

# ⭐ Without Homebrew (curl + fnm + Postgres.app)
bash scripts/setup-macos.sh --no-brew      # no brew, no sudo (except Xcode CLT)
```

Idempotent in both modes: re-running upgrades already-installed packages (`brew upgrade` or `fnm install`) and preserves any existing `.env` (with automatic backup). Compatible with Apple Silicon and Intel.

**When to use `--no-brew`**: when you don't want or can't install Homebrew (corporate policy, no sudo, personal preference for user-local tools). It will use:

- **[fnm](https://github.com/Schniz/fnm)** for Node — multiple version management without system pollution
- **[Postgres.app](https://postgresapp.com)** for PostgreSQL — native `.app` with a menu-bar
- **git** already shipped via Xcode CLT

#### Manual setup (any OS)

Initial setup (once, from the repo root):

```bash
npm install                       # root devtools: husky, lint-staged, commitlint, prettier
npm --prefix backend install
npm --prefix frontend install
```

Combined dev start (backend nodemon on :3000 + frontend vite on :5173):

```bash
npm run dev                       # both in parallel in the same terminal
# or, in two separate terminals:
npm run dev:backend
npm run dev:frontend
```

Open `http://localhost:5173`. Seeded default admin credentials:

```
email:    admin@conservatorio.it
password: Admin123!
```

> Change the password on first login. Admin 2FA is mandatory with a 7-day grace period.

### Production

```bash
npm run build                     # build frontend → frontend/dist
npm run start                     # start backend (serves API + static dist)
```

For a full deployment on Ubuntu 24.04 VPS (with nginx + Let's Encrypt + scheduler) use the `scripts/install.sh` script (idempotent, supports HTTPS domain / IP-only / IP self-signed modes). See [`docs/install.md`](docs/install.md) for the step-by-step guide (Hetzner example included).

### Useful commands (from the repo root)

| Command                                                  | Effect                                             |
| -------------------------------------------------------- | -------------------------------------------------- |
| `npm run dev`                                            | Backend + frontend in parallel (Ctrl+C stops both) |
| `npm run dev:backend`                                    | Backend only (nodemon)                             |
| `npm run dev:frontend`                                   | Frontend only (vite)                               |
| `npm run build`                                          | Build frontend (`frontend/dist`)                   |
| `npm run start`                                          | Production backend (serves API + dist)             |
| `npm run test`                                           | Vitest backend + frontend                          |
| `npm run lint`                                           | ESLint frontend                                    |
| `npm run format`                                         | Prettier across the whole monorepo                 |
| `npm --prefix backend run seed`                          | Re-seed admin + levels + rules                     |
| `DB_SYNC_MODE=alter npm --prefix backend run db:migrate` | Apply schema changes (development)                 |

---

## 6. Configuration & environment variables

Main variables (file `.env` inside `backend/`):

### Database

```env
DB_DIALECT=postgres                # or sqlite
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cadenza
DB_USER=cadenza
DB_PASSWORD=...
DB_SSL=false
```

### Auth & security

```env
JWT_SECRET=...                     # long random string
ENCRYPTION_KEY=...                 # 32-byte hex, encrypts messaging/oauth secrets
TWO_FA_TTL_MIN=10                  # email 2FA code expiry
TWO_FA_MAX_ATTEMPTS=5
TWO_FA_GRACE_DAYS=7                # admin grace period to enable 2FA
TWO_FA_ISSUER="Conservatorio · Cadenza"
```

### SMTP (required for email 2FA)

```env
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@conservatorio.it
SMTP_PASS=...
SMTP_FROM="Conservatorio · Cadenza <noreply@conservatorio.it>"
```

### Check-in & ghost booking

```env
CHECKIN_EARLY_MINUTES=5            # how early check-in opens
GHOST_GRACE_MINUTES=15             # tolerance before auto-cancel
FRONTEND_URL=https://cadenza.example.com
```

### Automatic backup

```env
BACKUP_AUTO_ENABLED=true           # in-process scheduler
BACKUP_TICK_HOUR=2                 # local hour of daily backup
BACKUP_TICK_MINUTE=30
AUTO_RESTART_ENABLED=false         # if true, enables restart endpoint
```

> **Minimum set to boot**: `JWT_SECRET`, `ENCRYPTION_KEY`, and SMTP config. Everything else has sensible defaults.

---

## 7. Documentation

The `docs/` folder contains the full technical and operational documentation. **Most documents are currently in Italian**; translation to English is on the roadmap.

| Document                                                  | Contents                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md)                 | System architecture (IT/EN), data models, routing, i18n, check-in, loans         |
| [`SECURITY.md`](docs/SECURITY.md)                         | Email-based 2FA OTP — flow, admin enforcement, recovery, regulatory references   |
| [`SSO.md`](docs/SSO.md)                                   | Step-by-step SSO setup for Microsoft 365 / Entra ID and Google Workspace         |
| [`BOT-MESSAGING.md`](docs/BOT-MESSAGING.md)               | Telegram / WhatsApp / Signal / Email bots — setup, commands, costs, security     |
| [`INTEGRATIONS-ISIDATA.md`](docs/INTEGRATIONS-ISIDATA.md) | Manual Isidata roster import (CSV/XLSX) with preview + transactional diff        |
| [`BACKUP.md`](docs/BACKUP.md)                             | Automatic backup, admin-UI restore, remote upload (S3, Hetzner, rclone, GPG)     |
| [`db-constraints.md`](docs/db-constraints.md)             | PostgreSQL anti-overlap EXCLUDE constraint — debugging and emergency procedure   |
| [`DEPLOY.md`](docs/DEPLOY.md)                             | `./deploy.sh` flow (8 steps), SSH alias setup, PWA checks, nginx troubleshooting |
| [`TESTING.md`](docs/TESTING.md)                           | Testing strategy, coverage, local and CI execution                               |
| [`install.md`](docs/install.md)                           | VPS install guide (Hetzner example) with `install.sh`                            |

### Strategic material (private)

Commercial and positioning documents are kept **outside the public repo** (pricing, target lists, sensitive market data). Available on request to Directors / IT Managers.

| Document                              | Contents                                                                                                                                | Status                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [`develop.md`](develop.md)            | Development roadmap: event-management plan (5 phases · ~11 dev-days vs ASIMUT), current sprints, residual gaps                          | ✅ Versioned                     |
| `Proposta.md`                         | Technical-commercial proposal + competitive benchmark (ASIMUT, EasyStaff/EasyRoom Zucchetti) + 10-year TCO + migration plan · v2.2 (IT) | 📄 Out of repo                   |
| `Cadenza_Presentazione_Direzione.pdf` | 18-slide deck for Directors / Presidents / DSGA — feature parity, costs, PA compliance                                                  | 📄 Out of repo                   |
| `develop-enterprise.md`               | Enterprise roadmap (LDAP/AD, SAML 2.0 IDEM-GARR, Esse3 sync, RFID badge)                                                                | 🚧 In progress, not yet released |

---

## 8. Testing

```bash
# Backend integration (Vitest + in-memory SQLite)
cd backend
npm test

# Single suite
npx vitest run tests/integration/auth.test.js

# EXCLUDE constraint test (requires a dedicated Postgres)
DB_DIALECT=postgres DB_HOST=localhost DB_NAME=cadenza_test \
DB_USER=cadenza DB_PASSWORD=... DB_SSL=false \
npx vitest run tests/integration/excludeConstraint.test.js

# Frontend component tests (Vitest + Testing Library)
cd frontend
npm test

# Playwright E2E
cd frontend
npm run test:e2e
```

**Current coverage**: **1,386** backend tests (70 integration + unit files) + **177** frontend component tests (19 files, 10 of which a11y via `vitest-axe`) + **5 specs** Playwright E2E (login-booking, waitlist-claim, a11y, instrument-loan, admin-approve) — **1,568 total tests**. Enforced thresholds: backend stmts ≥72 / lines ≥73 / funcs ≥78 / branches ≥60, frontend stmts ≥60 / lines ≥60 / funcs ≥50 / branches ≥50 — all 8 axes above 60% measured coverage (aggregate). GitHub Actions CI with 4 parallel jobs (backend / postgres / frontend / E2E).

---

## 9. Project status & roadmap

### ✅ Production-ready

The following areas are complete and running in production:

- Core booking + waitlist + approval workflow + anti-ghost QR check-in
- Full musical-instrument loan module (5 states, scheduler, PDF, rules/quotas)
- Audience-based announcements board + 11 editable mail templates
- Kiosk display (3 configurable cards, soft-offline, audience filter)
- Email 2FA + admin Activity Hub
- Installable PWA (Service Worker, A2HS, kiosk offline)
- Italian PA GDPR package (Garante 06/2021)
- Telegram bot messaging (the other 3 channels in full scaffold)
- Weekly view + A4 landscape PDF export
- Admin bulk operations
- Analytics dashboard (heatmap, tops, no-show, export)
- Isidata Tier A import (manual CSV/XLSX)
- Full IT/EN/ES/DE/FR i18n for the main user-facing areas
- **WCAG 2 AA accessibility** (skip link, landmarks, ARIA on forms, reduced-motion, chart text fallbacks, axe-core in unit + E2E)
- **Mobile UX** (`dvh` viewport, bottom-nav, bottom-sheet dialogs below `sm`, card-stack admin tables, global offline banner, safe-area aware top toggles)
- **Robust email system** (outbox pattern + retry, per-recipient throttle, hard-bounce detection, admin "Email Queue" page + health, automatic cleanup, timezone-aware formatting)

### 🚧 Current sprints

- **Telegram bot MVP** complete, WhatsApp Cloud / Signal / Email scaffolding
- Web Push API notifications
- Iframe embed for public concerts
- Kiosk display granular privacy

### 🔵 Italian PA roadmap

- **SPID / CIE** login (AgID registration + integration, ~3–4 dev weeks + 2–3 months of process)
- **PEC** integration (official communications)
- **Conservazione sostitutiva** PDF with digital signature + RFC 3161 timestamp
- **ANIS / MIUR** export (AFAM compliance)
- Bidirectional **Esse3** / Isidata Tier B/C sync

### 🔵 Enterprise roadmap

- **LDAP / Active Directory** authentication
- **SAML 2.0** federation (IDEM-GARR)
- **RFID badge** integration (for conservatories that already have door readers)
- Event task management (gap vs ASIMUT): full architectural plan in [`develop.md`](develop.md) (5 phases · ~11 dev-days · demo-ready MVP after Phase 1)

Full detail in [`develop.md`](develop.md) (versioned) and `develop-enterprise.md` (in progress, out of repo).

---

## 10. License

Cadenza is distributed under a dual model:

- **Hosted SaaS** — Starter / Professional / Enterprise PA plans, commercial license
- **Self-host** — source + updates + documentation, on-premise license

For plan details, pricing and competitive benchmarks, see `Proposta.md` v2.2 (technical-commercial, kept out of the public repo) and `Cadenza_Presentazione_Direzione.pdf` (18-slide commercial deck). Available on request.

---

<div align="center">

**Cadenza · Music deserves the best software**

_© 2026 Danilo Russo · Document synthesised from the project documentation_

</div>
