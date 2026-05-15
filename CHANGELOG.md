# Changelog

Tutte le modifiche significative al progetto Cadenza sono documentate in
questo file. Il formato segue il principio "human readable" (non strict
Keep-a-Changelog) per leggibilità a clienti e direttori di Conservatorio.

Le versioni seguono [Semantic Versioning](https://semver.org/lang/it/):

- **MAJOR**: cambi incompatibili con installazioni esistenti
- **MINOR**: nuove feature backward-compatible
- **PATCH**: bug fix e ottimizzazioni interne

## [1.8.0] — 15 maggio 2026

Versione "smartphone UX overhaul": ripensa l'esperienza mobile delle
quattro pagine cliente (Dashboard, Prenota, Le mie prenotazioni,
Profilo), con focus sul calendario aule del giorno reso navigabile da
telefono e su una compressione globale delle UI primitives. Nessun
breaking change: il desktop (>= 1024px) resta identico alla v1.7.0.

### Nuove feature

#### Dashboard mobile-first

- **Hero mobile compatto** che sostituisce il grosso H1 "Pronti per
  studiare oggi?": una riga "saluto + giorno" + bottone "Nuova
  prenotazione" piccolo. Risparmia ~80px verticali su iPhone.
- **Card "Prossima sessione"** prominente sopra le KPI: relativo
  tempo ("tra 5 ore") + giorno · orario · aula, l'info più
  actionable in primo piano.
- **KPI grid 2×2** invece di 4 card stacked: dimezza lo scroll.
  Card più dense (padding ridotto, icon h-8, value text-xl).
- **Nuova sezione "Aule e prenotazioni"** mobile-only con disclosure
  a 2 livelli (`<details>` HTML nativi, zero stato, zero
  dipendenze):
  - **Livello 1 (edificio)**: icona, nome, conteggio aule + badge
    "Tutte libere" (verde) o "N prenot." (totale aggregato).
    Auto-aperto se c'è un solo edificio.
  - **Livello 2 (aula)**: nome, piano, badge "Libera" o conteggio
    prenotazioni del giorno. Espande la lista oraria.
  - **Prenotazioni**: orario · tipo · utente. Le proprie hanno
    bordo primary + bg-primary/5 distinguibili a colpo d'occhio.
    Tap apre il dialog corretto (annulla se tua, info read-only
    se altrui, edit se admin).
  - Date navigator condiviso col timetable desktop, riusa
    `roomsQuery` + `calendarBookingsQuery`: zero fetch aggiuntivi.
- **Weekly Timetable desktop nascosto su mobile**: troppo denso, e
  l'utente ha ora il disclosure a discesa al suo posto.

#### Compressione globale UI

- **Card primitives responsive di default** (`CardHeader`, `CardTitle`,
  `CardContent`, `CardFooter`): padding `p-4 sm:p-6` (era `p-6` fisso),
  titoli `text-lg sm:text-xl`. Beneficio diffuso a tutte le card
  dell'app: Profile (7 sezioni) ~30% più dense su mobile.
- **H1 pagine cliente**: `text-2xl sm:text-3xl` (era `text-3xl` fisso)
  → niente più title-wrap su iPhone.
- **Sottotitoli descrittivi** ("Gestisci tutte le tue prenotazioni…",
  ecc.) nascosti < sm: erano rumore visivo su mobile.
- **AppLayout header**: "CONSERVATORIO DI …" nascosto < sm — il
  titolo pagina ora ha la riga intera, niente più troncamento.

#### Booking — `/booking`

- CTA "Nuova prenotazione" nascosta su mobile: il tap su slot libero
  crea direttamente, doppio CTA era rumore.
- Filtri card più compatta, day label più piccolo, helper text "Clicca
  su una fascia libera…" nascosto.
- Legenda colori del calendario (lezione / concerto / prova / studio)
  nascosta su mobile (illeggibile su schermo stretto).

#### MyBookings — `/my-bookings`

- Bottone "Esporta iCal" nascosto su mobile (azione rara, riduce
  CTA-rumore in cima alla pagina).
- Card prenotazione più dense (padding ridotto, dot bar più stretta).

#### Profile — `/profile`

- Card identità con avatar più piccolo su mobile (h-16 vs h-20).
- Caption "PNG · JPG · WEBP · max 2 MB" nascosta su mobile.

### Fix

- **Form accessibility su smartphone**: aggiunti `inputMode="numeric"`
  su input ricorrenza booking e matricola profilo, `autoComplete`
  given-name/family-name su nome/cognome profilo. Le tastiere
  iOS/Android si aprono ora corrette al primo tap.
- **Monte Ore desktop-only**: nascosto su < lg sia il link in sidebar
  (drawer mobile) sia il `to` del KPI tile docente. La pagina di
  planning richiede tabelle dense non gestibili da telefono — il
  valore KPI resta visibile, solo non cliccabile. Rotte e API restano
  attive: bookmark esistenti funzionano.

### Pulizia tecnica

- **Dashboard**: rimossa la card "Prossime prenotazioni" ridondante
  con `/my-bookings` (raggiungibile in 1 tap dalla bottom-nav). Il
  `upcomingQuery` resta attivo perché alimenta KPI, hero mobile
  "Prossima sessione" e check-in imminente.
- Tutte le modifiche sono `< lg`-only via Tailwind responsive: il
  desktop (>= 1024px) è bit-per-bit identico alla v1.7.0.

### English version

Release "smartphone UX overhaul": rethinks the mobile experience of
the four client pages (Dashboard, Booking, My Bookings, Profile), with
focus on a usable daily room calendar and a global tightening of UI
primitives. No breaking changes — desktop (>= 1024px) is unchanged.

#### Mobile-first Dashboard

- **Compact mobile hero** replacing the large "Ready to study today?"
  H1: a single "greeting + day" line + small "New booking" button.
  Saves ~80px vertical on iPhone.
- **"Next session" card** prominent above the KPIs: relative time
  ("in 5 hours") + day · time · room, the most actionable info on top.
- **KPI grid 2×2** instead of 4 stacked cards: halves the scroll.
  Denser cards (reduced padding, h-8 icon, text-xl value).
- **New "Rooms and bookings" mobile-only section** with 2-level
  disclosure (native `<details>`, zero state, zero deps):
  - **Level 1 (building)**: icon, name, room count + "All free"
    (green) or "N bookings" badge (aggregated). Auto-opened if only
    one building.
  - **Level 2 (room)**: name, floor, "Free" badge or per-day booking
    count. Expands to time list.
  - **Bookings**: time · type · user. Own bookings have primary
    border + bg-primary/5 highlight. Tap opens the right dialog
    (cancel if mine, info read-only if others', edit if admin).
  - Date navigator shared with desktop timetable, reuses
    `roomsQuery` + `calendarBookingsQuery`: zero extra fetches.
- **Desktop Weekly Timetable hidden on mobile**: too dense, replaced
  by the disclosure list.

#### Global UI compression

- **Responsive Card primitives** (`CardHeader`, `CardTitle`,
  `CardContent`, `CardFooter`): `p-4 sm:p-6` (was fixed `p-6`),
  titles `text-lg sm:text-xl`. App-wide benefit: Profile (7 sections)
  ~30% denser on mobile.
- **Client page H1**: `text-2xl sm:text-3xl` (was fixed `text-3xl`)
  → no more title-wrap on iPhone.
- **Decorative subtitles** ("Manage all your bookings…", etc.) hidden
  < sm: visual noise on mobile.
- **AppLayout header**: "CONSERVATORIO DI …" hidden < sm — page
  title now gets a full line, no more truncation.

#### Booking — `/booking`

- "New booking" CTA hidden on mobile: tapping a free slot creates
  directly, double CTA was noise.
- More compact filters card, smaller day label, "Click on a free
  slot…" helper text hidden.
- Calendar color legend (lesson / concert / rehearsal / study) hidden
  on mobile (illegible on narrow screens).

#### My Bookings — `/my-bookings`

- "Export iCal" button hidden on mobile (rare action, reduces CTA
  noise at the top of the page).
- Denser booking cards (reduced padding, slimmer dot bar).

#### Profile — `/profile`

- Identity card with smaller avatar on mobile (h-16 vs h-20).
- "PNG · JPG · WEBP · max 2 MB" caption hidden on mobile.

#### Fix

- **Mobile form accessibility**: added `inputMode="numeric"` on
  booking recurrence and profile student ID, `autoComplete`
  given-name/family-name on profile name/surname. iOS/Android
  keyboards now open correctly on first tap.
- **Monte Ore desktop-only**: hidden on < lg both the sidebar link
  (mobile drawer) and the `to` of the teacher KPI tile. The planning
  page requires dense tables not usable from phone — the KPI value
  remains visible, just not clickable. Routes and APIs remain active:
  existing bookmarks still work.

#### Technical cleanup

- **Dashboard**: removed the "Upcoming bookings" card redundant with
  `/my-bookings` (1 tap from bottom-nav). `upcomingQuery` stays
  active because it feeds KPIs, mobile "Next session" hero, and
  imminent check-in card.
- All changes are `< lg`-only via Tailwind responsive: desktop
  (>= 1024px) is bit-identical to v1.7.0.

## [1.7.0] — 15 maggio 2026

Versione "stato sistema e hardening operativo": introduce una dashboard
admin at-a-glance per la diagnostica di VPS, database, code interne e
backup, e accompagna due strumenti di hardening pronti all'uso per le
VPS piccole (tuning Postgres + restrizione IP del kiosk).

### Nuove feature

#### Dashboard ops — `/admin/ops`

- **Nuova pagina admin "Stato sistema"** con 5 widget aggiornati ogni 10s:
  - **VPS** — CPU (load 1m / numero core), RAM, disco, uptime macchina
    e processo, versione Node, con semafori verde/giallo/rosso su soglie
    (70/90% per CPU, 75/90% per RAM e disco).
  - **Database** — connessioni totali / attive / idle / idle in
    transazione (con warning sui possibili lock), dimensione DB, top
    5 tabelle per righe.
  - **Coda email** — `pending` con età del più vecchio messaggio,
    `dead` con badge "da rivedere", totale inviati.
  - **Backup** — ultimo backup con età relativa (verde <24h, giallo
    24–36h, rosso >36h), dimensione, conteggio totale.
  - **Scheduler interni** — 5 worker (`reminder`, `retention`,
    `mailOutbox`, `backup`, `excelExport`) con badge OK / in-ritardo
    / disabilitato / errore e timestamp dell'ultimo tick.
- **Nuovo endpoint `GET /api/admin/ops/snapshot`** admin-only, con
  cache in-memory 5s e collapsing delle chiamate concorrenti — più
  admin connessi insieme non moltiplicano le query. Parametro `?force=1`
  bypassa la cache (uso debug).
- **Strumentazione scheduler**: `getStatus()` aggiunto in modo
  additivo a `reminderScheduler`, `retentionScheduler`,
  `mailOutboxScheduler`, `excelExportScheduler` (`backupScheduler` lo
  aveva già). Espone `lastTickAt`, `lastError`, `intervalMs`,
  `nextTickAt` — base per la diagnosi di un worker bloccato.
- i18n IT + EN complete (`nav.admin_ops`, `admin.ops.*`).

### Hardening operativo

- **`scripts/pg-tune-4gb.sh`** — script idempotente che applica via
  `ALTER SYSTEM` un set di parametri Postgres calibrato per VPS
  **4 vCPU / 4 GB RAM / SSD**: `shared_buffers=1GB`,
  `effective_cache_size=2GB`, `work_mem=8MB`, `max_connections=50`,
  tuning checkpoint / WAL / parallel workers,
  `log_min_duration_statement=500`. Auto-rileva la major version di
  Postgres, salva snapshot pre-apply in `/var/backups/postgresql/`,
  riavvia Postgres + PM2 con polling fino a che il DB risponde. Flag
  `--dry-run`, `--no-restart`, `--rollback`.
- **`docs/KIOSK_IP_ALLOWLIST.md`** — guida nginx per restringere
  `/display` e gli endpoint pubblici `/api/public/*` ai soli IP
  dell'istituto. Pattern snippet condiviso
  `cadenza-display-allowlist.conf` (single source of truth), test e
  verifica da IP interno + IP esterno, monitoraggio dei 403, rollback
  in <1s. **Non blocca** `/api/auth/*` e `/api/admin/*`: admin, docenti
  e studenti continuano ad accedere da qualunque rete.

### Fix

- **Sidebar admin**: rimossa voce "Manuale Admin" duplicata; l'admin
  atterra direttamente sul proprio manuale dalla voce "Manuale" comune.

### Pulizia tecnica

- Tutti gli scheduler interni ora espongono uno stato uniforme — base
  per gli sviluppi successivi (monitor esterno, alert su tick mancanti).
- **Backlog post-1.6.0** consolidato in [`develop.md`](develop.md) §2
  con 7 voci ordinate per coerenza: device token kiosk mobili, PIN
  ruotabile via mail, monitor esterno con alert 403, PgBouncer + PM2
  cluster mode, slow query digest settimanale, dashboard ops (chiusa
  con questa release), QR code dinamico sul display.

### Documentazione

- **Nuovi**: [`docs/KIOSK_IP_ALLOWLIST.md`](docs/KIOSK_IP_ALLOWLIST.md),
  [`scripts/pg-tune-4gb.sh`](scripts/pg-tune-4gb.sh).
- **Aggiornati**: `README.md` (tabella docs + bullet "Display kiosk"
  con riferimento IP allowlist), `docs/install.md` (riferimento
  `pg-tune-4gb.sh` in §6.3 PostgreSQL, `KIOSK_IP_ALLOWLIST.md` in §10
  "Cose che NON sono in questa guida"), `develop.md` (nuova §2 con il
  backlog post-1.6.0).

### Numeri di copertina

```
+1.324 righe / 14 file in feat(observability): 5 widget + 1 endpoint + 5 smoke test
nuovo endpoint /api/admin/ops/snapshot — admin-only, cache 5s
1 nuova pagina admin · 4 scheduler strumentati · 2 doc + 1 script ops
0 breaking change — bump MINOR puro
```

---

### English version

Release "system status and operational hardening": introduces an
at-a-glance admin dashboard for VPS, database, internal queue and
backup diagnostics, and ships two ready-to-use hardening tools for
small VPS (Postgres tuning + kiosk IP restriction).

#### New features

##### Ops dashboard — `/admin/ops`

- **New admin page "System status"** with 5 widgets refreshed every 10s:
  - **VPS** — CPU (1m load / core count), RAM, disk, system and
    process uptime, Node version, with green / yellow / red threshold
    badges (70/90% for CPU, 75/90% for RAM and disk).
  - **Database** — total / active / idle / idle-in-transaction
    connections (with warning on possible locks), DB size, top 5
    tables by row count.
  - **Email queue** — `pending` with the oldest message's age,
    `dead` with a "needs review" badge, total sent.
  - **Backups** — last backup with relative age (green <24h, yellow
    24–36h, red >36h), size, total count.
  - **Internal schedulers** — 5 workers (`reminder`, `retention`,
    `mailOutbox`, `backup`, `excelExport`) with OK / stale / disabled
    / error badges and last-tick timestamp.
- **New `GET /api/admin/ops/snapshot` endpoint** admin-only, 5s
  in-memory cache with concurrent-call collapsing — multiple admins
  polling together don't multiply the queries. `?force=1` bypasses the
  cache (debug usage).
- **Scheduler instrumentation**: `getStatus()` additively added to
  `reminderScheduler`, `retentionScheduler`, `mailOutboxScheduler`,
  `excelExportScheduler` (`backupScheduler` already had one). Exposes
  `lastTickAt`, `lastError`, `intervalMs`, `nextTickAt` — foundation
  for diagnosing a stuck worker.
- Full IT + EN i18n (`nav.admin_ops`, `admin.ops.*`).

#### Operational hardening

- **`scripts/pg-tune-4gb.sh`** — idempotent script applying via
  `ALTER SYSTEM` a Postgres parameter set tuned for **4 vCPU / 4 GB
  RAM / SSD** VPS: `shared_buffers=1GB`,
  `effective_cache_size=2GB`, `work_mem=8MB`, `max_connections=50`,
  checkpoint / WAL / parallel workers tuning,
  `log_min_duration_statement=500`. Auto-detects the Postgres major
  version, saves a pre-apply snapshot in `/var/backups/postgresql/`,
  restarts Postgres + PM2 with polling until the DB responds. Flags
  `--dry-run`, `--no-restart`, `--rollback`.
- **`docs/KIOSK_IP_ALLOWLIST.md`** — nginx guide restricting
  `/display` and the public `/api/public/*` endpoints to the
  institute's IPs only. Shared snippet pattern
  `cadenza-display-allowlist.conf` (single source of truth), test and
  verification from internal + external IPs, 403 monitoring, rollback
  in <1s. Does **not** block `/api/auth/*` or `/api/admin/*`: admins,
  teachers and students keep accessing from any network.

#### Fixes

- **Admin sidebar**: removed duplicate "Admin manual" entry; admins
  land directly on their manual from the common "Manual" entry.

#### Technical cleanup

- All internal schedulers now expose a uniform status — foundation
  for follow-up work (external monitor, alerts on missed ticks).
- **Post-1.6.0 backlog** consolidated in [`develop.md`](develop.md) §2
  with 7 items: mobile-kiosk device token, mail-rotated PIN, external
  monitor with 403 alerts, PgBouncer + PM2 cluster mode, weekly slow
  query digest, ops dashboard (closed with this release), dynamic QR
  code on the display.

#### Documentation

- **New**: [`docs/KIOSK_IP_ALLOWLIST.md`](docs/KIOSK_IP_ALLOWLIST.md),
  [`scripts/pg-tune-4gb.sh`](scripts/pg-tune-4gb.sh).
- **Updated**: `README.md` (docs table + "Display kiosk" bullet with
  IP allowlist reference), `docs/install.md` (`pg-tune-4gb.sh`
  reference in §6.3 PostgreSQL, `KIOSK_IP_ALLOWLIST.md` in §10
  "Things NOT in this guide"), `develop.md` (new §2 with the
  post-1.6.0 backlog).

#### Headline numbers

```
+1,324 lines / 14 files in feat(observability): 5 widgets + 1 endpoint + 5 smoke tests
new endpoint /api/admin/ops/snapshot — admin-only, 5s cache
1 new admin page · 4 instrumented schedulers · 2 docs + 1 ops script
0 breaking changes — pure MINOR bump
```

---

## [1.6.0] — 14 maggio 2026

Versione "consolidamento e onboarding": chiude i pezzi mancanti per portare
un nuovo Conservatorio in produzione senza intervento manuale dell'amministratore,
e rinforza la robustezza del sistema su fusi orari e hosting diversi.

### Nuove feature

#### Onboarding studenti / docenti

- **Magic-link "primo accesso" dopo import Isidata** ([`#isidata`](docs/INTEGRATIONS-ISIDATA.md))
  Dopo l'apply dell'import Isidata, l'admin può inviare in bulk una mail di
  benvenuto a tutti i nuovi utenti con un link per impostare la propria
  password. Niente più CSV con password in chiaro, niente più "non riesco
  ad accedere" via Segreteria. Token monouso, scadenza configurabile
  (default 14 giorni, range 1-90).
- **Bulk-invio magic-link da pagina Utenti**
  Stessa azione disponibile come bulk action su righe selezionate
  (utile per rimandare il link a chi l'ha perso).
- **Pagina di login con CTA "Rinvia link di benvenuto"**
  Quando un utente Isidata prova a loggare prima di completare il setup
  (code `PASSWORD_NOT_SET`), vede un messaggio chiaro + bottone self-service
  per richiedere un nuovo link.
- **Manuale studente in-app** ([`docs/MANUALE_STUDENTE.md`](docs/MANUALE_STUDENTE.md))
  ~340 righe dedicate agli studenti. Guard per ruolo: docenti vedono solo
  il manuale docente, studenti solo il manuale studente, admin tutti e tre
  con switcher.

#### Import anagrafica multi-provider

- **Wizard import esteso a ESSE3 (Suite Studenti CINECA)**
  Stesso wizard di Isidata parametrizzato su `source`, con storico
  separato. Logo identitario per ogni provider (`IsidataLogo`, `Esse3Logo`)
  visibile in card, dialog e header.
- **Whitelist domini email** per il login OAuth Google/Microsoft.

#### Vista dashboard "tutti vedono"

- **Tutte le prenotazioni visibili a ogni ruolo** (admin, docente, studente)
  con distinzione visiva: proprie con anello oro, altrui senza.
- **Click su prenotazione altrui** → dialog read-only con informazioni
  non sensibili (chi, dove, quando), niente email/matricola.
- **Pagina /booking** allineata alla stessa logica.

#### Pagine pubbliche

- **Pagina "OAuth non disponibile"** stilizzata col logo del provider
  (Google a 4 colori o Microsoft a 4 quadrati) quando l'admin non ha
  ancora configurato la strategia. Sostituisce il vecchio JSON 503 nudo.

### Fix di sostanza

- **Audit timezone completo**: ~10 punti corretti dove il codice leggeva
  `hour/minute/day` senza convertire in `Europe/Rome`, con conseguenze su
  generazione ricorrenze Monte Ore, expander RRULE, scheduler reminder,
  analytics heatmap, widget kiosk, file backup, email. Su VPS UTC alcune
  date persistite nascevano sfasate di 1-2h; ora il sistema è
  TZ-coerente ovunque.
- **TZ-aware `exceptionOverlapService`** (filtro day-of-week e finestra
  oraria delle eccezioni in ora italiana).
- **`fix(booking)`**: Europe/Rome nel check finestra oraria delle regole
  (no off-by-2h su VPS UTC).
- **`fix(monte-ore)`**: le sospensioni inibiscono giorni e settimane
  qualunque sia il `kind`.

### Ottimizzazioni performance

- Eliminato N+1 in `GET /buildings/checkin-defaults` (era 2N+1 → 2 query).
- Refetch ridondante rimosso dal `reminderScheduler.tickLoans`.
- Bulk update degli orphan slots in `monteOreService` (singola query SQL).
- **Indici DB compositi**: `announcements_active_feed_idx`,
  `monte_ore_schedules_proposal_day_idx`, `integration_sync_runs_*`.
  Sostituiscono 8 indici single-column con 4 mirati alle query reali.

### Pulizia tecnica

- Rimosse dipendenze inutilizzate: `mysql2`, `express-session`,
  `passport.session()`. `SESSION_SECRET` non più richiesto in prod.
- Refactor degli import utenti in pipeline unificata (CSV admin +
  Isidata + ESSE3).
- Pagine Studente/Docente allineate a `max-w-7xl` (come Dashboard) per
  coerenza visiva su tutto il navigato non-admin.
- Documento "Audit Qualità / Stabilità / Sicurezza" riscritto in tono
  narrativo accessibile a un cliente non tecnico.

### CI / DevOps

- **Matrice TZ sul job backend**: ogni run gira la suite due volte, una
  con `TZ=Europe/Rome` e una con `TZ=UTC`. Regressioni TZ-naive vengono
  intercettate prima del merge.
- Gitleaks scan su ogni push e PR (era già attivo, confermato in matrice).

### Documentazione

- **Nuovo**: `docs/MANUALE_STUDENTE.md`, `CHANGELOG.md`.
- **Aggiornato**: `docs/AUDIT_QUALITA_PRODUZIONE.md` riscritto da zero
  in stile narrativo. Manuale Admin con sezione "Cosa c'è di nuovo in v1.6.0".
- **Piano**: `~/Desktop/import-isidata.md` documento operativo del flusso
  magic-link (lavoro completato).

### Numeri-cartolina

```
1.913 test unit+integration (1.698 backend + 258 frontend) — invariato come obiettivo
73 / 74 / 79 / 62 coverage backend — invariato sopra soglia
0 vulnerabilità npm audit · 0 errori lint/typecheck · TS strict end-to-end
TZ-coerente: identici i risultati su Europe/Rome e UTC
```

---

### English version

Release "consolidation and onboarding": closes the missing pieces required
to bring a new Conservatory into production without manual admin
intervention, and strengthens the system's robustness across time zones
and hosting environments.

#### New features

##### Student / teacher onboarding

- **Magic-link "first access" after Isidata import** ([`#isidata`](docs/INTEGRATIONS-ISIDATA.md))
  After applying the Isidata import, the admin can bulk-email all newly
  created users a welcome link to set their own password. No more CSV
  files with plaintext passwords, no more "I can't sign in" calls to the
  Registrar. One-time token with configurable expiry (default 14 days,
  range 1–90).
- **Bulk magic-link send from the Users page**
  Same action available as a bulk action on selected rows (useful for
  resending the link to users who lost it).
- **Login page with "Resend welcome link" CTA**
  When an Isidata user tries to sign in before completing the setup
  (`PASSWORD_NOT_SET` code), they see a clear message + self-service
  button to request a new link.
- **In-app student manual** ([`docs/MANUALE_STUDENTE.md`](docs/MANUALE_STUDENTE.md))
  ~340 lines dedicated to students. Role-based guard: teachers see only
  the teacher manual, students only the student manual, admins all three
  with a switcher.

##### Multi-provider roster import

- **Import wizard extended to ESSE3 (CINECA Student Suite)**
  Same Isidata wizard parameterized on `source`, with separate history.
  Identity logos per provider (`IsidataLogo`, `Esse3Logo`) visible in
  cards, dialogs and headers.
- **Email-domain allowlist** for Google/Microsoft OAuth login.

##### "Everyone sees everyone" dashboard

- **All bookings visible to every role** (admin, teacher, student) with
  visual distinction: own bookings ringed in gold, others without.
- **Click on a third-party booking** → read-only dialog with
  non-sensitive info (who, where, when), no email or matricola exposed.
- **/booking page** aligned to the same logic.

##### Public pages

- **"OAuth unavailable" page** styled with the provider's logo (Google
  4-color or Microsoft 4-square) when the admin hasn't configured the
  strategy yet. Replaces the old bare JSON 503 response.

#### Substantive fixes

- **Full timezone audit**: ~10 points fixed where the code was reading
  `hour/minute/day` without converting to `Europe/Rome`, with
  consequences on Monte Ore recurrence generation, RRULE expander,
  reminder schedulers, analytics heatmap, kiosk widget, backup
  filenames, emails. On UTC VPS some persisted dates were born offset
  by 1-2h; now the system is TZ-coherent across the board.
- **TZ-aware `exceptionOverlapService`** (day-of-week and time-window
  filter for exceptions read in Italian local time).
- **`fix(booking)`**: Europe/Rome in the time-window check of booking
  rules (no more off-by-2h on UTC VPS).
- **`fix(monte-ore)`**: suspensions inhibit days and weeks regardless
  of `kind`.

#### Performance optimizations

- N+1 eliminated in `GET /buildings/checkin-defaults` (was 2N+1 → 2 queries).
- Redundant refetch removed from `reminderScheduler.tickLoans`.
- Bulk update of orphan slots in `monteOreService` (single SQL statement).
- **Composite DB indexes**: `announcements_active_feed_idx`,
  `monte_ore_schedules_proposal_day_idx`, `integration_sync_runs_*`.
  Replace 8 single-column indexes with 4 targeted at real queries.

#### Technical cleanup

- Unused dependencies removed: `mysql2`, `express-session`,
  `passport.session()`. `SESSION_SECRET` no longer required in prod.
- User-import pipelines refactored into a unified flow (admin CSV +
  Isidata + ESSE3).
- Student/Teacher pages aligned to `max-w-7xl` (like the Dashboard) for
  visual consistency across the entire non-admin navigation.
- "Quality / Stability / Security Audit" document rewritten in a
  narrative tone accessible to a non-technical reader.

#### CI / DevOps

- **TZ matrix on the backend job**: every run executes the test suite
  twice, once with `TZ=Europe/Rome` and once with `TZ=UTC`. TZ-naive
  regressions are caught before merge.
- Gitleaks scan on every push and PR (already active, confirmed in
  matrix).

#### Documentation

- **New**: `docs/MANUALE_STUDENTE.md`, `CHANGELOG.md`.
- **Updated**: `docs/AUDIT_QUALITA_PRODUZIONE.md` rewritten from
  scratch in narrative style. Admin manual with "What's new in v1.6.0"
  section.
- **Plan**: `~/Desktop/import-isidata.md` operational document of the
  magic-link flow (work completed).

#### Headline numbers

```
1.913 unit+integration tests (1.698 backend + 258 frontend) — target unchanged
73 / 74 / 79 / 62 backend coverage — unchanged above threshold
0 npm audit vulnerabilities · 0 lint/typecheck errors · TS strict end-to-end
TZ-coherent: identical results on Europe/Rome and UTC
```

## [1.5.1] — pre-changelog (audit del 14 maggio 2026)

Versione storica documentata in [`docs/AUDIT_QUALITA_PRODUZIONE.md`](docs/AUDIT_QUALITA_PRODUZIONE.md)
e nella sezione "Cosa c'è di nuovo" del manuale admin.

Tra le feature consolidate prima del versionamento changelog:

- Macro pagina admin "Gestione prenotazioni" (3 tab: Regole / Tipi /
  Approvazioni) con redirect dai vecchi URL.
- Isidata con mapping UI guidata, soglie di sicurezza pre-apply,
  import `contractType`, diff "ultimi 2 run".
- Eccezioni con scope per aula (BookingRuleException).
- 2FA email mandatory per ruoli admin.
- Audit log append-only con retention configurabile + archivio gzip.
- AES-256-GCM su credenziali in DB.
- Backup giornaliero + DR drill non distruttivo.
- 5 lingue UI (IT/EN/ES/DE/FR).
- PWA mobile-first con service worker offline.
- iCal export utente con token rotabile.
- Display kiosk pubblico per ingressi edificio.
- Bot Telegram/WhatsApp/Email.
- 36 screenshot admin indicizzati per onboarding.

Licenza: da v1.5.1 il software è **proprietary closed-source** (LICENSE
all rights reserved). Distribuibile in self-host on-prem oppure SaaS hosted.

---

_Cambiamenti tracciati a partire da v1.6.0. Per la cronologia git completa:
[github.com/danilorussosax/Cadenza-Booking-Rooms](https://github.com/danilorussosax/Cadenza-Booking-Rooms/commits/main)._
