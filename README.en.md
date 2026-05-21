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
- ⭐ **Rich concert slides** (v1.15): colored chip for event type (concert · student recital · masterclass · conference · open lesson), descriptive subtitle, language flag for international events
- Soft-offline mode via Service Worker (a "Connection lost" banner)
- Granular privacy: option to hide names on the display per building
- **IP restriction** (optional): limit kiosk visibility and `/api/public/*` endpoints to the institute's IPs via nginx `allow`/`deny` (public CIDRs of the building + private LAN)

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
- Append-only audit log with 24-month retention and **SHA-256 integrity hash-chain** (v1.11.0): every row chains to the previous via `rowHash`/`prevHash`. Admin endpoint `GET /api/admin/audit-log/verify-integrity` detects direct DB tampering (PA compliance: tamper-evidence)

### 🔒 Security & compliance

- **2FA via email code** (6-digit OTP, 10-min expiry, bcrypt cost 8, 10 recovery codes)
- **JWT** 2h + `tokenVersion` (real logout) + bcrypt cost 12
- **Strict CSP** (`default-src 'self'`), HSTS preload, COOP/CORP, Permissions-Policy — public scanners: **securityheaders.com A+**, **Mozilla Observatory A+**, **SSL Labs A**, **HSTS Preload eligible**
- **Origin guard middleware** (v1.11.0): defense-in-depth against CSRF for Cadenza's JWT+Bearer model. All mutating requests (`POST/PUT/PATCH/DELETE`) must originate from a whitelisted `Origin/Referer` (`FRONTEND_URL` + same-origin), otherwise `403 ORIGIN_FORBIDDEN`
- **Sentry** v10 with recursive PII scrubbing + SHA-256 anonymised user
- **Italian PA GDPR package** (Garante 06/2021): cookie banner, append-only `UserConsent`, art. 20 export, art. 17 delete, re-consent on policy version change
- **PostgreSQL EXCLUDE constraint** (`bookings_no_overlap`) as a DB-level anti-overlap safety net
- **`paranoid: true`** (soft-delete) on 10 sensitive models

### 🔐 Authentication

- Local email + password
- **Google OAuth** and **Microsoft 365 / Entra ID OAuth** (configurable in the UI with encrypted secrets)
- Profile completion with `matricola` and `courseId` for students
- Roadmap: SPID/CIE (Sprint 6), LDAP/AD (enterprise sprint)
- Step-by-step SSO setup configurable from the admin UI (Server Settings → OAuth) with links to official Microsoft Learn / Google Cloud documentation

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
- **Installable PWA** (manifest + Workbox): home-screen icon, splash screen, standalone launch, offline shell with NetworkFirst on `/api/*` + StaleWhileRevalidate (5 min) on the kiosk and CacheFirst on fonts
- **Mobile UX overhaul** (v1.8.0): full pass on the 4 client pages (Dashboard, Booking, My Bookings, Profile). Compact hero replacing the large H1, prominent **"Next session" card**, **2×2 KPI grid**, decorative subtitles hidden below `sm`, full-width page title in the header
- **Mobile-first room calendar** (v1.8.0): new "Rooms and bookings of the day" section with **hierarchical `<details>` disclosure** building → room (zero React state, zero deps). Level 1 = building + "All free / N bookings" badge, level 2 = room + "Free / N" badge, tapping a booking opens the right dialog per role (cancel/info/edit). Auto-opens when there's a single building

### 💾 Business continuity

- **Periodic Excel mirror** of bookings on disk (default `/var/cadenza/sync/`), one tab per building with cells colour-coded by type — a faithful copy of the public kiosk display
- Folder sync to a personal cloud (OneDrive / Dropbox / pCloud / iCloud / Google Drive) via `rclone` + OS cron — fully decoupled from the backend: if Cadenza is down the last copy stays in the cloud and the front desk opens it from a phone. Deliberately one-way (Cadenza → file): edits on the sheet do NOT flow back into the DB, so there's no obscure conflict resolution at restore time. Interactive setup via `scripts/setup-rclone-sync.sh`
- Automatic DB + uploads backups (`.tar.gz` snapshot with daily/weekly/monthly retention)
- **Automated backup integrity check** (v1.9.0): weekly scheduler running 7 checks on the latest `.tar.gz` (age, tarball safety, manifest, non-empty dump, critical tables, data section, schema vs prod). Admin email only on failure (silent-on-success), idempotent per day+reason. Dedicated widget in `/admin/ops`
- **Multi-cloud off-site backup, opt-in** (v1.10.0): `scripts/setup-rclone-backups.sh` installs the daily cron copying backups to an rclone remote (OneDrive Personal/Business, Dropbox, S3, Hetzner Storage Box, Backblaze B2 — 70+ supported backends). Monthly cleanup with configurable retention (default 90 days)
- **PITR, opt-in** (v1.10.0): `scripts/setup-wal-archiving.sh` enables Postgres `archive_mode=on` with an `archive_command` pushing each WAL to the same rclone remote. RPO drops from 24h to ~1 min (`archive_timeout` 60s). Restore: standard PostgreSQL `recovery.conf` + `restore_command` against a `base` directory restored from snapshot.
- **PM2 cluster mode, opt-in** (v1.10.0): `ecosystem.config.js` is ready to switch into cluster mode. Cluster-safe schedulers via `backend/lib/clusterRole.js`: only the master instance runs them, the others only serve HTTP traffic

### 📥 Management-system integrations

- **Isidata import** (Tier A — manual CSV/XLSX): roster alignment via export from the electronic register most widely used in Italian conservatories. Diff engine with preview + transactional apply.
- **Guided UI mapping** (v1.5.1): a dropdown per file column lets you map to Cadenza targets (`externalId`, `email`, `role`, `courseCode`, `contractType`, ...) — no more hand-written JSON. Optional per-browser persistence.
- **Pre-apply safety thresholds** (v1.5.1): amber banner above the diff when deactivations exceed 10 % of linked users, critical red banner above 20 % with a second confirmation checkbox before _Apply_ is unlocked. Protects against distrophic imports (wrong Excel file, partial export).
- **`contractType` import + `courseCode → Course` lookup** (v1.5.1): the Isidata "Qualifica" column maps to `User.contractType` (titolare / contratto_orario / supplente) and sets the Monte Ore default threshold; students are auto-assigned to a Cadenza course via code match.
- **"Last 2 runs" diff** (v1.5.1): a ⟷ icon in the import history opens a dialog with 4 colour-coded sections — 🟢 new joiners / 🔴 new deactivations / 🟡 repeated changes (potential typos) / 🟣 returning users. Useful for retrospective audits.
- Roadmap: bidirectional Esse3/Isidata sync, ANIS/MIUR export.

### 🛡️ Admin UX

- **"Booking management" macro page** (v1.5.1): a single sidebar entry (`/admin/bookings-management`) with 3 large-card tabs — **Rules** (⚖️ amber) · **Booking types** (🏷️ green) · **Approvals** (📋 blue, with `N` counter badge). Legacy URLs `/admin/rules`, `/admin/booking-types`, `/admin/approvals` still work as redirects to the corresponding tab.
- Width aligned with the other admin pages (`max-w-6xl`), real-time badge on pending requests.
- **"System status" dashboard** (`/admin/ops`, v1.7.0): 5 at-a-glance widgets refreshed every 10s — VPS (CPU/RAM/disk with 70/90% threshold badges), database (connections, size, top tables), email queue (pending with oldest age), backups (last + age, **with "Integrity check" subsection added in v1.9.0** showing the latest weekly verification outcome), internal schedulers (status and last tick of **6 workers**: reminder, retention, mailOutbox, backup, backupVerify, excelExport). Admin-only `GET /api/admin/ops/snapshot` endpoint with 5s server-side cache.
- **Multi-component readiness** (`GET /api/ready`, extended in v1.11.0): verifies `database` (CRITICAL → 503), `smtp` (warning, the outbox handles retries), `disk` (warning ≥90%, critical ≥95%). Uniform response schema `{ status, checks: { database, smtp, disk }, timestamp }` on both 200 and 503 — ready for UptimeRobot/Healthchecks/Kubernetes `readinessProbe`. Separate liveness: `GET /api/health` (always 200 while the process is alive).
- **Admin `/api/loans` pagination** (v1.11.0): the loans listing returns `X-Total-Count`, `X-Limit`, `X-Offset` headers. Default 100 records, server-side cap 500 (anti-DoS). Backward-compatible for clients that don't pass `limit`/`offset`.

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

| Component     | Technology                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database      | PostgreSQL 16 (with `EXCLUDE` anti-overlap constraint)                                                                                               |
| Reverse proxy | nginx + Let's Encrypt (cert via certbot)                                                                                                             |
| Deploy        | VPS Ubuntu 24.04 — idempotent `install.sh` script                                                                                                    |
| Operations    | `pg-tune-4gb.sh` (idempotent, reversible Postgres tuning for small VPS) · `KIOSK_IP_ALLOWLIST.md` (nginx kiosk restriction) · `/admin/ops` dashboard |
| Monitoring    | Sentry v10 (opt-in) + in-app ops dashboard                                                                                                           |
| Testing       | Vitest 1,730 backend tests + 258 component/lib + 12 Playwright E2E specs (golden + RBAC + GDPR + audit chains closed)                                |
| CI/CD         | GitHub Actions (backend + frontend + E2E gate)                                                                                                       |

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
├── scripts/
│   ├── install.sh                     → idempotent Ubuntu VPS installer
│   └── pg-tune-4gb.sh                 → reversible Postgres tuning for 4 GB VPS
├── develop.md                         → dev roadmap (event plan + ops backlog)
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

For a full deployment on a Linux server (with nginx + Let's Encrypt + scheduler) use the `scripts/install.sh` script (idempotent, supports HTTPS domain / IP-only / IP self-signed modes). See [`docs/install.md`](docs/install.md) for the provider-agnostic step-by-step guide and the sizing tables for 500 / 1,500 / 3,000 users.

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

The `docs/` folder contains the essential technical and operational documentation. **Most documents are in Italian**; translation to English is on the roadmap.

| Document                                                                                                                                          | Contents                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md)                                                                                                         | System architecture (IT/EN), data models, routing, i18n, check-in, loans      |
| [`AUDIT_QUALITA_PRODUZIONE.md`](docs/AUDIT_QUALITA_PRODUZIONE.md)                                                                                 | Production-readiness audit & checklist                                        |
| [`install.md`](docs/install.md)                                                                                                                   | Linux server install, VPS providers, sizing for 500/1500/3000 users           |
| [`develop.md`](develop.md)                                                                                                                        | Development roadmap: event management (ASIMUT-like), backlog, current sprints |
| [`MANUALE_ADMIN.md`](docs/MANUALE_ADMIN.md) · [`MANUALE_DOCENTE.md`](docs/MANUALE_DOCENTE.md) · [`MANUALE_STUDENTE.md`](docs/MANUALE_STUDENTE.md) | In-app role-based manuals served via `/help`                                  |

### Strategic material (private)

Commercial and positioning documents are kept **outside the public repo** (pricing, target lists, sensitive market data). Available on request to Directors / IT Managers.

| Document                              | Contents                                                                                                                                      | Status                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [`develop.md`](develop.md)            | Development roadmap: event-management plan (5 phases · ~11 dev-days vs ASIMUT) + **post-1.6.0 backlog** (7 security/ops/perf items, ~12 days) | ✅ Versioned                     |
| `Proposta.md`                         | Technical-commercial proposal + competitive benchmark (ASIMUT, EasyStaff/EasyRoom Zucchetti) + 10-year TCO + migration plan · v2.2 (IT)       | 📄 Out of repo                   |
| `Cadenza_Presentazione_Direzione.pdf` | 18-slide deck for Directors / Presidents / DSGA — feature parity, costs, PA compliance                                                        | 📄 Out of repo                   |
| `develop-enterprise.md`               | Enterprise roadmap (LDAP/AD, SAML 2.0 IDEM-GARR, Esse3 sync, RFID badge)                                                                      | 🚧 In progress, not yet released |

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

**Current coverage (v1.11.0)**: **1,730** backend tests (98 integration + unit files, 16 skipped with rationale) + **258** frontend component tests (26 files, ~10 of which a11y via `vitest-axe`, 2 skipped) + **12 Playwright specs** (golden path + RBAC denial + booking cancel + GDPR export + pending-user blocking + loans pagination contract + 6 pre-existing on loans/waitlist/a11y) — **2,000 total tests**. Enforced thresholds: backend stmts ≥72 / lines ≥73 / funcs ≥78 / branches ≥60, frontend stmts ≥60 / lines ≥60 / funcs ≥50 / branches ≥50 — all 8 axes above 60% measured coverage (aggregate). GitHub Actions CI with 4 parallel jobs (backend / postgres / frontend / E2E).

**Stability suites (v1.5.1)** — beyond the classic unit/integration scope:

- **Backup roundtrip** (`backend/tests/integration/backupRoundtrip.test.js`): `performBackup()` → extract tar.gz → reopen the snapshot with a separate connection → verify counts and named joins against the live DB.
- **Calendar time-travel** (`backend/tests/unit/timeTravel.test.js`): 20 tests on AY rollover, Monte Ore submission window, Easter Computus 2024-2033, admin overrides (fake timers).
- **Playwright E2E smoke** (`frontend/tests/e2e/smoke.spec.ts`): golden path login UI → booking via API → list → logout, on a backend with in-memory SQLite that also serves the built SPA. Commands: `npm run e2e` / `npm run e2e:ui` / `npm run e2e:headed`.
- **Soak test harness** (`loadtest/soak.sh` + `loadtest/SOAK.md`): k6 5 RPS sustained for N hours + Node sampler (pm2 memory, FD count, `/api/ready` latency) + log tail. Markdown report with unicode ASCII charts and an automated leak verdict. Requires `brew install k6`. `npm run soak` (4h default). Run on **staging** the night before a major rollout — never in CI.

---

## 9. Project status & roadmap

### ✅ Production-ready

The following areas are complete and running in production:

- Core booking + waitlist + approval workflow + anti-ghost QR check-in
- Full musical-instrument loan module (5 states, scheduler, PDF, rules/quotas)
- Audience-based announcements board + 11 editable mail templates
- Kiosk display (3 configurable cards, soft-offline, audience filter, **optional nginx IP restriction**)
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
- **`/admin/ops` ops dashboard** (v1.7.0): at-a-glance diagnostics for VPS · Postgres · MailOutbox · Backups · Schedulers, polled every 10s with 5s server-side cache
- **Operational hardening toolkit** (v1.7.0): idempotent `pg-tune-4gb.sh` for Postgres + nginx IP allowlist guide for the kiosk
- **Smartphone UX overhaul** (v1.8.0): compact hero, 2×2 KPI grid, hidden decorative subtitles, full-line page title; **new "Rooms and bookings" section** mobile-only with hierarchical `<details>` disclosure building→room; Booking/MyBookings/Profile tightened
- **Automated backup integrity check** (v1.9.0): weekly scheduler running 7 checks, "Integrity check" widget in `/admin/ops`, admin alert email only on FAIL with idempotency per day+reason
- **High Availability Level 1+2, opt-in** (v1.10.0): PM2 cluster mode with scheduler lock (`backend/lib/clusterRole.js`), multi-cloud off-site backup (`scripts/setup-rclone-backups.sh`), PITR via WAL archiving (`scripts/setup-wal-archiving.sh`)
- **Security & quality hardening** (v1.11.0): originGuard middleware (cross-origin anti-CSRF), integrity hash-chain on `audit_log` (PA tamper-evidence, `verify-integrity` endpoint), `/api/ready` extended to DB/SMTP/disk, admin pagination on `/api/loans`, +5 Playwright specs (RBAC denial, booking cancel, GDPR export, pending-user, loans pagination contract)

### 🚧 Current sprints

- **Telegram bot MVP** complete, WhatsApp Cloud / Signal / Email scaffolding
- Web Push API notifications
- Iframe embed for public concerts
- **Post-1.6.0 backlog** (security/ops/perf): items consolidated in [`develop.md`](develop.md) §2. Quick-win candidates: §2.9 GDPR self-service export (~1d), §2.11 Suggested alternative slots on conflict (~2d). Open items: mobile-kiosk device token, mail-rotated PIN, external monitor with alerts, PgBouncer, slow query digest, dynamic QR code on the display, conflict-aware bulk booking for teachers

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

**Cadenza is proprietary closed-source software. Copyright © 2026 Danilo Russo. All rights reserved.**

The source code, documentation, assets and accompanying materials are the exclusive property of the Author and are protected by Italian and international copyright laws (L. 633/1941 art. 171-ter and 174-bis, Directive 2001/29/EC).

**Forbidden without prior written agreement of the Author**:

- Cloning, forking, mirroring or redistributing the source code (also modified), on any platform
- Running the software in production, staging or demo outside the terms of an active license
- Extracting the source code or documentation to train or evaluate machine learning models
- Removing or altering copyright notices

Cadenza is distributed under two commercial models:

- **Hosted SaaS** — Starter / Professional / Enterprise PA plans, commercial license
- **Self-host** — source + updates + documentation, per-institution on-premise license

To obtain a license: email `danilorussosax@gmail.com` with subject "Cadenza — License request".

Full license text in the [`LICENSE`](LICENSE) file at the root of the repository. Pricing, commercial plans and competitive benchmarks in `Proposta.md` v2.2 and `Cadenza_Presentazione_Direzione.pdf` (18-slide deck) — kept outside the repository and available on request.

---

<div align="center">

**Cadenza · Music deserves the best software**

_© 2026 Danilo Russo · Document synthesised from the project documentation_

</div>
