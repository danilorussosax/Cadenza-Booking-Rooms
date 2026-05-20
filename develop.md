# Cadenza · Piano di sviluppo

> **Stato**: documento di lavoro — roadmap operativa.
> **Scopo**: tenere allineati stato attuale, sprint correnti e gap residui vs ASIMUT.
> **Vedi anche**: [`develop-enterprise.md`](develop-enterprise.md) per gli stream LDAP/AD, SAML/IDEM-GARR, sync Esse3, RFID badge.

---

## 1. Gestione Eventi (gap vs ASIMUT) — proposta architetturale

Documento di riferimento operativo per chiudere il gap "Event Management" identificato nel README (§ 9 Roadmap enterprise → _"Task management eventi (gap residuo vs ASIMUT documentato)"_).

### 1.1 Contesto e motivazione

ASIMUT presenta l'Event Management come uno strato **sopra** scheduling/room booking, non come calendario alternativo. Caratteristiche distintive emerse dalle fonti pubbliche:

- **Step-by-step planning** con workflow di stati (bozza → pianificazione → confermato → pubblicato).
- **Task management** integrato nell'evento (checklist con assegnatari/scadenze).
- **Team communication** — thread di aggiornamenti collegati all'evento, "fino all'ultimo minuto".
- **Sign-up e attendance** per studenti/staff con permessi configurabili.
- **Conflict prevention** — l'evento occupa N sale, le occupazioni passano dallo stesso clash checker del booking.
- **Performance venues** trattate come risorse speciali (in Cadenza già coperte da `requireApproval`).
- **Centralizzazione**: poster, programma, esecutori, comunicazioni, task — tutto sull'entità evento.

Fonti: [asimut.com/solution](https://asimut.com/solution/), [eliteai.tools/tool/asimut](https://eliteai.tools/tool/asimut), reviews Capterra/GetApp/G2.

### 1.2 Stato di partenza in Cadenza

| Entità               | Modello                              | Limite per gestione eventi                      |
| -------------------- | ------------------------------------ | ----------------------------------------------- |
| `Booking`            | `backend/models/Booking.js:6`        | Atomo "1 utente · 1 aula · 1 slot"              |
| `ConcertInfo`        | `backend/models/ConcertInfo.js:18`   | 1:1 con Booking `concerto` — un solo slot/owner |
| `BookingTypeCatalog` | catalog editabile (label/color/icon) | Limitato a 5 ENUM core                          |
| `Announcement`       | comunicazione one-way audience-based | Non legata a un'entità evento                   |
| `BookingTemplate`    | template di booking                  | —                                               |

**Problema centrale**: un evento reale (masterclass 3gg × 2 sale, esame con prova generale + esecuzione, festival con 8 concerti) **non si modella come singolo Booking**. Serve un'entità nuova **Event** come aggregatore.

### 1.3 Principio guida: minima invasività

`Booking` resta la fonte di verità per l'occupazione aula. `Event` è un **aggregatore** con relazione 1:N sui booking. Così:

- `bookingValidator.js` non cambia
- `EXCLUDE constraint` PostgreSQL continua a proteggere l'overlap
- check-in QR, statistiche, audit, iCal — tutto continua a funzionare invariato
- `ConcertInfo` resta come read-only deprecata durante la migrazione

### 1.4 Roadmap a 5 fasi (~11 giornate totali)

Ogni fase è deploybile da sola; le successive estendono senza riscrivere.

#### Fase 0 — Preparare le tipologie (½ giornata)

Estensione dell'ENUM `Booking.type` con i valori `masterclass`, `esame`, `seminario`, `evento` e seed corrispondenti su `BookingTypeCatalog`.

Procedura (additiva, non-breaking):

1. **Migration formale** `backend/migrations/<ts>-extend-booking-type-enum.js` con `ALTER TYPE "enum_bookings_type" ADD VALUE IF NOT EXISTS '...'` per ciascun valore nuovo, su `bookings` e `booking_templates`. Postgres `ADD VALUE` è atomico e non blocca le tabelle; SQLite (dev) ricrea la colonna in safe-sync.
2. **Allargare gli array hardcoded** in 4 file: `backend/models/Booking.js`, `backend/models/BookingTemplate.js`, `backend/routes/bookings.js` (validator `isIn`), `backend/routes/bookingTemplates.js` (`TYPE_VALUES`).
3. **Frontend**: estendere `frontend/src/types/index.ts` (`type BookingType`), aggiungere entries in `frontend/src/lib/bookings.ts` (`BOOKING_TYPE_OPTIONS` + `BOOKING_TYPE_STYLES` con classi Tailwind per colore/dot/ring) e nelle traduzioni `i18n/locales/*.json` (chiavi `booking.form.type_<code>`).
4. **Seeder** `backend/seeders/initial.js`: aggiungere entries `BookingTypeCatalog` (`code`, `label`, `color`, `icon`, `sortOrder`, `defaultDurationMinutes`, `description`). Il seeder è idempotente (`findOrCreate` su `code`).
5. **Test regression** sui file che hanno la lista hardcoded (`bookingTypes.test.js` array di codici).

Effort ~3-4 ore, di cui ~½ ora di overhead fisso. Rischio basso (ENUM additivo, nessuna modifica a righe esistenti).

#### Fase 1 — Modello `Event` + relazione 1:N con `Booking` (2-3 giorni)

Nuovo modello `backend/models/Event.js`:

```
id, code (slug), title, description, type (FK BookingTypeCatalog.code),
status ENUM('draft','planning','confirmed','published','completed','cancelled'),
visibility ENUM('private','internal','public'),
startAt, endAt (cache derivata dai booking collegati),
posterUrl, programText, performersText,         ← migrati da ConcertInfo
ownerUserId, organizerUserIds[] (JSON), createdByUserId,
isOnDisplay (bool), allowSignup (bool), signupDeadline,
externalRef (per import futuri es. saggio fine corso da Isidata)
```

Modifica additiva su `Booking`:

```js
eventId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'events', key: 'id' } }
```

Indice `bookings_event_status` su `(eventId, status)`.

**Regola chiave**: `Event.startAt/endAt` è cache di `MIN(start)/MAX(end)` dei booking collegati con `status != 'cancelled'`.

**Migrazione `ConcertInfo` → `Event` non distruttiva**:

- backfill: per ogni `ConcertInfo` crea `Event(type='concerto', status='published', ...)` e setta `Booking.eventId`
- `ConcertInfo` resta come tabella read-only per N release (deprecation path)

Endpoint nuovi:

- `POST /api/events`, `PATCH /api/events/:id`, `GET /api/events/:id`
- `POST /api/events/:id/bookings` (collega un booking esistente o ne crea uno nuovo in transazione)
- `GET /api/public/events?from=...&to=...` (sostituisce filtro `type === 'concerto'` in `backend/routes/public.js:381` con `eventId IS NOT NULL AND visibility='public'`)

#### Fase 2 — Partecipanti, sign-up, attendance (2 giorni)

Tabella `event_signups`:

```
id, eventId (FK), userId (FK, nullable per ospiti esterni),
externalName, externalEmail, role ENUM('audience','performer','organizer','staff'),
status ENUM('signed_up','waitlist','confirmed','cancelled','attended','no_show'),
signedUpAt, attendedAt, attendedBy (FK User, chi ha registrato la presenza)
```

- Anti-doppione: `UNIQUE(eventId, userId) WHERE userId IS NOT NULL`
- Riuso pattern `BookingWaitlist` per overflow capienza
- Endpoint pubblici: `POST /api/events/:id/signup` (rate-limited), `DELETE /api/events/:id/signup`
- Endpoint admin: `POST /api/events/:id/signups/:signupId/attend` (check-in semplice o QR riusando `Room.qrToken` pattern)

#### Fase 3 — Task management (2 giorni)

Tabella `event_tasks`:

```
id, eventId, title, description, assigneeUserId, dueAt,
status ENUM('todo','in_progress','done','blocked'), order, createdByUserId
```

- CRUD REST classico
- Notifiche via **`MailOutbox`** già esistente: nuovo template `event_task_assigned`
- **Niente task dependencies / Gantt** in v1 (KISS — Conservatori italiani non lavorano con DAG)

#### Fase 4 — UI step-by-step + comunicazione (3 giorni)

Frontend:

- Pagina `/admin/events` (lista + filtri stato/tipo/edificio/range) con card-stack su mobile
- Pagina `/admin/events/:id` con tab `Pianificazione · Sale · Partecipanti · Task · Comunicazioni`
- Wizard di creazione a 4 step (`Tipo & titolo → Sale & slot → Visibilità & signup → Pubblica`), riusando `BookingFormDialog` per il sotto-flusso "aggiungi slot in aula"
- Tab "Comunicazioni": thread su tabella `event_messages` (id, eventId, authorUserId, body, createdAt); riuso del pattern `Announcement` per audience filter quando si fa "Notifica i partecipanti" → enqueue su `MailOutbox`

Permessi:

- `student`: vede eventi `published` ai quali è iscritto o pubblici; può fare signup
- `teacher`: può proporre eventi (`status=draft`); li gestisce se è organizer
- `admin`: tutto

#### Fase 5 — Pubblicazione & feed (1 giorno)

- Display kiosk: card "Concerti" → "Eventi pubblici", legge da `GET /api/public/events`
- iCal feed per evento (riuso pattern token già presente per booking utente)
- Embed iframe `/public/events/embed?building=...&type=concerto` (già in roadmap, ora con API stabile su cui appoggiarsi)

### 1.5 Stima e priorità

| Fase                    | Effort | Dipende da | Demo-ready? |
| ----------------------- | ------ | ---------- | ----------- |
| 0 — tipologie           | ½ gg   | —          | sì          |
| 1 — Event + 1:N booking | 2-3 gg | 0          | **sì, MVP** |
| 2 — signup/attendance   | 2 gg   | 1          | sì          |
| 3 — task management     | 2 gg   | 1          | sì          |
| 4 — UI wizard + thread  | 3 gg   | 1, 2, 3    | sì          |
| 5 — kiosk/iframe/iCal   | 1 gg   | 1          | sì          |

**Totale ~11 giornate** per chiudere il gap dichiarato vs ASIMUT, con MVP utile già dopo la Fase 1.

### 1.6 Rischi e scelte non scontate

- **Non riscrivere `Booking`**: tenere `Event` come aggregatore preserva validator, anti-overlap, check-in QR, statistiche, audit. Filosofia "meno invasiva".
- **`ConcertInfo` deprecata ma non rotta**: la migration backfilla `Event`, la vecchia tabella resta read-only per N release. Sezione dedicata di check + test di parity in [§ 1.7](#17-check-retro-compatibilit-concertinfo).
- **Niente `task dependencies` né `Gantt`** in v1: KISS.
- **Visibilità separata dallo stato**: un evento può essere `confirmed` ma `private` (logistica interna prima della comunicazione pubblica) — come Asimut.
- **Sign-up esterni (audience)**: opzionale con flag `allowSignup` e campi `externalName/Email`; rate-limit + captcha se mai esposto pubblicamente.

### 1.7 Check retro-compatibilità `ConcertInfo`

`ConcertInfo` è già usata da 3 endpoint admin, 2 endpoint pubblici, l'export Excel
e 7 componenti frontend. La migrazione a `Event` deve essere **dual-read** finché
tutti i consumer non sono migrati. Sezione di controllo da firmare prima di
cancellare la tabella vecchia.

#### 1.7.1 Inventario superficie d'uso (snapshot v1.11.2)

| Tipo           | Path                                                                       | Ruolo                                                                                            |
| -------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Model          | `backend/models/ConcertInfo.js`                                            | Tabella `concert_info`, UNIQUE su `bookingId`, paranoid (soft delete)                            |
| Route admin    | `backend/routes/bookings.js:1597-1740`                                     | GET / PUT / DELETE `/api/bookings/:id/concert`; POST / DELETE `/api/bookings/:id/concert/poster` |
| Route pubblica | `backend/routes/public.js:130-149`                                         | `/api/public/concerts` con `required: true` su `concertInfo`                                     |
| Route pubblica | `backend/routes/public.js:223-260`                                         | Daily view kiosk: `concertTitle` derivato da `concertInfo.title`                                 |
| Service        | `backend/services/excelExporter.js:206,396-423`                            | Export Excel: prefisso `🎵 <title>` nel cellTitle                                                |
| Test           | `backend/tests/integration/publicAgendaCoverage.test.js`                   | Copertura listing pubblico                                                                       |
| Types FE       | `frontend/src/types/index.ts` → `interface ConcertInfo`                    | Tipo TS condiviso                                                                                |
| API FE         | `frontend/src/api/bookings.ts:117-138`                                     | `getConcert/saveConcert/deleteConcert/uploadConcertPoster/deleteConcertPoster`                   |
| API FE         | `frontend/src/api/public.ts:22-23,87-92`                                   | `concertTitle`, `concertsEnabled/Days/Count` (per kiosk)                                         |
| Componente     | `ConcertInfoDialog.tsx`                                                    | Form admin scheda concerto                                                                       |
| Componente     | `BookingFormDialog.tsx`                                                    | Apertura dialog scheda per booking `concerto`                                                    |
| Componenti     | `BookingListItem.tsx`, `DailyRoomTimetable.tsx`, `WeeklyRoomTimetable.tsx` | Rendering badge/titolo concerto                                                                  |
| Lib FE         | `lib/weeklyBlocks.ts`, `lib/bookings.ts`                                   | Mapping/serializzazione                                                                          |

#### 1.7.2 Strategia dual-read (fasi 1 → 4)

Durante le fasi 1-4 la verità sta su **entrambe** le entità. La regola d'oro:
**`ConcertInfo` non sparisce, viene ombreggiata da `Event`.**

1. **Migration di Fase 1 backfilla `Event` da `ConcertInfo`**, ma NON elimina
   le righe `concert_info`. Per ogni `ConcertInfo` esistente:
   - crea `Event(type='concerto', status='published', visibility='public', title, programText=program, performersText=performers, posterUrl)`
   - setta `Booking.eventId = event.id`
   - **lascia intatta** la riga `concert_info` (per fallback e per il rollback rapido)
2. **Hook Sequelize `afterCreate/afterUpdate` su `ConcertInfo`** (transitorio):
   se qualcuno chiama ancora la vecchia API `PUT /api/bookings/:id/concert`,
   il save viene propagato anche al `Event` collegato (write-through). Così
   il display pubblico, che legge dal nuovo endpoint, resta coerente.
3. **Endpoint legacy `/api/bookings/:id/concert*` restano vivi**: in Fase 1
   solo aggiornano `ConcertInfo`; in Fase 2 diventano un wrapper che scrive
   sull'`Event` corrispondente e sincronizza `ConcertInfo` (write-through);
   in Fase 5 emettono header `Deprecation: true` + `Sunset: <data>` (RFC 8594).
4. **Route pubblica `/api/public/concerts`** in Fase 5 viene marcato deprecato
   ma resta funzionante per N release; il nuovo `/api/public/events?type=concerto`
   è il path raccomandato.

#### 1.7.3 Test di parity obbligatori (gate per ogni fase)

Aggiunti a `backend/tests/integration/eventsBackcompat.test.js` (nuovo file).
**Devono restare verdi a ogni rilascio fino alla rimozione di `ConcertInfo`.**

| #   | Scenario                                                                   | Atteso                                                                                              |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Backfill iniziale: 10 `ConcertInfo` pre-esistenti                          | Crea 10 `Event` con stessi `title/performers/program/posterUrl`; ogni `Booking.eventId` valorizzato |
| 2   | `PUT /api/bookings/:id/concert` (API legacy)                               | Sia `ConcertInfo` che `Event` collegato risultano aggiornati con lo stesso `title`                  |
| 3   | `POST /api/events/:id` (API nuova) su Event con backing `ConcertInfo`      | `ConcertInfo` write-through aggiornata (fase di transizione)                                        |
| 4   | `GET /api/public/concerts` (legacy)                                        | Stesso array di concerti rispetto a v1.11.x: stessi campi `title/performers/program/posterUrl`      |
| 5   | `GET /api/public/events?type=concerto` (nuovo)                             | Superset del precedente: include anche eventi non-`concerto` se filtro rilassato                    |
| 6   | Daily kiosk view (`/api/public/agenda`)                                    | `concertTitle` resta valorizzato come prima (read da `Event.title` con fallback a `ConcertInfo`)    |
| 7   | Excel export di un mese con 5 concerti                                     | Cell title contiene `🎵 <title>` identico a v1.11.x                                                 |
| 8   | DELETE `ConcertInfo` (legacy)                                              | `Event` collegato resta vivo (è nuova fonte di verità); soft-delete su `concert_info` only          |
| 9   | DELETE `Event` (nuovo) con backing `ConcertInfo`                           | Cascade: `ConcertInfo` cancellata via `Booking.eventId=null`                                        |
| 10  | Upload poster via vecchia API + lettura via nuova                          | `Event.posterUrl` riflette l'URL appena caricato                                                    |
| 11  | Snapshot iCal (`/api/bookings/ical?token=...`) di un utente con 1 concerto | Title nell'`SUMMARY` invariato bit-a-bit rispetto a v1.11.x (riuso `services/icalService.js`)       |
| 12  | Public agenda con `concertsEnabled=true` su building                       | Stesso payload di v1.11.x (`concertsDays`, `concertsCount` rispettati)                              |

> Test 11 e 12 sono "snapshot test": confronto byte-a-byte con fixture
> generate da una v1.11.2 prima della migrazione (catturate in `tests/fixtures/v1.11.2-concerts/`).

#### 1.7.4 Definition of Done della deprecazione

`ConcertInfo` può essere rimossa (tabella + model + endpoint legacy) **solo
quando tutti questi check sono verdi**:

- [ ] Tutte le 12 righe della §1.7.3 verdi su CI per ≥ 3 release consecutive.
- [ ] Zero hit sui path legacy `/api/bookings/:id/concert*` e `/api/public/concerts`
      per ≥ 30 giorni (verificato via access log / Sentry breadcrumb).
- [ ] Frontend completamente migrato: `grep -r "concertInfo\|ConcertInfo"
  frontend/src` ritorna 0 occorrenze (tranne `types/index.ts` se mantenuto
      come alias `@deprecated`).
- [ ] Export Excel migrato a `Event.title` (rimosso include condizionale
      `excelExporter.js:422`).
- [ ] Bot Telegram: la lookup di "concerti del mese" punta a `/api/public/events?type=concerto`.
- [ ] Migrazione finale rilasciata con header `Sunset` rispettato (almeno 90
      giorni di preavviso negli header HTTP).
- [ ] Backup pre-rimozione: snapshot esplicito di `concert_info` archiviato
      off-site (Hetzner Storage Box / rclone) con retention 5 anni — per
      eventuali audit / compliance.
- [ ] Documentazione aggiornata: `docs/ARCHITECTURE.md`, `MANUALE_ADMIN.md`,
      `MANUALE_DOCENTE.md` non menzionano più "scheda concerto" come entità a sé.

#### 1.7.5 Rollback plan (Fase 1, primo deploy)

Se dopo Fase 1 emergono problemi di parity, il rollback è banale perché
`concert_info` non è stata toccata:

```sql
-- Sul DB
UPDATE bookings SET "eventId" = NULL;          -- scollega
DELETE FROM events;                             -- niente più Event (no FK out)
ALTER TABLE bookings DROP COLUMN "eventId";    -- opzionale, in re-deploy
```

Lato codice basta tornare al tag precedente (`git checkout v1.11.x` per il
backend). I dati storici dei concerti restano intatti in `concert_info`.

### 1.8 Stato attuale

⏸ **In attesa di approvazione** — proposta architetturale documentata, implementazione non ancora avviata.

---

## 2. Backlog post-1.6.0 — security, ops, performance, UX

Idee emerse dall'audit infrastruttura del 2026-05-15 (tuning Postgres + restrizione IP del kiosk) e dal pass mobile UX di v1.8.0. Ordinate per coerenza tematica, non per priorità di esecuzione.

> ✅ **§2.6 Dashboard ops** — implementata in **v1.7.0** (`/admin/ops`). Mantenuta nel backlog come riferimento storico.
> ✅ **§2.8 Backup verification automatica** — implementata in **v1.9.0** (scheduler weekly, widget in `/admin/ops`).
> ✅ **§2.10 PWA installable + offline shell** — già live (vite-plugin-pwa con Workbox, manifest, install prompt). Pre-esistente alla v1.8.0, non riconosciuta come done. Voce conservata sotto come riferimento.
> ✅ **§2.13 Off-site backup sync via rclone** + **§2.14 PITR via WAL archiving** — implementati in **v1.10.0** (ops-only: 2 script di setup + cron + docs).
> ✅ **§2.4 (parziale)** — **PM2 cluster mode + scheduler lock** implementato in **v1.10.0** (`lib/clusterRole.js` + `ecosystem.config.js`). Attivazione opt-in via VPS command. PgBouncer resta aperto.
> 🎯 **Prossimi candidati**: §2.9 GDPR self-service export (~1g) e §2.11 Slot alternativi suggeriti (~2g).

### 2.1 Sicurezza kiosk — device token per schermi mobili

**Perché**: l'allowlist nginx (CIDR pubblici dell'edificio + LAN privata) copre il caso "kiosk fisso in sede", ma non protegge tablet/laptop che escono dall'istituto (eventi, sedi temporanee, kiosk mobili al saggio in teatro).

**Cosa**: nuovo modello `DisplayToken` (`jti` + `buildingId` + `expiresAt` + `revokedAt`), endpoint admin per emettere un URL `/display?b=<slug>&t=<jwt-30gg>`. Il kiosk lo salva in `localStorage` e lo invia in header `X-Display-Token` su tutte le `/api/public/*`. Middleware `requireDisplayToken` skippabile tramite feature flag globale per backwards compatibility. UI in `/admin/display` per generare/revocare/listare i token attivi.

**Effort stimato**: ~3g · **Dipende da**: nessuna · **Coesistenza con IP allowlist**: si combinano (defense-in-depth, non si escludono).

### 2.2 Sicurezza kiosk — PIN ruotabile via mail

**Perché**: difesa contro lo scenario "visitatore in sede che si collega al WiFi guest e apre l'URL del kiosk" — non coperto né dall'IP allowlist (è dentro l'IP istituto) né dal device token (lo schermo è già autenticato).

**Cosa**: toggle per-edificio "PIN richiesto" nel modello `Building`. Scheduler che ogni lunedì 06:00 genera un PIN a 6 cifre per edificio, lo invia tramite `MailOutbox` al destinatario configurato (campo `displayPinRecipientEmail`). Lato kiosk una schermata d'ingresso "Inserisci PIN" → memorizzato in `sessionStorage` con TTL fino alla rotazione successiva. Cadenza giornaliera/settimanale configurabile.

**Effort stimato**: ~2g · **Dipende da**: nessuna (riusa `MailOutbox` + scheduler pattern di `reminderScheduler`).

### 2.3 Sicurezza kiosk — monitor esterno con alert

**Perché**: se l'IP pubblico dell'istituto cambia silenziosamente (ISP, rinegoziazione contratto, failover linea), l'allowlist nginx blocca i kiosk e nessuno se ne accorge fino a quando un operatore guarda lo schermo. Failure mode silenziosa.

**Cosa**: scheduler interno che ogni 15 min lancia `curl` su `/api/public/display-config` da un IP secondario allow-listato (loopback VPS oppure secondo Hetzner). In caso di 403 ripetuto manda mail "i kiosk potrebbero non vedere il display — verifica l'IP dell'istituto". Mail throttled per evitare spam.

**Effort stimato**: ~0.5g · **Dipende da**: utile se 2.1 o l'IP allowlist sono attivi.

### 2.4 Performance — PgBouncer + PM2 cluster mode

**Perché**: oggi `node` saturerebbe su 1 core sotto >150 utenti attivi simultanei (3 vCPU su 4 sono inattivi). Cluster mode raddoppia la capacità HTTP ma moltiplica le connessioni Postgres → PgBouncer diventa il ponte naturale (oggi non giustificato — v. analisi del 2026-05-15).

**Cosa**: `ecosystem.config.js` con `instances: 2` + `exec_mode: 'cluster'`. Lock-singleton su scheduler (`reminderScheduler`, `mailOutboxScheduler`, ecc.): solo l'istanza con `process.env.NODE_APP_INSTANCE === '0'` li avvia, le altre no — alternativa più robusta: spostarli in un worker process dedicato (`pm2 start workers/scheduler.js`). PgBouncer in transaction pooling davanti a Postgres (`pool_mode=transaction`, `default_pool_size=20`). Backend si connette a `127.0.0.1:6432` invece di `5432`. Re-run dei k6 esistenti come gate di verifica.

**Effort stimato**: ~2g · **Dipende da**: pg-tune già applicato (`max_connections=50` lascia margine per PgBouncer).

### 2.5 Observability — slow query digest settimanale

**Perché**: lo script `scripts/pg-tune-4gb.sh` ha abilitato `log_min_duration_statement=500`, quindi Postgres logga ogni query >500 ms — ma nessuno legge `/var/log/postgresql/*.log`. Il valore è sprecato.

**Cosa**: scheduler weekly (domenica 23:00) che parsa i log Postgres della settimana, normalizza le query (rimuove parametri letterali), aggrega top-20 per `total_time` e top-20 per `count`, manda mail admin con: query, count, p95 latency, e — se possibile — `EXPLAIN ANALYZE` automatico per le prime 3. Soglia mail solo se ci sono almeno N query nel digest, altrimenti silent.

**Effort stimato**: ~1g · **Dipende da**: nessuna (richiede solo che il pg-tune sia stato lanciato in produzione).

### 2.6 ✅ Dashboard ops in `/admin/ops` — IMPLEMENTATA in v1.7.0

> Riferimento storico: ora live in `/admin/ops`, vedi [`CHANGELOG.md` §1.7.0](CHANGELOG.md). Voce conservata sotto per documentare le scelte architetturali originali.

**Perché**: oggi per sapere "come sta la VPS" bisogna fare SSH e lanciare `pm2 monit + free -h + psql + tail mail-queue`. Nessuna vista admin unificata. Quando qualcosa va storto (lentezze, picchi memoria, scheduler bloccato), si scopre tardi.

**Cosa**: pagina admin con widget aggiornati ogni 10 s via SSE:

- **VPS**: load average (`os.loadavg`), RAM usata/free (`os.freemem`/`totalmem`), uptime processo, spazio disco di `/` e della partizione dei backup
- **Postgres**: numero conn attive (`pg_stat_activity`), conn idle vs active, dimensione DB, tempo dall'ultimo autovacuum sulle 3 tabelle più grandi
- **MailOutbox**: count per stato (`pending`/`sending`/`sent`/`failed`/`dead`), età della più vecchia in `pending`
- **Backup**: timestamp dell'ultimo backup OK + dimensione, alert visivo se >36 h
- **Schedulers**: ultima tick di ciascuno (reminder, retention, mailOutbox, backup, excelExport), visualizzato come "verde se <2× il proprio interval"

Endpoint backend `GET /api/admin/ops/snapshot` con cache 5 s lato server per non martellare Postgres. Frontend in `frontend/src/pages/admin/Ops.tsx`. Stessa struttura della Coda email admin esistente.

**Estensioni opzionali (post-MVP)**:

- Pulsanti "Riavvia scheduler X" per ogni scheduler bloccato (audit-loggato)
- Mini-grafico sparkline su RAM/CPU degli ultimi 60 minuti (ring buffer in memoria, non persistito)
- Toggle "modalità manutenzione" che mette il frontend in banner read-only (utile per migrazioni DB)

**Effort stimato**: ~2g MVP, ~3g con estensioni · **Dipende da**: nessuna · **Valore**: alto sia operativo sia commerciale (è una feature mostrabile in demo).

### 2.7 Feature kiosk — QR code dinamico

**Perché**: il kiosk mostra "Concerto Vivaldi · Aula Magna · 18:30" ma il passante non può portarsi via l'info. Esperienza utente "vedo e dimentico".

**Cosa**: angolo basso-destra di `Display.tsx` un QR (libreria `qrcode` o `qr-code-styling`) che cambia con l'elemento in rotazione e linka a `/public/event/<id>` (pagina già esistente o da creare). Su mobile l'utente apre dettagli evento + bottone "Aggiungi al calendario" (.ics). Per le card prenotazioni il QR può essere omesso (privacy) o linkare alla pagina pubblica dell'edificio.

**Effort stimato**: ~1g · **Dipende da**: nessuna · **Sinergia**: aumenta valore percepito del display, utile per saggi/concerti aperti al pubblico.

### 2.8 ✅ Backup verification automatica — IMPLEMENTATA in v1.9.0

> Live: scheduler weekly (default domenica 03:00) + sezione "Verifica integrità" nel widget Backup di `/admin/ops`. Vedi [`CHANGELOG.md` §1.9.0](CHANGELOG.md).

**Perché**: i backup `pg_dump` vengono creati ogni notte dallo `backupScheduler`, ma nessuno verifica che siano restorabili. Failure mode silente: l'admin scopre che il backup è corrotto solo quando ne ha bisogno (cioè quando è troppo tardi).

**Cosa (implementato — approccio shallow ma sostanziale)**: nuovo `backupVerifyScheduler.js`. Tick weekly che valida l'ultimo backup senza richiedere `CREATEDB`/scratch DB:

1. File esiste e size > 1KB
2. Età < 36h (configurabile via `BACKUP_VERIFY_MAX_AGE_HOURS`)
3. Tarball strutturalmente safe (riusa `validateTarball` di `backupRestore.js`)
4. `manifest.json` parseabile + campo `contents` contiene "db"
5. `database.sql` size > 1KB (configurabile)
6. Dump contiene `CREATE TABLE` per `Users`, `Bookings`, `Rooms`, `Buildings`
7. Dump ha sezione dati (COPY o INSERT INTO)
8. Numero `CREATE TABLE` nel dump entro ±2 vs `information_schema.tables` di prod

Mail admin (kind=security, priority=0, idempotency per giorno+reason) solo se almeno una verifica fallisce. Stato esposto in `/admin/ops` come sezione "Verifica integrità" del widget Backup. Configurabile via env (`BACKUP_VERIFY_ENABLED`, `BACKUP_VERIFY_DAY/HOUR/MINUTE`, soglie).

**Failure mode catturati**: backup mancante/vecchio, file corrotto, gzip/tar truncato, dump senza tabelle critiche, dump senza dati, schema disallineato. **Non catturati**: errori SQL logici (richiederebbero deep restore — futura estensione se serve).

**Effort effettivo**: ~½g · **Dipende da**: `backupScheduler` + `MailOutbox` esistenti.

### 2.9 GDPR self-service export

**Perché**: l'Art. 15 GDPR (diritto di accesso) e Art. 20 (portabilità) impongono che ogni utente possa scaricare i propri dati personali. Oggi una richiesta del genere obbliga un admin a query SQL manuali — non scala e rischia di omettere tabelle.

**Cosa**: nuovo bottone in `/profile` "Scarica i miei dati" (sezione Privacy). Endpoint `GET /api/users/me/export` che produce uno ZIP con file JSON per categoria:

- `profile.json` — dati anagrafici, contractType, monteOreOverride, foto URL
- `bookings.json` — tutte le prenotazioni proprie (passate + future + annullate)
- `loans.json` — richieste prestito strumenti
- `monte_ore.json` — proposte e amendments (se applicabile)
- `audit_log.json` — record di `AuditLog` con `userId` = me (chi ha fatto cosa sui miei dati)
- `consents.json` — consensi privacy granted/revoked con timestamp
- `README.txt` — descrizione delle categorie e riferimento Art. 15

Rate-limit: 1 export ogni 24h per utente (l'export è asincrono se il dataset è grande, mail "il tuo export è pronto" con link temporaneo).

**Effort stimato**: ~1g · **Dipende da**: nessuna · **Bonus**: prepara il terreno per il "diritto all'oblio" (Art. 17) — endpoint `DELETE /api/users/me` con anonimizzazione cascadable.

### 2.10 ✅ PWA installable + offline shell — GIÀ LIVE (pre-1.8.0)

> Status scoperto durante il pass v1.9.0: già configurata con `vite-plugin-pwa` + Workbox. Manifest in `public/manifest.webmanifest`, icone (192/512/maskable), service worker con runtime caching strategico, componente `InstallPwaPrompt.tsx` per A2HS. Configurazione completa in `frontend/vite.config.ts`. Voce conservata sotto come riferimento storico.

**Perché**: dopo l'overhaul mobile di v1.8.0 l'esperienza su iPhone/Android è "quasi nativa" ma non installabile né resiliente al network. Aggiungere PWA significa: icona homescreen, splash screen, apertura standalone (no chrome browser), capacità offline read-only per consultare le ultime prenotazioni viste.

**Cosa**: `vite-plugin-pwa` con manifest che usa `logo3.png` come icon canonica (vedi feedback memory). Service worker Workbox con strategy:

- **NetworkFirst** su `/api/*` (con timeout 3s → cache)
- **StaleWhileRevalidate** su `/api/rooms/*` e `/api/buildings/*` (poco mutevoli)
- **CacheFirst** su asset statici (fonts, images, CSS, JS bundle)
- **NetworkOnly** su `/api/auth/*` (no cache su token)

Banner discreto "Aggiungi a Home" che appare solo su mobile la seconda volta che l'utente apre l'app (criterio "user engagement"). Indicatore stato connessione nell'header (offline → banner giallo "Modalità offline · dati al ...timestamp...").

**Effort originale stimato**: ~2g · **Effort effettivo**: 0g (già pre-esistente).

### 2.11 Slot alternativi suggeriti su conflitto

**Perché**: oggi quando un utente tenta una prenotazione su uno slot già occupato vede solo l'errore generico "slot non disponibile". Frustrazione massima, soprattutto su mobile dove ricominciare il flusso è oneroso.

**Cosa**: estendere il response 409 di `POST /api/bookings` quando il fail è per overlap. Oltre al messaggio, includere campo `suggestions: [{roomId, start, end, reason}]` con 3-5 alternative ordinate per "vicinanza":

1. Stessa aula, ±30/60/120 min dall'orario richiesto
2. Aula compatibile (stesso building, stessa capacity, stesso tipo se richiesto strumento specifico) nello stesso orario
3. Stessa aula+orario il giorno successivo (utile per chi flessibile sul quando)

UI in `BookingFormDialog`: quando il POST fallisce mostra "Alternative disponibili" con card cliccabili che pre-fillano il form (`setDefaults({roomId, start, end})`). Una sola riga di codice cliente per chip.

**Effort stimato**: ~2g · **Dipende da**: nessuna · **Sinergia**: aumenta conversion rate (utente non abbandona dopo il primo NO), riduce frustrazione mobile dove ricominciare il flusso è costoso.

### 2.13 Off-site backup sync via rclone

**Perché**: oggi i backup vivono nella stessa VPS che genera i dati. Failure mode catastrofico: la VPS prende fuoco / viene compromessa / muore HW → perdi anche tutti i backup. Serve copia esterna automatica.

**Cosa (implementato in v1.10.0 come ops-only, niente codice Cadenza)**: riusa il pattern già esistente di `setup-rclone-sync.sh` per l'Excel export — Cadenza scrive backup localmente, rclone a livello SO sincronizza verso un remote cloud (OneDrive, Dropbox, S3, ecc.). Vantaggi:

- **Zero codice Cadenza**: separazione pulita, il backend non sa nemmeno che esiste OneDrive
- **Multi-cloud agnostico**: rclone parla con 70+ backend (OneDrive Personal/Business, Google Drive, S3, Hetzner Storage Box, Backblaze B2…)
- **Niente secret nel repo**: il token rclone vive in `~/.config/rclone/rclone.conf` di un utente OS dedicato
- **Versioning gratis su OneDrive**: file con stesso nome vengono versionati 30gg → secondo livello di "PITR low-cost"

**Setup**: `scripts/setup-rclone-backups.sh <remote-name> [<folder>]` — installa cron giornaliero (default 04:00, dopo backup nightly + verify weekly) + cleanup mensile (retention configurable, default 90gg).

**Effort**: 0g codice + 30 min ops (configurare rclone una tantum + lanciare lo script). Coppia naturale con §2.14 PITR.

### 2.14 PITR via WAL archiving

**Perché**: i backup full giornalieri permettono restore allo stato di mezzanotte, ma per recuperare "le ultime 3 ore di modifiche prima del disastro" servono i WAL (Write-Ahead Logs) Postgres archiviati continuamente.

**Cosa (implementato in v1.10.0 come ops-only)**: script `scripts/setup-wal-archiving.sh` che abilita Postgres archive mode con `archive_command` che pusha ogni WAL via rclone allo stesso remote dei backup full. Combinato con §2.13, restore PITR funziona così:

1. Restore del backup full più vicino al timestamp target (es. mezzanotte)
2. Apply dei WAL fino al target (es. 14:32:18) via `recovery_target_time` in postgresql.conf
3. Postgres riapplica le transazioni fino al secondo desiderato

**Effort**: 0g codice + ~30 min ops (configurare rclone per user `postgres` + lanciare lo script + restart Postgres). Tool di restore: `pgBackRest` o `Barman` consigliati per setup mature; per Cadenza scale `restore_command` manuale + recovery target è sufficiente.

**Caveat**: aumenta il volume di dati uscenti (~ 16MB per ogni segmento WAL × volume transazioni). Per un conservatorio scale è trascurabile (<1GB/mese), per scale enterprise valuta retention più stretta.

### 2.12 Conflict-aware bulk booking (docenti)

**Perché**: un docente con corso ricorrente ("aula X tutti i lunedì 14-16 per 3 mesi") oggi può usare il flag ricorrente del booking, ma se **anche un solo** slot generato è occupato la transazione fallisce in atomico → o riprende a mano slot per slot, o rinuncia. Frustrazione massima per il caso d'uso più comune dei docenti titolari.

**Cosa**: wizard "Prenotazione ricorrente avanzata" (accessibile da `BookingFormDialog` quando l'utente attiva il toggle "ricorrenza" + ruolo docente/admin) con 3 step:

1. **Definizione**: aula, frequenza (daily/weekly), giorni della settimana, orario, range date (da/a)
2. **Preview**: anteprima della lista di tutti gli slot generati (es. 13 lunedì), ognuno con badge: ✅ libero, ⚠️ conflitto (con dettaglio "occupato da Tizio per Y") o ❌ aula chiusa (fuori orari operativi)
3. **Aggiusta e conferma**: l'utente può deselezionare i conflittuali, cliccare "Trova alternativa" per ogni conflitto (riusa §2.11), confermare → POST atomico solo degli slot selezionati

Endpoint: `POST /api/bookings/bulk-preview` (read-only, ritorna tutti i conflitti senza scrivere) + `POST /api/bookings/bulk-create` (transazione su array di booking pre-validati).

**Effort stimato**: ~4g · **Dipende da**: §2.11 (riusa la logica di "alternativa") · **Categoria**: UX docente power-user · **Coda**: alta priorità per ASIMUT parity (vedi §1.6).

### 2.16 Stima e priorità complessiva

> Tabella aggiornata al 2026-05-15 (post v1.10.0). §2.6, §2.8, §2.10, §2.13, §2.14 ✅ done — rimosse dalla coda. §2.4 partial: PM2 cluster mode lock implementato in v1.10.0, PgBouncer ancora aperto.

| #    | Voce                                  | Effort | Categoria       | Coda                   |
| ---- | ------------------------------------- | ------ | --------------- | ---------------------- |
| 2.1  | Device token kiosk mobili             | ~3g    | Security        | Quando serve           |
| 2.2  | PIN ruotabile via mail                | ~2g    | Security        | Quando serve           |
| 2.3  | Monitor esterno + alert               | ~0.5g  | Ops resilience  | Quando serve           |
| 2.4  | PgBouncer (PM2 cluster ✅ in v1.10.0) | ~1g    | Performance     | Se >150 utenti         |
| 2.5  | Slow query digest settimanale         | ~1g    | Observability   | Quando serve           |
| 2.6  | ~~Dashboard ops `/admin/ops`~~        | —      | ✅ done v1.7.0  | —                      |
| 2.7  | QR code dinamico sul display          | ~1g    | Feature kiosk   | Quando serve           |
| 2.8  | ~~Backup verification automatica~~    | —      | ✅ done v1.9.0  | —                      |
| 2.9  | **GDPR self-service export** 🎯       | ~1g    | Compliance      | **Prossimo candidato** |
| 2.10 | ~~PWA installable + offline shell~~   | —      | ✅ pre-1.8.0    | —                      |
| 2.11 | **Slot alternativi suggeriti** 🎯     | ~2g    | UX/conversion   | **Prossimo candidato** |
| 2.12 | Conflict-aware bulk booking           | ~4g    | UX docente      | Pre-requisito §1       |
| 2.13 | ~~Off-site backup sync via rclone~~   | —      | ✅ done v1.10.0 | —                      |
| 2.14 | ~~PITR via WAL archiving~~            | —      | ✅ done v1.10.0 | —                      |

**Totale backlog aperto**: ~15g se eseguito interamente. Tutti scope indipendenti tranne 2.12 che dipende da 2.11.

---

## 3. Sprint correnti

Sezione da popolare man mano che vengono aperti gli sprint operativi. Per ora rimangono validi gli sprint elencati nel README (§ 9):

- Bot Telegram MVP completo; scaffolding WhatsApp Cloud / Signal / Email
- Push notifications Web Push API
- Embed iframe per concerti pubblici
- Privacy granulare display kiosk

---

## 4. Riferimenti

- [`README.md`](README.md) — overview, stack, stato production-ready
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architettura sistema, modelli dati
- [`docs/install.md`](docs/install.md) — installazione + provider VPS + sizing utenti
- [`docs/AUDIT_QUALITA_PRODUZIONE.md`](docs/AUDIT_QUALITA_PRODUZIONE.md) — audit qualità & checklist produzione
- [`scripts/pg-tune-4gb.sh`](scripts/pg-tune-4gb.sh) — tuning Postgres VPS 4 GB (prerequisito di 2.5)
- [`scripts/setup-pgbouncer.sh`](scripts/setup-pgbouncer.sh) — transaction pooling (prerequisito cluster mode)
- [`develop-enterprise.md`](develop-enterprise.md) — roadmap enterprise (LDAP, SAML, RFID)
