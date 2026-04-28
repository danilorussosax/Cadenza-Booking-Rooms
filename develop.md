# Aula Book · Roadmap di sviluppo

> Aggiornato al **29 aprile 2026** · ultimo ciclo: "Bot messaging Telegram + adapter pluggable WhatsApp/Signal/Email".
> Documento operativo per il team di sviluppo. Il materiale strategico (mercato, pricing, go-to-market) è in [`/analisi.md`](../analisi.md). Il deck per i direttori è in [`docs/perDirettori.md`](docs/perDirettori.md).

---

## 0. Quick reference

- **Stato prodotto**: production-ready su PA italiana per le aree in scope (booking, eventi, kiosk, prestiti strumenti, GDPR).
- **Test**: 77/77 backend integration verdi + 4 E2E Playwright + 10 component test frontend + CI GitHub Actions.
- **Documentazione**: [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`SECURITY.md`](docs/SECURITY.md) · [`DEPLOY.md`](docs/DEPLOY.md) · [`BOT-MESSAGING.md`](docs/BOT-MESSAGING.md) · [`TESTING.md`](docs/TESTING.md) · [`install.md`](docs/install.md) · [`db-constraints.md`](docs/db-constraints.md) · [`BACKUP.md`](docs/BACKUP.md).
- **Stack**: Node 20 + Express + Sequelize, React 18 + Vite + Tailwind + shadcn/ui, Postgres 16 (SQLite per test), nginx + Let's Encrypt, Sentry opt-in, Workbox PWA.

**Legenda priorità**:

- 🔴 P0 — gap critico per parità con ASIMUT documentato
- 🟠 P1 — colma una lacuna funzionale concreta
- 🟢 P2 — nice-to-have, ROI dipende dal contesto
- 🔵 P3 — integrazioni esterne / regolatorio specialistico

**Stime effort**: **S** ≤ 1g · **M** 2-5g · **L** ≥ 1 settimana · **XL** ≥ 1 mese.

---

## 1. Cosa è già in produzione

Recap sintetico per orientarsi. Il dettaglio implementativo è nel codice e nei docs linkati sopra.

### 1.1 Core booking

- Self-service prenotazione aule (`/booking`, `/rooms`, `/my-bookings`)
- Validator SERIALIZABLE + EXCLUDE constraint Postgres (`bookings_no_overlap`) per anti-overlap garantito
- Approval workflow (`Room.requiresApproval` + status `pending_approval`) per sale concerti / auditorium
- Waitlist con claim window e auto-promote; iCal export con token
- Bulk operations admin: bulk-delete users/rooms/buildings/instruments/courses, bulk-approve users, bulk-cancel bookings con motivo broadcast email, bulk-toggle `isLoanable`

### 1.2 Inventario strumenti

- Modulo prestiti completo: `Instrument`, `InstrumentLoan` (5 stati: requested→active→returned + overdue/rejected)
- PDF consegna/restituzione (pdfkit), email transazionali (6 mail kind), scheduler reminder T-2gg + overdue auto
- Regole per famiglia/corso, quote per ruolo (3 scope), CSV import/export
- 17 test API integration + 1 E2E Playwright

### 1.3 Calendario settimanale + display kiosk

- `WeeklyRoomTimetable` aule × giorni Lun–Sab, asse del tempo orizzontale, 24 strisce verticali da 30' (08–20)
- Separatore giorni 3px slate-500/400 (ben distinto dai bordi orari)
- Etichette: `concerto` → titolo, `lezione` → "Prof. {cognome}", admin → "Direzione", docente → "Doc", studente → "Stud"
- Modalità `fillWidth` per kiosk (settimana intera senza scroll)
- Dashboard: prev/next week + bottone **Esporta PDF Settimanale** (browser-print A4 landscape, una pagina per edificio)
- Display kiosk: rotazione building / concerti / annunci con timer per-edificio, slide annunci con audience filter, banner "Connessione persa · ultimo aggiornamento HH:mm" (offline-soft via SW)

### 1.4 Bacheca avvisi & comunicazione

- `Announcement` con audience JSON (`{kind: 'all'|'role'|'course'|'building'}`)
- Pagina admin CRUD + slide kiosk + email opt-in al pubblico target
- 11 mail template editabili da `/admin/mail` (booking, loan, waitlist, approval, announcement)
- Mail server settings con cifratura AES-256-GCM su DB

### 1.5 Sicurezza & compliance

- Bcrypt cost 12, JWT 2h + `tokenVersion` (logout effettivo), rate limiting auth (login 5/15min, register 3/30min)
- **CSP** rigorosa (`useDefaults: false`), HSTS preload prod, COOP/CORP, Permissions-Policy restrittiva
- **2FA via codice email** (opt-in tutti, obbligatorio admin con grace 7gg): `/api/auth/2fa/{setup,verify,resend,recovery,disable}`, recovery codes 10 single-use
- **Sentry** backend+frontend con scrubbing PII ricorsivo + tagging anonimizzato SHA-256
- **Pacchetto GDPR-PA italiana** (Garante 06/2021): cookie banner, `UserConsent` append-only, export `/api/users/me/gdpr/export` (art. 20), delete-request con anonimizzazione (art. 17), re-consent gate al cambio versione policy, retention scheduler (audit 24 mesi), redact PII pino esteso

### 1.6 PWA

- `vite-plugin-pwa` + Workbox: precache 70 entries (~6 MB) + runtime cache SWR 5min agenda, CacheFirst 1h institutes, CacheFirst 7gg storage
- Manifest con icone PNG 192/512 + maskable (theme `#1a3367`)
- A2HS prompt dopo 2ª visita (Android/Chromium + iOS Safari fallback)
- SW con `registerType: 'prompt'` (toast Sonner "Aggiornamento disponibile")

### 1.7 Bot messaging

- 4 adapter (`telegram`, `whatsapp_cloud`, `signal_cli`, `email_imap`) — Telegram production-ready, gli altri scaffold pieno
- Webhook con HMAC verify (timing-safe), risposta 200 immediata + processing async
- Intent parser regole-based: `/help`, `/book` (wizard 3-step), `/list`, `/cancel`, `/check`. Riusa `bookingValidator` (no bypass rules/quote)
- Binding OTP 6 char alfanumerico (TTL 10 min), bcrypt hash, lookup user via "bind XXXXXX" sul canale
- `BotBinding` UNIQUE per (channel, externalId), `ChatSession` ephemeral con TTL 15 min, rate-limit 30/min + 200/giorno + cooldown 1h
- Audit log per ogni messaggio in/out (`target_type='ChatMessage'`)
- Pagina `/admin/messaging` con configurazione cifrata canali + test connessione
- Sezione `/profile · Bot messaging` per generare OTP / revocare binding
- 10 test integration su signature webhook + binding flow + rate limit

### 1.8 Activity Hub & dashboard admin

- `/admin/audit-log` come pagina tabbed in stile `/admin/rules`: Tab "Approvazioni" (bulk-cancel) + Tab "Registro attività"
- `/admin/analytics`: heatmap occupazione 7×24, top room/utente, no-show rate, trend ultime 8 settimane, export CSV+PDF
- `/admin/structure` (istituti/edifici/aule/equipment con CSV import per istituto)

### 1.9 Tooling, deploy, testing

- ESLint 9 flat + typescript-eslint `strictTypeChecked`, husky + lint-staged + commitlint, Conventional Commits
- Bundle splitting (vendor 879 KB → 207 KB, -76%) + lazy load pagine
- `scripts/install.sh` idempotente VPS Ubuntu 24.04 (modes: domain HTTPS / IP-only / IP self-signed); guida Hetzner in `docs/install.md`
- CI GitHub Actions backend + frontend + E2E gate

---

## 2. Roadmap residua (cosa resta da fare)

> Le sezioni "Lezioni 1-a-1" e "Group calendars" sono **escluse per scelta di prodotto** e non compaiono in roadmap.

### 🟠 2.1 Task management eventi (P1, gap ASIMUT documentato)

ASIMUT documenta "assign tasks to staff like technicians, stewards or catering". È l'unico gap funzionale documentato vs ASIMUT. Modulo nuovo: assegnazione task a membri staff con stati (todo/doing/done), checklist eventi, notifiche.

**Effort**: L (1-2 sett).

```prompt
Implementa Task management eventi:
1) Modello EventTask (id, bookingId/eventId, title, description, assigneeUserId,
   status enum 'todo'|'doing'|'done'|'cancelled', dueAt nullable, completedAt
   nullable, position INT per ordering, paranoid).
2) Model Event (opzionale): se bookingId di tipo concerto, le task sono
   associate al booking direttamente. Per eventi extra (es. masterclass)
   considerare model dedicato.
3) Routes /api/events/:bookingId/tasks (CRUD; assignee può essere admin o
   docente).
4) Pagina /admin/events o tab dentro pagina booking concerto:
   - lista task drag&drop (riordering)
   - filtro per assegnatario
   - bulk update status
5) Email notifiche: 'task_assigned' (al destinatario), 'task_due_soon' (T-1g),
   'task_overdue'.
6) Dashboard utente: card "Le mie task" con count + 3 più imminenti.
7) i18n IT/EN/ES. Documenta in docs/EVENTS.md.
```

---

### 🟢 2.2 Tuning/maintenance schedule (P2, verticale conservatorio)

Pianoforti vanno accordati periodicamente, archi vanno revisionati, sale richiedono manutenzione tecnica. Verticale specifico per conservatori.

**Effort**: M (3-5 gg).

```prompt
Implementa schedule manutenzione strumenti/aule:
1) Modello MaintenanceTask (id, scope ('room'|'equipment'|'instrument'),
   scopeId, type ('tuning'|'repair'|'inspection'|'cleaning'),
   scheduledFor, completedAt nullable, completedBy nullable, notes,
   recurringEveryDays).
2) Routes /api/admin/maintenance (CRUD admin).
3) Scheduler tick daily: 7gg prima di scheduledFor manda email kind
   'maintenance_due' all'admin email.
4) Card "Manutenzione in scadenza" su /admin/dashboard.
5) Vista /admin/maintenance: tabella + filtro per tipo.
6) Quando recurringEveryDays > 0: completare un task crea automaticamente
   il next (scheduledFor = oggi + N giorni).
7) Badge "Ultima accordatura: X giorni fa" sulla card aula in /rooms (admin).
8) i18n IT/EN/ES.
```

---

### 🟢 2.3 Booking templates + favorites (P2)

Pattern UX moderno (Robin/Skedda): "il mio slot solito" → 1 click prenota.

**Effort**: S-M (2-3 gg).

```prompt
Aggiungi booking templates a Aula Book:
1) Modello BookingTemplate (userId, name, roomId, dayOfWeek 0-6,
   startMinutes, durationMinutes, type, purpose, isFavorite).
   UNIQUE (userId, name).
2) Routes /api/bookings/templates (CRUD per utente).
3) UI:
   - Pulsante "Salva come template" su BookingFormDialog
   - Section su Dashboard "Quick book" con i 3 template favoriti:
     1-click calcola la prossima occorrenza del dayOfWeek e crea booking
4) Validation: template usa la BookingRule del ruolo come al solito.
5) i18n IT/EN/ES.
```

---

### 🟢 2.4 Push notifications Web Push API (P2)

Complemento al 2FA email + email transazionali; riduce dipendenza SMTP per le notifiche di promemoria.

**Effort**: M (3-5 gg).

```prompt
Implementa push notifications via Web Push API:
1) Backend: install web-push npm. ENV VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
   VAPID_SUBJECT (es. mailto:dpo@conservatorio.it).
2) Modello PushSubscription (userId, endpoint UNIQUE, keys JSON,
   userAgent, createdAt).
3) Routes:
   - POST /api/users/me/push-subscriptions
   - DELETE /api/users/me/push-subscriptions/:id
4) services/pushService.js: sendPushNotification({user, kind, payload}).
5) Trigger push (parallelo a email) per: booking_confirmed,
   booking_reminder (1h prima), booking_cancelled, claim_waitlist,
   loan_overdue.
6) Frontend: pagina Profile aggiunge sezione "Notifiche push" con
   pulsante "Attiva" che chiama navigator.serviceWorker +
   Notification.requestPermission + register subscription.
7) Toggle granulari paralleli a notifyOnConfirmation/Reminder/Cancellation.
8) i18n IT/EN/ES.
```

---

### 🟢 2.5 Embed iframe per concerti pubblici (P2)

ASIMUT documenta "publish event info directly to your website" senza dettagli. L'iframe è la soluzione standard.

**Effort**: S (1-2 gg).

```prompt
Implementa embed pubblico concerti:
1) Route GET /embed/concerts con SSR-style HTML standalone (NO React app),
   query params ?building=X&from=&to=&theme=light|dark.
2) Header X-Frame-Options: ALLOWALL solo su /embed/* (CSP frame-ancestors *).
3) Stile minimale + responsive: card per concerto con titolo, data,
   edificio, esecutori. Design "neutro" per integrarsi in qualunque sito.
4) Documentazione: <iframe src="https://aulabook.example.it/embed/concerts" />.
5) Cache pubblica 5 minuti (Cache-Control: public, max-age=300).
```

---

### 🟢 2.6 Privacy granulare display (P2)

Quick win per kiosk: alcuni edifici potrebbero richiedere di nascondere i nomi.

**Effort**: S (mezza giornata).

```prompt
Aggiungi privacy granulare al display kiosk:
1) Building.displayShowNames (BOOL default true) — toggle per-building.
2) routes/public.js#agenda: rispetta flag → bookedBy: null se false.
3) UI in /admin/display: toggle "Mostra nomi sul display" accanto agli altri.
4) i18n IT/EN/ES.
```

---

### 🟢 2.7 Card "Avvisi" su Dashboard utente (P2)

Gap residuo § 1.4 — gli avvisi pertinenti non hanno un punto d'accesso sulla home utente.

**Effort**: S (mezza giornata).

```prompt
Aggiungi card "Avvisi" su Dashboard utente:
1) Query /api/announcements filtered per profilo (audience match).
2) Card con i 3 più recenti non scaduti, link "vedi tutti" → /announcements.
3) Badge "nuovi" sui non ancora letti (richiede UserAnnouncementSeen
   table per tracking, OR usare localStorage per soluzione client-side).
4) Empty-silent: non mostrare se nessun avviso pertinente.
```

---

### 🟢 2.8 Report email periodici al direttore + comparazione YoY (P2)

Estensione analytics: invio mensile via email al direttore con KPI mensili + grafico anno-su-anno.

**Effort**: M (3-5 gg).

```prompt
Estendi analytics con report periodici e comparazione anno-su-anno:
1) Scheduler cron mensile: il 1° del mese alle 08:00 manda email
   'analytics_monthly_report' agli admin con isMonthlyReportRecipient=true.
2) Email contiene PDF allegato (pdfkit) con KPI: prenotazioni mese,
   ore totali, top 5 aule, top 5 utenti (anonimizzato), no-show rate.
3) Pagina /admin/analytics: aggiungi tab "Anno su anno" con bar chart
   comparativo dei 12 mesi correnti vs 12 mesi precedenti.
4) Toggle "Ricevi report mensile" su /profile (solo admin).
5) i18n IT/EN/ES.
```

---

### 🔵 2.9 SPID/CIE login (P3 — sblocca PA italiana fascia alta)

Critico per accreditamento bandi PNRR e per i conservatori grandi che lo richiedono per policy interna.

**Effort**: L (3-4 sett dev + 2-3 mesi processo AgID per service provider registration).

```prompt
Aggiungi login SPID/CIE a Aula Book:
1) Install spid-passport (o equivalente certificato AgID).
2) Configura metadata SPID (entityID, contactPerson, organizationName)
   gestiti via UI /admin/oauth-settings (sezione SPID).
3) Endpoint /api/auth/spid/login + /api/auth/spid/callback.
4) Mapping attributi SPID → User.firstName/lastName/email/codiceFiscale.
5) Auto-creazione utente al primo login con role='studente' +
   status='pending' (admin approva come per gli altri OAuth).
6) Login button SPID + CIE su /login con design AgID-compliant
   (icone ufficiali, colori istituzionali).
7) Documenta in docs/SPID.md la procedura di certificazione AgID
   (registrazione service provider, metadata, test in pre-prod).
```

---

### 🔵 2.10 PEC integration (P3 — obbligo PA per comunicazioni ufficiali)

```prompt
Aggiungi supporto PEC a Aula Book:
1) Estendi MailSettings con flag `isPec` + `pecProvider`
   (Aruba, Legalmail, InfoCert).
2) Quando isPec=true, le email "ufficiali" (es. approvazione iscrizione,
   cancellazione, comunicazioni amministrative) usano il transporter PEC
   invece dello standard.
3) Mark email kind 'official' in mailTemplateDefaults: vanno SEMPRE
   via PEC se configurata.
4) UI admin: toggle "Usa PEC per comunicazioni ufficiali" in /admin/mail.
```

**Effort**: M (3-5 gg).

---

### 🔵 2.11 Conservazione sostitutiva PA (P3 — obbligo doc. ufficiali)

```prompt
Implementa conservazione sostitutiva:
1) Per ogni PDF generato (loan delivery/return, report mensili,
   audit export):
   - Calcola SHA-256
   - Firma digitale con certificato istituzionale (env CERT_P12_PATH)
   - Marca temporale RFC 3161 via TSA pubblica
     (es. timestamp.entrust.com)
   - Salva in storage append-only (S3 versioning ON, tag legal:hold)
2) Modello LegalDocument (originalHash, signedPdfPath, timestampedAt,
   archivedAt, retentionUntil, type).
3) Endpoint /api/admin/legal-documents per ricerca + download.
4) Documenta procedure DPO per audit AgID.
```

**Effort**: L (1-2 sett, richiede certificato firma + provider TSA).

---

### 🔵 2.12 Export ANIS / MIUR statistiche (P3 — adempimento AFAM)

```prompt
Aggiungi export ANIS/MIUR:
1) Route /api/admin/exports/anis?year=YYYY restituisce JSON conforme
   allo schema ANIS richiesto dal MIUR per l'AFAM.
2) Aggrega: numero studenti per corso/livello, ore studio aule,
   occupancy media, prestiti strumenti effettuati.
3) UI in /admin/analytics tab "Export PA" con bottoni anno-per-anno.
4) Documenta lo schema ANIS in docs/EXPORT-ANIS.md
   (link al portale MIUR).
```

**Effort**: M-L.

---

### 🔵 2.13 Sync anagrafiche scolastiche (P3 — sblocca conservatori grandi)

Integrazione con sistemi gestionali studenti (Esse3, Isidata, Spaggiari).

**Effort**: L+ per ogni provider (richiede credenziali / contratto).

```prompt
Crea adapter pluggable per sync anagrafiche scolastiche:
1) backend/services/integrations/<provider>.js con interfaccia comune:
   - testConnection() → boolean
   - fetchUsers() → User[] (mappato al model User)
   - fetchCourses() → Course[]
2) Provider iniziali: stub Isidata (REST), Esse3 (Cineca),
   Spaggiari (REST).
3) Cron daily 02:00: per ogni provider attivo, fetch + upsert su DB
   locale. Mai cancellare utenti (solo soft delete con flag
   isExternal=true se non più presenti).
4) Pagina /admin/integrations: lista provider, configurazione
   credenziali, ultimo run + log.
5) Modello IntegrationConfig (provider, isEnabled,
   credentialsEncrypted, lastRunAt, lastRunStatus).
6) Documenta API contract per nuovi provider in docs/INTEGRATIONS.md.
```

---

### 🔵 2.14 Controllo accessi fisico (RFID / serrature smart) (P3 — hardware on-site)

```prompt
Implementa controllo accessi fisico:
1) Webhook generico POST /api/integrations/access/event con HMAC
   signature: { roomId, badgeUid, timestamp,
   action ('granted'|'denied') }.
2) Modello AccessEvent + User.badgeUid UNIQUE nullable.
3) Cross-validation: quando arriva access event, cerca booking
   confermato matching (room+time) AND user.badgeUid match → success.
4) Driver pluggable: services/integrations/access/{salto,dormakaba,
   nuki}.js.
5) Pagina /admin/access-events con tabella + filtri.
6) Hook: valida automaticamente check-in se access event arriva
   nel window [start - 5min, end].
7) Documenta protocollo webhook (sign HMAC SHA256 con shared secret).
```

**Effort**: L (richiede hardware on-site).

---

### 2.15 Native mobile app — **decisione: NON sviluppare**

La PWA copre ~95% dei casi d'uso e costa una frazione. Solo un cliente con esigenza specifica (es. biometric auth lock-screen) giustifica un'app nativa.

---

### 2.16 Bot messaging — completamenti residui

Lo scaffold base è in produzione (Telegram pieno, gli altri scaffold). Restano:

- **WhatsApp Cloud · template messages outbound**: per messaggi automatici oltre 24h dall'ultima inbound dell'utente serve un template pre-approvato Meta. `adapters/whatsapp_cloud.js#sendTemplate` da aggiungere. Effort: M.
- **Signal poller bundled**: oggi richiede un forwarder esterno che POST verso il webhook. Impacchettare un worker side-car Docker. Effort: M.
- **Email IMAP poller**: stub funzionale, manca il poller `node-imap` integrato. Effort: M-L.
- **NLU LLM opt-in**: per conversazioni meno strutturate di quelle gestite dal parser regole. Use Claude Haiku o GPT-4o-mini. Effort: M.

---

## 3. Tech debt residuo

### 3.1 🟢 Sequelize CLI migrations

Oggi `preSyncMigrations.js` è il compat layer (idempotente). Migrazione a `sequelize-cli` per migrations versionate up/down.

```prompt
Migra Aula Book a sequelize-cli:
1) npm install --save-dev sequelize-cli
2) npx sequelize-cli init
3) Genera migration baseline dal dump SQL → 0000_initial.js
4) Mantieni preSyncMigrations.js come compat per 3-6 mesi (transizione)
5) Ogni nuova feature aggiunge una migration con up/down
6) Documenta in docs/MIGRATIONS.md
```

**Effort**: M (3-5 gg).

### 3.2 🟢 Docker compose

`scripts/install.sh` copre il deploy bare-metal (Hetzner/Ubuntu). Manca un setup Docker per ambienti containerizzati.

```prompt
Crea Docker setup:
1) backend/Dockerfile multi-stage (node:20-alpine)
2) frontend/Dockerfile (build vite + nginx alpine reverse proxy)
3) docker-compose.yml: postgres + backend + frontend + opzionale
   reverse proxy con HTTPS Let's Encrypt automatico
4) .env.example con tutte le ENV richieste
5) docs/DEPLOY.md: aggiungi sezione "git clone && docker compose up -d"
6) GitHub Actions release.yml: build + push immagini su ghcr.io su tag
```

**Effort**: M (3-5 gg).

### 3.3 🟢 Test coverage backend al 70%

Oggi ~40% (post `instrumentLoans` suite). Mancano:

- Test integration su Postgres reale per `analytics` (aggregate Postgres-only)
- 4 test in `excludeConstraint.test.js` skippati su SQLite (eseguire contro Postgres)
- Refactor 3 spec E2E pre-esistenti (`login-booking`, `admin-approve`, `waitlist-claim`) → estrarre helper di login da `instrument-loan.spec.ts`

**Effort**: M, on-demand.

### 3.4 🟢 Audit esteso accessi a dati sensibili

Granularità maggiore dell'attuale (oggi si traccia POST/PUT/DELETE su admin, non i GET). Bassa priorità.

---

## 4. Confronto sintetico

```
                              Asimut  Skedda  Robin   Aula Book
Room booking self-service       ✅      ✅      ✅      ✅
Custom rules + quotas           ✅      ✅      ✅      ✅
Auto-cancel ghost               ✅      ◐       ◐       ✅
Approval workflow               ✅      ✅      ✅      ✅
Inventario strumenti            —       —       —       ✅ unico
Bacheca avvisi audience         —       —       —       ✅ unico
Display kiosk pubblico          —       —       —       ✅ unico
Bot messaging Telegram          —       —       —       ✅ unico
Weekly view + Export PDF        —       —       —       ✅ unico
2FA admin                       ?       ✅      ✅      ✅ (email)
PWA installabile                —       ◐       ◐       ✅
Open-source self-host           —       —       —       ✅
GDPR PA italiana (Garante)      ◐       ◐       ◐       ✅
Multi-lingua (EN/DE/FR/ES/IT)   5       3       3       3 (IT/EN/ES)
ISAE 3000 audit                 ✅      ?       ?       N/A self-host
Task mgmt eventi                ✅      —       ◐       — (gap §2.1)
Mobile app nativa               ✅      ◐       ✅      — (PWA copre)
Class schedules / lessons 1:1   ✅      —       —       — (fuori scope)
SPID/CIE PA italiana            —       —       —       — (§2.9)
PEC + conservazione + ANIS      —       —       —       — (§2.10–2.12)
Integrazione SIS/LMS            ✅      —       —       — (§2.13)
Accesso fisico RFID             ✅      —       ✅      — (§2.14)

✅ disponibile  ◐ parziale  — assente  ? non documentato pubblicamente
```

**Sintesi**: Aula Book ha **parità o superiorità** su tutte le aree in scope. Gap principale strutturale: **task management eventi** (§ 2.1, effort L) — l'unico documentato pubblicamente sul sito ASIMUT. Le aree fuori scope (lezioni 1:1, group calendars) restano una scelta esplicita di prodotto. Le integrazioni PA italiana (SPID/PEC/ANIS — §§ 2.9-2.12) sono **vantaggio competitivo decisivo** una volta completate, perché nessun competitor estero le offre.

---

## 5. Sprint plan suggerito (prossimi 4-6 mesi)

### Sprint corrente (chiuso) — DONE

- Bot messaging (Telegram + scaffolding 3 canali) — completato 29/04/2026

### Sprint A — UX + visibilità (~2 settimane)

1. § 2.5 Embed iframe concerti (S)
2. § 2.6 Privacy granulare display (S)
3. § 2.7 Card "Avvisi" Dashboard utente (S)
4. § 2.3 Booking templates "Quick book" (S-M)

> Rationale: 4 quick win paralleli per consolidare la UX e completare i gap residui. Tutti < 1 settimana ciascuno.

### Sprint B — Notifiche + manutenzione (~2-3 settimane)

1. § 2.4 Push notifications Web Push API (M)
2. § 2.2 Tuning/maintenance schedule (M)
3. § 2.8 Report email periodici + comparazione YoY (M)

### Sprint C — Task management eventi (~2 settimane)

1. § 2.1 Task management eventi (L) — chiude gap ASIMUT documentato

### Sprint D — Tech debt + ops (~1-2 settimane)

1. § 3.2 Docker compose (M)
2. § 3.1 Sequelize CLI migrations (M)
3. § 3.3 Coverage backend al 70% (M, parallelizzabile)

### Sprint E+ — Italianizzazione PA (on-demand, dipende dai contratti)

1. § 2.9 SPID/CIE (L + processo AgID 2-3 mesi parallelo)
2. § 2.13 Sync anagrafiche (Esse3, Isidata) — solo se richiesto da cliente specifico
3. § 2.10 PEC (M)
4. § 2.12 ANIS / MIUR export (M-L)
5. § 2.11 Conservazione sostitutiva (L)
6. § 2.14 RFID / serrature smart — on-demand hardware on-site

### Sprint F — Bot messaging completamenti (on-demand)

1. § 2.16 WhatsApp Cloud template messages (M)
2. § 2.16 Signal poller bundled / Email IMAP poller (M-L)
3. § 2.16 NLU LLM opt-in (M)

> Sprint E e F vanno schedulati in base ai contratti chiusi. Non investire in SPID/PEC senza un cliente firmato che lo richieda esplicitamente.

---

## 6. Riepilogo gap residui (one-liner)

In ordine decrescente di impatto:

1. 🟠 **Task management eventi** (§ 2.1) — unico gap ASIMUT documentato, effort L
2. 🟢 **Push notifications** (§ 2.4) — completa il triangolo notifiche email + bot, effort M
3. 🟢 **Booking templates** (§ 2.3) — UX moderna stile Robin, effort S-M
4. 🟢 **Tuning maintenance** (§ 2.2) — verticale conservatorio, effort M
5. 🟢 **Embed iframe concerti** (§ 2.5) — quick win visibilità, effort S
6. 🟢 **Card Avvisi dashboard** (§ 2.7) — gap residuo, effort S
7. 🟢 **Privacy display granulare** (§ 2.6) — quick win privacy, effort S
8. 🟢 **Report email YoY** (§ 2.8) — analytics estesa, effort M
9. 🔵 **SPID/CIE** (§ 2.9) — sblocca PA grande, effort L + processo AgID
10. 🔵 **PEC + ANIS + conservazione** (§§ 2.10–2.12) — adempimenti PA, effort M-L cumulato
11. 🔵 **Sync anagrafiche** (§ 2.13) — sblocca conservatori grandi, effort L+
12. 🔵 **RFID accessi fisici** (§ 2.14) — on-demand hardware, effort L

**Effort totale per chiusura completa di tutto il backlog**: ~2-3 mesi di sviluppo full-time.

---

_Per la strategia commerciale, pricing, mercato e business plan vedi [`/analisi.md`](../analisi.md). Per il pitch direttori vedi [`docs/perDirettori.md`](docs/perDirettori.md)._
