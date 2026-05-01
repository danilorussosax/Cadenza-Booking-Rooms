# Cadenza · Architettura del progetto / Project Architecture

> Sistema di prenotazione aule per Conservatori di Musica.
> Room booking system for Music Conservatories.

[🇮🇹 Italiano](#-italiano) · [🇬🇧 English](#-english)

---

# 🇮🇹 Italiano

## 1. Panoramica

**Cadenza** è un'applicazione web full-stack per la gestione delle prenotazioni delle aule di un Conservatorio di Musica. Permette a studenti, docenti e amministratori di prenotare studi, sale prove, sale concerti e aule didattiche, con regole differenziate per ruolo e una vista pubblica "kiosk" per i monitor in struttura.

L'applicazione è organizzata come **monorepo** con due moduli:

```
Cadenza/
├── backend/          → API REST in Node.js/Express + Sequelize
├── frontend/         → SPA React + TypeScript + Vite
└── docs/             → Documentazione (questo file)
```

In produzione il backend serve sia gli endpoint `/api/*` che il bundle React buildato (`frontend/dist/`), agendo da web-server unico.

## 2. Stack tecnologico

### Backend

| Tecnologia        | Ruolo                                              |
| ----------------- | -------------------------------------------------- |
| Node.js ≥ 18      | Runtime                                            |
| Express 4         | Framework HTTP                                     |
| Sequelize 6       | ORM (SQLite default · supporta Postgres / MySQL)   |
| Passport          | Strategie auth (local · Google OAuth2 · Microsoft) |
| bcryptjs          | Hash password                                      |
| jsonwebtoken      | JWT firmati                                        |
| express-validator | Validazione input                                  |
| dayjs             | Gestione date / fusi orari                         |

### Frontend

| Tecnologia                           | Ruolo                                              |
| ------------------------------------ | -------------------------------------------------- |
| React 18 + TypeScript                | UI                                                 |
| Vite                                 | Build tool / dev server con HMR                    |
| Tailwind CSS 3                       | Sistema di design utility-first                    |
| shadcn/ui (Radix UI)                 | Componenti accessibili (Dialog, Select, Tabs, ...) |
| Framer Motion                        | Animazioni di transizione                          |
| Lucide React                         | Icone vettoriali                                   |
| TanStack Query                       | Cache e sincronizzazione dati server               |
| React Router v6                      | Routing client-side                                |
| React Hook Form + Zod                | Form e validazione                                 |
| Sonner                               | Notifiche toast                                    |
| **i18next + react-i18next**          | **Internazionalizzazione (it · en · es)**          |
| **i18next-browser-languagedetector** | **Rilevamento lingua + persistenza**               |
| Inter                                | Famiglia tipografica (pesi differenziati)          |

## 3. Modelli dati

### Entità principali

```
Institute (1)──(N) Building (1)──(N) Room (1)──(N) Equipment
                                          │
                                          └──(N) Booking ──(N) User
                                                 │
                                                 └─ status, type, ...

Course ──(N) User (matricola, courseId)
CourseLevel        ── codice riferito da Course.levels[]
EquipmentTemplate  ── catalogo dotazioni riusabili
BookingRule        ── 1 record per ruolo (studente/docente/admin)
```

### Modelli

- **User** — `email`, `passwordHash`, `firstName/lastName`, `role` (`admin`/`docente`/`studente`), `matricola`, `courseId`, `googleId`, `microsoftId`, `isActive`, `lastLogin`
- **Course** — `code` (unico), `name`, `department`, `levels` (array di codici stringa, dinamici), `description`, `isActive`
- **CourseLevel** — catalogo dei livelli di studio: `code`, `name`, `sortOrder`
- **Institute** — `name`, `code`, `address`, `city`, `country`, `logoUrl` (data:URL base64), `copyright` (testo del footer app)
- **Building** — `instituteId`, `name`, `floors[]`, `address`
- **Room** — `buildingId`, `name`, `floor`, `capacity`, `type` (studio · sala_prove · aula_concerti · classe · aula_didattica), `allowedRoles[]`, `allowedCourseIds[]`, `isBookable`
- **Equipment** — `roomId`, `name`, `type`, `brand`, `model`, `quantity`, `isWorking`
- **EquipmentTemplate** — catalogo dotazioni: `name` (unico), `type`
- **Booking** — `userId`, `roomId`, `startTime`, `endTime`, `purpose`, `type` (studio_individuale · lezione · prova · concerto · altro), `status` (confirmed · cancelled · completed · no_show), `checkInToken` (UUID anti ghost-booking), `checkedInAt`, `autoCancelledAt`
- **BookingRule** — un record per ruolo: `maxActiveBookings`, `maxHoursPerWeek`, `maxHoursPerDay`, `min/maxBookingDurationMinutes`, `min/maxAdvance...`, `cancellationDeadlineHours`, `allowed/Start/EndTime`, ...

## 4. Autenticazione e autorizzazione

- **JWT** firmato lato server (`HS256`), salvato in `localStorage`
- **Strategie**: email + password (Passport local) · Google OAuth2 · Microsoft OAuth
- **Ruoli**: `admin` / `docente` / `studente`
- **Profilo completo**: per gli utenti non-admin, alcune azioni richiedono che `matricola` e `courseId` siano valorizzati (controllo via middleware `requireCompleteProfile`)
- **Endpoint pubblici** (no auth): `/api/auth/*`, `/api/courses` (lista), `/api/course-levels`, `/api/structure/institutes/public`, `/api/public/*` (per il display kiosk)
- **Rotte admin-only** protette da middleware `requireRole('admin')`

Lato frontend tre wrapper:

- `<PublicOnlyRoute>` — redirect a dashboard se già loggato (login, register)
- `<ProtectedRoute>` — richiede auth, opzionalmente profilo completo
- `<RequireAdmin>` — guard interno per le rotte `/admin/*`

## 5. Architettura backend

```
backend/
├── server.js          → bootstrap Express + sync DB + seed
├── config/database.js → istanza Sequelize
├── models/            → un file per modello + index.js (relazioni)
├── routes/            → un file per area (auth, users, courses, ...)
├── middleware/auth.js → authenticate, requireRole, requireCompleteProfile
├── services/
│   ├── bookingValidator.js → validazione regole prima di insert/update
│   └── structureImporter.js → parser CSV import sedi
└── seeders/initial.js → admin di default + 5 livelli + regole base
```

Endpoint principali:

- `POST /api/auth/login` · `POST /api/auth/register` · OAuth flow
- `GET /api/auth/me` · `PATCH /api/auth/me` · `POST /api/auth/change-password`
- `GET/POST/PUT/DELETE /api/users` (admin)
- `/api/courses` + `/import` + `/bulk-delete`
- `/api/course-levels` (CRUD + bulk-delete)
- `/api/structure/institutes|buildings|rooms|equipment|equipment-templates` (CRUD + bulk + import CSV)
- `/api/rules/:role` (admin) · `/api/bookings` · `/api/bookings/availability/:roomId`
- `/api/public/agenda` · `/api/public/stats` · `/api/public/institute` (kiosk)

## 6. Architettura frontend

```
frontend/src/
├── main.tsx           → Provider tree (Theme · QueryClient · Router · Auth · Toaster)
├── App.tsx            → Definizione delle route
├── pages/             → Una cartella per area: auth, admin, Display, Profile, ...
├── components/
│   ├── ui/            → Primitives shadcn (Button, Card, Dialog, ...)
│   ├── layout/        → AppLayout (sidebar + topbar) · AuthLayout
│   ├── bookings/      → BookingFormDialog · CancelBookingDialog · DayCalendar · MultiRoomTimetable
│   └── admin/         → Form dialogs CRUD (Users, Courses, Levels, Structure, Equipment, Rules)
├── contexts/
│   ├── AuthContext    → utente corrente, login/logout, refresh
│   └── ThemeContext   → light / dark / system + persistenza
├── api/               → Un modulo per area (auth, courses, structure, ...)
├── lib/
│   ├── api.ts         → fetch wrapper con JWT + gestione errori
│   ├── date.ts        → setup dayjs locale "it" + helper
│   ├── bookings.ts    → label e mapping colori per tipi/stati
│   └── utils.ts       → cn() per merge classNames
├── hooks/useFullscreen.ts → API fullscreen + idle (per il kiosk Display)
└── types/index.ts     → Tutte le interfacce TypeScript condivise
```

### Routing

```
Route pubbliche:
  /login              → Login (OAuth + form email)
  /register           → Registrazione
  /oauth/callback     → Callback OAuth
  /display            → Kiosk monitor pubblico

Route protette (ProtectedRoute):
  /complete-profile   → Completamento profilo (no requirement)
  /dashboard          → Home con KPI + timetable + upcoming
  /booking            → Selezione aula + giorno + grid 30-min
  /my-bookings        → Tabs future/passate/annullate/tutte
  /rooms              → Directory aule
  /profile            → Anagrafica + cambio password + (admin) copyright

Route admin (RequireAdmin):
  /admin/users        → CRUD utenti
  /admin/courses      → Tabs Corsi / Livelli (CRUD + CSV + bulk)
  /admin/structure    → Tabs Sedi / Dotazioni (tree CRUD + CSV + bulk)
  /admin/rules        → Regole prenotazione per ruolo
```

## 6-bis. Check-in & ghost-booking prevention

Per ridurre le prenotazioni "fantasma" (aule prenotate e mai utilizzate) Cadenza implementa un sistema di check-in QR:

- **Modello `Booking`** ha 3 campi dedicati:
  - `checkInToken` — UUID generato in `beforeCreate` (riservato a usi futuri come check-in passwordless)
  - `checkedInAt` — timestamp di conferma presenza
  - `autoCancelledAt` — timestamp di auto-cancellazione da scheduler

- **Endpoint `POST /api/bookings/:id/checkin`** (auth JWT). Marca `checkedInAt=now` se l'utente è il proprietario, lo stato è `confirmed`, e `now ∈ [startTime − CHECKIN_EARLY_MINUTES, startTime + GHOST_GRACE_MINUTES]`. Errori dedicati: `CHECKIN_TOO_EARLY`, `CHECKIN_TOO_LATE`, `CHECKIN_INVALID_STATUS`, `ALREADY_CHECKED_IN`.

- **Endpoint `GET /api/bookings/checkin-candidates?roomId`** lista le prenotazioni dell'utente in quella stanza nelle prossime 24 ore + finestra di tolleranza, con la `config` (early / grace) — usata dalla pagina `/check-in/room/:id`.

- **Endpoint admin `GET /api/structure/rooms/:id/qr`** restituisce un PNG QR-code (libreria `qrcode`, 600×600, error correction `M`) che codifica `<FRONTEND_URL>/check-in/room/<id>`. L'admin lo stampa e lo affigge all'ingresso dell'aula; l'utente lo inquadra dal telefono.

- **Pagina pubblica autenticata `/check-in/room/:id`** mostra le prenotazioni dell'utente nella stanza con phase calcolata client-side (`tooEarly` / `open` / `tooLate` / `done`) e bottone "Conferma presenza" abilitato solo nella finestra valida.

- **Scheduler** (`reminderScheduler.js → tickGhostCancel`) integrato nel tick da 5 min: se `now > startTime + GHOST_GRACE_MINUTES` e `checkedInAt=null` e `autoCancelledAt=null`, transiziona la booking a `status='cancelled'` con `cancelReason='auto: ghost booking'` e invia email kind `ghost_cancellation`.

- **UI**:
  - Dashboard mostra una card "Check-in richiesto" sopra le KPI per booking imminenti senza checkedInAt
  - MyBookings mostra un badge ambra "Senza check-in" sui booking passati senza conferma
  - Admin Structure → dialog Aula → pulsante "Stampa QR aula" che scarica il PNG

- **Variabili d'ambiente**:
  - `CHECKIN_EARLY_MINUTES` (default 5) — quanto prima dell'inizio si può fare check-in
  - `GHOST_GRACE_MINUTES` (default 15) — finestra di tolleranza dopo l'inizio prima dell'auto-cancel
  - `FRONTEND_URL` — usato per costruire l'URL del QR (fallback al dominio della richiesta)

## 6-ter. Modulo Prestiti Strumenti (instrument loans)

Il modulo gestisce l'inventario degli strumenti musicali e il ciclo di vita di un prestito (richiesta → approvazione → restituzione), parallelo ma indipendente dalle prenotazioni di aule.

### Modelli

- **Instrument** — `code` (unico), `name`, `family` (ENUM: `archi · fiati_legni · fiati_ottoni · tastiere · percussioni · corde · voce · elettronica · altro`), `brand`, `model`, `serialNumber`, `condition` (ENUM: `ottimo · buono · discreto · da_riparare · fuori_uso`), `isLoanable`, `allowedCourseIds[]` (whitelist per corso, `[]` = permissivo), `notes`, `photoUrl`. Soft-delete (`paranoid: true`).
- **InstrumentLoan** — `instrumentId`, `userId`, `fromDate` (DATEONLY), `toDate` (DATEONLY), `status` (ENUM: `requested · active · returned · overdue · rejected`), `notes`, `approvedBy`, `approvedAt`, `returnedAt`, `reminderSentAt` (marker T-2gg), `overdueNotifiedAt` (marker primo overdue). Indici su `userId+status`, `instrumentId+status`, `status+toDate`.
- **InstrumentLoanRule** — una regola per `family` (PK), con `allowedCourseIds[]` (whitelist corsi che possono richiedere prestiti per quella famiglia).
- **InstrumentLoanQuota** — cap per ruolo + scope (`global | family | instrument`): `maxConcurrent` (numero di prestiti contemporanei) e `maxDaysPerYear` (giorni cumulati negli ultimi 365gg). `>0` attiva il cap.

### Flusso di stati

```
        request                approve
  [— ] ──────────► [requested] ──────► [active] ──┬──► [returned]
                       │                          │   (utente o admin)
                       │ reject                   │
                       ▼                          │ scheduler T+1
                  [rejected]                      ▼
                                              [overdue]
                                                  │ return
                                                  ▼
                                              [returned]
```

Lo scheduler (`reminderScheduler.tickLoans`, ogni 5 min) gestisce due transizioni automatiche:

- **Reminder T-2gg** — `status='active'`, `toDate ∈ [today+1, today+2]`, `reminderSentAt=null` → invia `loan_reminder` e marca `reminderSentAt`.
- **Overdue** — `status='active'`, `toDate < today`, `overdueNotifiedAt=null` → setta `status='overdue'`, invia `loan_overdue`, marca `overdueNotifiedAt`.

### Endpoint REST

- `GET /api/instruments` — lista con filtri `q`, `family`, `loanable`; annota `currentLoanStatus`/`currentLoanUntil`/`userAllowedForFamily`.
- `GET/POST/PUT/DELETE /api/instruments/:id` — CRUD admin.
- `POST /api/instruments/:id/photo` — upload foto resize sharp 1200×675 webp (pattern identico a `routes/structure.js`).
- `GET /api/instruments/export` · `POST /api/instruments/import` — CSV (idempotente, match per `code` o composta).
- `GET /api/loans/mine` — i propri prestiti.
- `GET /api/loans` (admin) · `GET /api/loans/overdue` (admin) · `GET /api/loans/expiring?days=N` (admin).
- `POST /api/loans` — richiesta utente. Validazioni: `fromDate >= today`, `toDate >= fromDate`, `instrument.isLoanable`, `condition ∉ {fuori_uso, da_riparare}`, `allowedCourseIds` (regola per strumento e per famiglia), conflitto overlap su `requested|active|overdue`, quote (`loanQuotaValidator.checkLoanQuotas`). Codici errore: `LOAN_INVALID_DATE`, `LOAN_CONFLICT`, `INSTRUMENT_NOT_LOANABLE`, `INSTRUMENT_NOT_ALLOWED_FOR_COURSE`, `LOAN_QUOTA_EXCEEDED_*`.
- `POST /api/loans/:id/approve` · `/reject` (admin) · `/return` (proprietario o admin).
- `DELETE /api/loans/:id` — cancella richiesta `requested` (utente) o pulizia (admin).
- `GET /api/loans/:id/pdf?kind=delivery|return` — modulo PDF streaming via `pdfkit` (header istituto, blocco strumento/consegnatario/periodo, due box firma).
- `GET/PUT/DELETE /api/admin/instrument-loan-rules/:family` — CRUD whitelist per famiglia.
- `GET/POST/PUT/DELETE /api/admin/instrument-loan-quotas` — CRUD quote.

### Email transazionali

6 nuovi `kind` aggiunti a `services/mailTemplateDefaults.js` con stesso engine `templateRenderer`:
`loan_requested`, `loan_approved`, `loan_rejected`, `loan_returned`, `loan_reminder`, `loan_overdue`. Auto-seedati al primo `getTemplate(kind)`; modificabili dal pannello Admin → Mail. Rispetta `user.emailNotifications` come master switch.

### Frontend

- `pages/Instruments.tsx` — directory utente con filtri (q · family · solo prestabili) + dialog "Richiedi prestito".
- `pages/MyLoans.tsx` — tabs (in_corso · in_attesa · storico) con azioni: restituisci, annulla richiesta, scarica PDF (delivery/return) via fetch+blob autenticato.
- `pages/admin/Instruments.tsx` — 5 tab: Inventario · Tutti i prestiti · Scaduti · In scadenza (2gg) · Regole prestito.
- `components/admin/InstrumentFormDialog.tsx` · `InstrumentLoanRulesTab.tsx` · `LoanQuotasManager.tsx` · `InstrumentsCsvImportDialog.tsx`.
- `pages/Dashboard.tsx` — sezione "I miei prestiti" + tile stats condizionale visibili solo se l'utente ha almeno un prestito attivo o in attesa (empty-silent come `WaitlistDashboardCard`).
- API: `frontend/src/api/instruments.ts` (`instrumentsApi`, `loansApi`, `loanRulesApi`).
- Asset fallback: `public/assets/instrument-default.svg`.
- i18n: namespace `instruments.*`, `instrument_families.*`, `instrument_conditions.*`, `loans.status.*`, `my_loans.*`, `admin.instruments.*`, `loan_request_dialog.*`, `errors.code.LOAN_*` / `INSTRUMENT_*`, `emails.loan_*`. Stesso shape su it/en/es.

### Test

- Backend: `tests/integration/instrumentLoans.test.js` (17 test: lifecycle + edge cases) e `loanQuotas.test.js` (CRUD + enforcement quote).
- E2E: `e2e/tests/instrument-loan.spec.ts` — flusso completo studente→admin→studente (request → approve → return).

## 7. Aree funzionali

| Area                       | Descrizione                                                                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Autenticazione**         | Login/registrazione email + Google/Microsoft OAuth; password con bcrypt; reset profilo                                                                                                                                              |
| **Dashboard**              | KPI personali (prenotazioni attive · ore settimana · aule · prossima sessione); calendario multi-aula (orario × aula); lista prossime prenotazioni; card "I miei prestiti" condizionale (visibile solo con loan attivi o in attesa) |
| **Prenotazione**           | Selettore aula + data; calendario giornaliero 7-23 con slot 30 min; click su slot libero apre modal di creazione; validazione lato server (regole per ruolo)                                                                        |
| **Le mie prenotazioni**    | Vista con tabs (future · passate · annullate · tutte) e azione di cancellazione                                                                                                                                                     |
| **Aule**                   | Directory ricercabile con tipologia, capienza, dotazioni per aula                                                                                                                                                                   |
| **Profilo**                | Anagrafica modificabile · cambio password · (admin) editor copyright dell'app                                                                                                                                                       |
| **Admin · Utenti**         | Tabella con ricerca/filtri, CRUD, bulk select                                                                                                                                                                                       |
| **Admin · Corsi**          | Tab Corsi (tabella + ricerca + filtri + CSV import + bulk-delete) e tab Livelli (catalogo gestibile)                                                                                                                                |
| **Admin · Struttura**      | Tab Sedi (tree istituti → edifici → aule → strumenti) con CSV import; tab Dotazioni (catalogo riusabile + CSV 1-colonna)                                                                                                            |
| **Admin · Regole**         | Tabs per ruolo: limiti su volumi · durata · anticipo · fasce orarie                                                                                                                                                                 |
| **Display kiosk**          | Pagina pubblica `/display` per monitor: KPI live, agenda 8-20 per sede in tabella, polling 30-60s, fullscreen + cursore auto-hide                                                                                                   |
| **Internazionalizzazione** | UI tradotta in **italiano (default)**, **inglese** e **spagnolo**; selettore lingua nel topbar; persistenza preferenza in localStorage; messaggi di errore backend mappati via `error.code`                                         |

## 7-bis. Internazionalizzazione (i18n)

L'applicazione supporta **3 lingue**: italiano (`it`), inglese (`en`), spagnolo (`es`).

### Stack

- `i18next` + `react-i18next` come motore di traduzione e binding React
- `i18next-browser-languagedetector` per il rilevamento automatico (priorità: localStorage → navigator → htmlTag) e la persistenza
- `dayjs` agganciato al cambio lingua per formattare date/orari nel locale corrente

### File chiave

```
frontend/src/
├── i18n/
│   ├── index.ts             → bootstrap di i18next (importato in main.tsx)
│   └── locales/
│       ├── it.json          → traduzioni italiano (default)
│       ├── en.json          → traduzioni inglese
│       └── es.json          → traduzioni spagnolo
└── components/
    └── LanguageToggle.tsx   → selettore lingua (icona Globe) usato in AuthLayout, Login, AppLayout
```

### Convenzioni di chiave

Le chiavi sono **semantiche e gerarchiche**, raggruppate per area funzionale:

| Namespace                                                           | Esempio                                                    | Quando usarlo                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------ |
| `common.*`                                                          | `common.save`, `common.cancel`                             | Pulsanti / azioni condivisi    |
| `nav.*`                                                             | `nav.dashboard`                                            | Voci del menu di navigazione   |
| `roles.*`, `user_status.*`                                          | `roles.docente`, `user_status.pending`                     | Etichette per enum del modello |
| `auth.<page>.*`                                                     | `auth.login.title`, `auth.complete_profile.subtitle`       | Pagine di autenticazione       |
| `dashboard.*`, `my_bookings.*`, `booking.*`, `rooms.*`, `profile.*` | `booking.form.purpose_placeholder`                         | Pagine principali              |
| `admin.<area>.*`                                                    | `admin.users.delete_title`, `admin.structure.no_buildings` | Pagine amministratore          |
| `errors.code.*`                                                     | `errors.code.BOOKING_CONFLICT`                             | Mappatura `error.code` backend |

### Cambio lingua

- Selettore `LanguageToggle` (icona globo) nel topbar dell'app autenticata e nell'AuthLayout (login/registrazione/completamento profilo)
- La preferenza è persistita in `localStorage` con chiave `conservatory_lang`
- Al cambio lingua: i18next aggiorna le traduzioni, dayjs ricarica il locale corrispondente, `<html lang="…">` viene aggiornato

### Validazioni form

Le validazioni Zod usano **chiavi** (es. `'password_min'`) invece di stringhe: i componenti le risolvono via `t(\`auth.validation.\${key}\`)` al momento del render. Questo permette ai messaggi di errore di reagire al cambio lingua senza ri-validare il form.

### Errori del backend (error codes)

Gli endpoint che possono fallire con un errore semanticamente noto restituiscono un `error.code` univoco e stabile, oltre al messaggio leggibile:

```json
{
  "error": "Esiste già un account con questa email",
  "code": "EMAIL_ALREADY_REGISTERED"
}
```

Sul frontend, `httpErrorMessage(err)` (in `lib/api.ts`) controlla la presenza di `code` e cerca la traduzione in `errors.code.<CODE>`. Se la chiave non è presente in i18n, ricade sul messaggio testuale del backend.

**Catalogo dei codici principali** (vedi `errors.code.*` nei file di traduzione):

| Code                                 | Significato                                                  |
| ------------------------------------ | ------------------------------------------------------------ |
| `INVALID_CREDENTIALS`                | Login fallito (email/password errate)                        |
| `ACCOUNT_DISABLED`                   | Account `isActive=false`                                     |
| `ACCOUNT_PENDING`                    | Docente non ancora approvato dall'admin                      |
| `ACCOUNT_REJECTED`                   | Account rifiutato dall'admin                                 |
| `OAUTH_ONLY`                         | Account creato via OAuth, password non impostata             |
| `OAUTH_NOT_CONFIGURED`               | Provider OAuth non configurato sul server                    |
| `EMAIL_ALREADY_REGISTERED`           | Email già usata                                              |
| `MATRICOLA_ALREADY_USED`             | Matricola già assegnata                                      |
| `MATRICOLA_REQUIRED`                 | Studente: matricola obbligatoria al completamento profilo    |
| `COURSE_REQUIRED` / `COURSE_INVALID` | Corso mancante o inattivo                                    |
| `INCOMPLETE_PROFILE`                 | Profilo non completato (manca matricola/corso)               |
| `WRONG_PASSWORD`                     | Password attuale errata in cambio password                   |
| `BOOKING_CONFLICT`                   | Slot già prenotato                                           |
| `BOOKING_INVALID`                    | Validazione regole di prenotazione fallita (vedi `issues[]`) |
| `RECURRING_NOT_ALLOWED`              | Ruolo senza diritti su prenotazioni ricorrenti               |
| `USER_NOT_FOUND` / `NOT_FOUND`       | Risorsa non trovata                                          |
| `CANNOT_DELETE_SELF`                 | Tentativo di auto-eliminazione                               |
| `FK_CONSTRAINT`                      | Vincolo di integrità che impedisce DELETE                    |
| `INVALID_TOKEN`                      | JWT/iCal token non valido                                    |
| `VALIDATION_FAILED`                  | Validazione body di una richiesta                            |

> **Nota implementativa**: il `bookingValidator` interno restituisce ancora messaggi testuali italiani in `issues[]`; questi vengono mostrati come dettaglio sotto al messaggio principale. Per una localizzazione completa di queste regole granulari (durata min/max, anticipo min/max, finestra oraria, ecc.) sarà necessario migrare il validator a un modello a `code+params` come gli altri endpoint. È documentato come miglioria futura.

### Estendere a una nuova lingua

1. Crea `frontend/src/i18n/locales/<code>.json` copiando `it.json` e traducendo i valori
2. Aggiungi il `code` a `SUPPORTED_LANGUAGES` e `LANGUAGE_NAMES` in `i18n/index.ts`
3. Importa il locale dayjs corrispondente (`import 'dayjs/locale/<code>';`)
4. Aggiorna `frontend/src/components/LanguageToggle.tsx` (auto-iterando `SUPPORTED_LANGUAGES` non serve nessuna modifica)

### Stato della migrazione

La migrazione i18n è stata applicata in modo prioritario alle aree user-facing principali: **Auth completa** (Login/Register/CompleteProfile/PendingApproval/OAuthCallback/AuthLayout), **AppLayout/topbar/menu utente**, **Dashboard, MyBookings, Booking, Rooms, NotFound, CalendarSubscription, BookingFormDialog, Type/StatusBadge, MultiRoomTimetable**, **Admin Users e Admin Structure** (header e azioni). Pagine admin più dense (`Profile`, `Display`, `admin/Rules`, `admin/MailSettings`, `admin/Courses` e i dialog CRUD interni: `UserFormDialog`, `RoomFormDialog`, `CourseFormDialog`, `EquipmentFormDialog`, `MailTemplateEditor`, `CsvImportDialog`, ecc.) contengono ancora stringhe italiane hard-coded da estrarre con lo stesso pattern: `useTranslation()` + `t('namespace.key')` con chiavi aggiunte in `it.json`/`en.json`/`es.json`.

## 8. Personalizzazione

L'app è multi-tenant-ready a livello logico: tutti i dati specifici dell'istituto sono in `Institute`. Un admin può configurare via UI:

- **Logo istituto** (caricato come data-URL base64 in `Institute.logoUrl`)
- **Nome, città, indirizzo, descrizione**
- **Copyright** mostrato in fondo a tutte le pagine (Profilo → sezione admin)
- **Tema chiaro / scuro / sistema** (per-utente, persistito in localStorage)
- **Catalogo livelli di studio** (Triennio, Biennio, Master, ...)
- **Catalogo dotazioni** (lista riusabile per pre-compilare gli strumenti per aula)
- **Regole di prenotazione** per ciascun ruolo

## 9. UI / UX e identità visiva

- **Tipografia**: Inter unico, distinzione solo via peso (`font-normal` 400 · `font-medium` 500 · `font-semibold` 600 · `font-display` 700 con tracking ridotto)
- **Colore brand istituto**: `rgb(55 98 170)` per nome dell'istituto in topbar e login
- **Brand app**: "Cadenza" a due toni (Aula soft / Book primary semibold) + icona `icona.png`
- **Tema**: variabili CSS HSL per tutti i colori semantici (background, foreground, primary, muted, ...) con override `.dark`
- **Animazioni**: Framer Motion per transizioni di pagina, AnimatePresence per dialog/dropdown
- **Sfondo login**: immagine architettonica `sfondo.png` con overlay traslucido + leggera sfocatura
- **Aforismi musicisti**: rotatore di 15 citazioni nella card di login (Nietzsche, Beethoven, Busoni, Mozart, ...)

## 10. Esecuzione

### Sviluppo

```bash
# Backend (porta 3000)
cd backend
npm install
npm run dev

# Frontend (porta 5173, proxy /api → :3000)
cd frontend
npm install
npm run dev
```

### Produzione

```bash
cd frontend && npm run build       # outputs to frontend/dist
cd backend && npm start             # serves API + dist
```

### Comandi utili

- `npm run db:migrate` (backend) → `DB_SYNC_MODE=alter` per applicare modifiche allo schema
- `npm run seed` (backend) → re-seed admin + livelli + regole

---

# 🇬🇧 English

## 1. Overview

**Cadenza** is a full-stack web application for managing room bookings at a Music Conservatory. Students, teachers and administrators can book practice studios, rehearsal rooms, concert halls and lecture rooms, with role-based rules and a public "kiosk" view for in-building monitors.

The application is organized as a **monorepo** with two modules:

```
Cadenza/
├── backend/          → Node.js/Express + Sequelize REST API
├── frontend/         → React + TypeScript + Vite SPA
└── docs/             → Documentation (this file)
```

In production the backend serves both `/api/*` endpoints and the built React bundle (`frontend/dist/`), acting as a single web server.

## 2. Tech stack

### Backend

| Technology        | Role                                                |
| ----------------- | --------------------------------------------------- |
| Node.js ≥ 18      | Runtime                                             |
| Express 4         | HTTP framework                                      |
| Sequelize 6       | ORM (SQLite default · supports Postgres / MySQL)    |
| Passport          | Auth strategies (local · Google OAuth2 · Microsoft) |
| bcryptjs          | Password hashing                                    |
| jsonwebtoken      | Signed JWT                                          |
| express-validator | Input validation                                    |
| dayjs             | Date / timezone handling                            |

### Frontend

| Technology            | Role                                            |
| --------------------- | ----------------------------------------------- |
| React 18 + TypeScript | UI                                              |
| Vite                  | Build tool / HMR dev server                     |
| Tailwind CSS 3        | Utility-first design system                     |
| shadcn/ui (Radix UI)  | Accessible primitives (Dialog, Select, Tabs, …) |
| Framer Motion         | Transition animations                           |
| Lucide React          | Vector icons                                    |
| TanStack Query        | Server state cache & sync                       |
| React Router v6       | Client-side routing                             |
| React Hook Form + Zod | Forms & validation                              |
| Sonner                | Toast notifications                             |
| Inter                 | Single typeface (weight-differentiated styles)  |

## 3. Data models

### Main entities

```
Institute (1)──(N) Building (1)──(N) Room (1)──(N) Equipment
                                          │
                                          └──(N) Booking ──(N) User
                                                 │
                                                 └─ status, type, ...

Course ──(N) User (matricola, courseId)
CourseLevel        ── code referenced by Course.levels[]
EquipmentTemplate  ── reusable equipment catalog
BookingRule        ── 1 record per role (student/teacher/admin)
```

### Models

- **User** — `email`, `passwordHash`, `firstName/lastName`, `role` (`admin`/`docente`/`studente`), `matricola`, `courseId`, `googleId`, `microsoftId`, `isActive`, `lastLogin`
- **Course** — `code` (unique), `name`, `department`, `levels` (array of dynamic string codes), `description`, `isActive`
- **CourseLevel** — study levels catalog: `code`, `name`, `sortOrder`
- **Institute** — `name`, `code`, `address`, `city`, `country`, `logoUrl` (base64 data URL), `copyright` (app footer text)
- **Building** — `instituteId`, `name`, `floors[]`, `address`
- **Room** — `buildingId`, `name`, `floor`, `capacity`, `type` (studio · rehearsal · concert hall · classroom · lecture hall), `allowedRoles[]`, `allowedCourseIds[]`, `isBookable`
- **Equipment** — `roomId`, `name`, `type`, `brand`, `model`, `quantity`, `isWorking`
- **EquipmentTemplate** — equipment catalog: `name` (unique), `type`
- **Booking** — `userId`, `roomId`, `startTime`, `endTime`, `purpose`, `type` (individual_study · lesson · rehearsal · concert · other), `status` (confirmed · cancelled · completed · no_show)
- **BookingRule** — one record per role: `maxActiveBookings`, `maxHoursPerWeek`, `maxHoursPerDay`, `min/maxBookingDurationMinutes`, `min/maxAdvance...`, `cancellationDeadlineHours`, `allowed/Start/EndTime`, …

## 4. Authentication & authorization

- **JWT** signed server-side (`HS256`), stored in `localStorage`
- **Strategies**: email + password (Passport local) · Google OAuth2 · Microsoft OAuth
- **Roles**: `admin` / `docente` / `studente`
- **Complete profile**: for non-admin users, certain actions require `matricola` and `courseId` to be set (enforced by `requireCompleteProfile` middleware)
- **Public endpoints** (no auth): `/api/auth/*`, `/api/courses` (list), `/api/course-levels`, `/api/structure/institutes/public`, `/api/public/*` (for kiosk display)
- **Admin-only routes** protected by `requireRole('admin')` middleware

Frontend has three wrappers:

- `<PublicOnlyRoute>` — redirect to dashboard if already logged in (login, register)
- `<ProtectedRoute>` — requires auth, optionally complete profile
- `<RequireAdmin>` — inner guard for `/admin/*` routes

## 5. Backend architecture

```
backend/
├── server.js          → Express bootstrap + DB sync + seed
├── config/database.js → Sequelize instance
├── models/            → one file per model + index.js (relations)
├── routes/            → one file per area (auth, users, courses, …)
├── middleware/auth.js → authenticate, requireRole, requireCompleteProfile
├── services/
│   ├── bookingValidator.js → rule validation before insert/update
│   └── structureImporter.js → CSV import parser for sites
└── seeders/initial.js → default admin + 5 levels + base rules
```

Main endpoints:

- `POST /api/auth/login` · `POST /api/auth/register` · OAuth flow
- `GET /api/auth/me` · `PATCH /api/auth/me` · `POST /api/auth/change-password`
- `GET/POST/PUT/DELETE /api/users` (admin)
- `/api/courses` + `/import` + `/bulk-delete`
- `/api/course-levels` (CRUD + bulk-delete)
- `/api/structure/institutes|buildings|rooms|equipment|equipment-templates` (CRUD + bulk + CSV import)
- `/api/rules/:role` (admin) · `/api/bookings` · `/api/bookings/availability/:roomId`
- `/api/public/agenda` · `/api/public/stats` · `/api/public/institute` (kiosk)

## 6. Frontend architecture

```
frontend/src/
├── main.tsx           → Provider tree (Theme · QueryClient · Router · Auth · Toaster)
├── App.tsx            → Route definitions
├── pages/             → One folder per area: auth, admin, Display, Profile, …
├── components/
│   ├── ui/            → shadcn primitives (Button, Card, Dialog, …)
│   ├── layout/        → AppLayout (sidebar + topbar) · AuthLayout
│   ├── bookings/      → BookingFormDialog · CancelBookingDialog · DayCalendar · MultiRoomTimetable
│   └── admin/         → CRUD form dialogs (Users, Courses, Levels, Structure, Equipment, Rules)
├── contexts/
│   ├── AuthContext    → current user, login/logout, refresh
│   └── ThemeContext   → light / dark / system + persistence
├── api/               → one module per area (auth, courses, structure, …)
├── lib/
│   ├── api.ts         → fetch wrapper with JWT + error handling
│   ├── date.ts        → dayjs setup with "it" locale + helpers
│   ├── bookings.ts    → labels & color mapping for types/statuses
│   └── utils.ts       → cn() for className merging
├── hooks/useFullscreen.ts → fullscreen API + idle (for kiosk Display)
└── types/index.ts     → All shared TypeScript interfaces
```

### Routing

```
Public routes:
  /login              → Login (OAuth + email form)
  /register           → Registration
  /oauth/callback     → OAuth callback
  /display            → Public kiosk monitor

Protected routes (ProtectedRoute):
  /complete-profile   → Profile completion (no requirement)
  /dashboard          → Home with KPIs + timetable + upcoming
  /booking            → Room + day selector + 30-min grid
  /my-bookings        → Tabs future/past/cancelled/all
  /rooms              → Rooms directory
  /profile            → Personal info + password change + (admin) copyright

Admin routes (RequireAdmin):
  /admin/users        → User CRUD
  /admin/courses      → Tabs Courses / Levels (CRUD + CSV + bulk)
  /admin/structure    → Tabs Sites / Equipment catalog (tree CRUD + CSV + bulk)
  /admin/rules        → Booking rules per role
```

## 7. Functional areas

| Area                     | Description                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication**       | Email login/register + Google/Microsoft OAuth; bcrypt passwords; profile completion                                                                                             |
| **Dashboard**            | Personal KPIs (active bookings · weekly hours · rooms · next session); multi-room timetable (time × room); upcoming bookings list                                               |
| **Booking**              | Room + date selector; 7–23 daily calendar with 30-min slots; click on free slot opens create modal; server-side rule validation                                                 |
| **My bookings**          | Tabbed view (future · past · cancelled · all) with cancel action                                                                                                                |
| **Rooms**                | Searchable directory with type, capacity, per-room equipment                                                                                                                    |
| **Profile**              | Editable info · password change · (admin) app copyright editor                                                                                                                  |
| **Admin · Users**        | Table with search/filters, CRUD, bulk select                                                                                                                                    |
| **Admin · Courses**      | Courses tab (table + search + filters + CSV import + bulk-delete) and Levels tab (managed catalog)                                                                              |
| **Admin · Structure**    | Sites tab (tree institutes → buildings → rooms → equipment) with CSV import; Equipment-catalog tab (reusable list + 1-column CSV)                                               |
| **Admin · Rules**        | Per-role tabs: limits on volume · duration · advance booking · time windows                                                                                                     |
| **Kiosk display**        | Public `/display` page for monitors: live KPIs, 8–20 per-site agenda table, 30–60 s polling, fullscreen + auto-hide cursor                                                      |
| **Internationalization** | UI translated to **Italian (default)**, **English**, **Spanish**; language switcher in the topbar; preference persisted in localStorage; backend errors mapped via `error.code` |

## 7-bis. Internationalization (i18n)

The app supports **3 languages**: Italian (`it`), English (`en`), Spanish (`es`).

### Stack

- `i18next` + `react-i18next` as translation engine + React bindings
- `i18next-browser-languagedetector` for auto-detection (priority: localStorage → navigator → htmlTag) and persistence
- `dayjs` re-locales on language change for date/time formatting

### Key files

```
frontend/src/
├── i18n/
│   ├── index.ts             → i18next bootstrap (imported from main.tsx)
│   └── locales/
│       ├── it.json          → Italian translations (default)
│       ├── en.json          → English translations
│       └── es.json          → Spanish translations
└── components/
    └── LanguageToggle.tsx   → language picker (Globe icon) used in AuthLayout, Login, AppLayout
```

### Key conventions

Keys are **semantic and hierarchical**, grouped by functional area. Examples: `common.save`, `auth.login.title`, `booking.form.purpose_placeholder`, `admin.users.delete_title`, `errors.code.BOOKING_CONFLICT`.

### Backend error codes

Endpoints that fail with a semantically known error return a stable `error.code` plus the human-readable message:

```json
{
  "error": "An account already exists with this email",
  "code": "EMAIL_ALREADY_REGISTERED"
}
```

The frontend `httpErrorMessage(err)` (`lib/api.ts`) checks for `code` and looks up `errors.code.<CODE>` in i18n. If missing, it falls back to the backend message.

Main codes: `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED`, `ACCOUNT_PENDING`, `ACCOUNT_REJECTED`, `OAUTH_ONLY`, `OAUTH_NOT_CONFIGURED`, `EMAIL_ALREADY_REGISTERED`, `MATRICOLA_ALREADY_USED`, `MATRICOLA_REQUIRED`, `COURSE_REQUIRED`/`COURSE_INVALID`, `INCOMPLETE_PROFILE`, `WRONG_PASSWORD`, `BOOKING_CONFLICT`, `BOOKING_INVALID`, `RECURRING_NOT_ALLOWED`, `USER_NOT_FOUND`, `CANNOT_DELETE_SELF`, `FK_CONSTRAINT`, `INVALID_TOKEN`, `VALIDATION_FAILED`.

### Adding a language

1. Copy `frontend/src/i18n/locales/it.json` to `<code>.json` and translate values
2. Add the code to `SUPPORTED_LANGUAGES` and `LANGUAGE_NAMES` in `i18n/index.ts`
3. Import the matching dayjs locale (`import 'dayjs/locale/<code>';`)

### Migration status

i18n was applied with priority to user-facing pages: full **Auth flow**, **AppLayout/topbar/user menu**, **Dashboard, MyBookings, Booking, Rooms, NotFound, CalendarSubscription, BookingFormDialog, Type/StatusBadge, MultiRoomTimetable**, and **Admin Users / Admin Structure** (headers + actions). Larger admin pages (`Profile`, `Display`, `admin/Rules`, `admin/MailSettings`, `admin/Courses`) and CRUD dialogs (`UserFormDialog`, `RoomFormDialog`, `CourseFormDialog`, `EquipmentFormDialog`, `MailTemplateEditor`, `CsvImportDialog`, …) still contain hard-coded Italian strings to be extracted using the same pattern: `useTranslation()` + `t('namespace.key')` with new keys added to all three locale files.

## 8. Customization

The app is logically multi-tenant-ready: all institute-specific data lives in `Institute`. An admin can configure via UI:

- **Institute logo** (uploaded as base64 data URL in `Institute.logoUrl`)
- **Name, city, address, description**
- **Copyright** shown at the bottom of every page (Profile → admin section)
- **Light / dark / system theme** (per-user, localStorage-persisted)
- **Course levels catalog** (Triennio, Biennio, Master, …)
- **Equipment catalog** (reusable list to pre-fill per-room equipment)
- **Booking rules** for each role

## 9. UI / UX & visual identity

- **Typography**: Inter only, distinction by weight (`font-normal` 400 · `font-medium` 500 · `font-semibold` 600 · `font-display` 700 with tighter tracking)
- **Institute brand color**: `rgb(55 98 170)` for the institute name in the topbar and login
- **App brand**: "Cadenza" two-tone (Aula soft / Book primary semibold) + `icona.png` icon
- **Theme**: HSL CSS variables for all semantic colors (background, foreground, primary, muted, …) with `.dark` override
- **Animations**: Framer Motion for page transitions, AnimatePresence for dialogs/dropdowns
- **Login background**: architectural image `sfondo.png` with translucent overlay + slight blur
- **Musician aphorisms**: 15-quote rotator in the login card (Nietzsche, Beethoven, Busoni, Mozart, …)

## 10. Running the app

### Development

```bash
# Backend (port 3000)
cd backend
npm install
npm run dev

# Frontend (port 5173, /api proxied to :3000)
cd frontend
npm install
npm run dev
```

### Production

```bash
cd frontend && npm run build       # outputs to frontend/dist
cd backend && npm start             # serves API + dist
```

### Useful commands

- `npm run db:migrate` (backend) → `DB_SYNC_MODE=alter` to apply schema changes
- `npm run seed` (backend) → re-seed admin + levels + rules

---

_Document version · Cadenza — © 2026 Danilo Russo_
