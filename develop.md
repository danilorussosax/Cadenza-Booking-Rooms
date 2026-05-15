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

Eseguire l'**Opzione B** già istruita in [`docs/ANALISI_TIPI_PRENOTAZIONE.md`](docs/ANALISI_TIPI_PRENOTAZIONE.md) aggiungendo all'ENUM `Booking.type` i valori `masterclass`, `esame`, `seminario`, `evento` + entries seed in `BookingTypeCatalog`.

Procedura passo-passo: `docs/ANALISI_TIPI_PRENOTAZIONE.md:113-206`.

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

- **Non riscrivere `Booking`**: tenere `Event` come aggregatore preserva validator, anti-overlap, check-in QR, statistiche, audit. Coerente con la filosofia "meno invasiva" di [`docs/ANALISI_TIPI_PRENOTAZIONE.md`](docs/ANALISI_TIPI_PRENOTAZIONE.md).
- **`ConcertInfo` deprecata ma non rotta**: la migration backfilla `Event`, la vecchia tabella resta read-only per N release.
- **Niente `task dependencies` né `Gantt`** in v1: KISS.
- **Visibilità separata dallo stato**: un evento può essere `confirmed` ma `private` (logistica interna prima della comunicazione pubblica) — come Asimut.
- **Sign-up esterni (audience)**: opzionale con flag `allowSignup` e campi `externalName/Email`; rate-limit + captcha se mai esposto pubblicamente.

### 1.7 Stato attuale

⏸ **In attesa di approvazione** — proposta architetturale documentata, implementazione non ancora avviata.

---

## 2. Backlog post-1.6.0 — security, ops, performance, UX

Idee emerse dall'audit infrastruttura del 2026-05-15 (tuning Postgres + restrizione IP del kiosk) e dal pass mobile UX di v1.8.0. Ordinate per coerenza tematica, non per priorità di esecuzione.

> ✅ **§2.6 Dashboard ops** — implementata in **v1.7.0** (`/admin/ops`). Mantenuta nel backlog come riferimento storico.
> 🎯 **Priorità candidate**: §2.8 Backup verification + §2.10 PWA installable (rapporto ROI/effort più alto, vedi §2.13).

### 2.1 Sicurezza kiosk — device token per schermi mobili

**Perché**: la [`docs/KIOSK_IP_ALLOWLIST.md`](docs/KIOSK_IP_ALLOWLIST.md) (nginx allowlist) copre il caso "kiosk fisso in sede", ma non protegge tablet/laptop che escono dall'istituto (eventi, sedi temporanee, kiosk mobili al saggio in teatro).

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

### 2.8 Backup verification automatica

**Perché**: oggi i backup `pg_dump` vengono creati ogni notte dallo `backupScheduler`, ma nessuno verifica che siano effettivamente restorabili. Failure mode silente: l'admin scopre che il backup è corrotto solo quando ne ha bisogno (cioè quando è troppo tardi).

**Cosa**: nuovo scheduler weekly (es. domenica 03:00) che prende l'ultimo backup OK, lo restora su un database scratch temporaneo (es. `cadenza_backup_verify`), confronta vs prod: conteggio righe sulle tabelle critiche (`Users`, `Bookings`, `Rooms`, `Buildings`, `InstrumentLoans`), validità foreign key (`pg_constraint` check), schema diff. Drop del DB scratch alla fine. Mail admin solo se anomalia (diff >2% o errore restore), altrimenti silent. Espone lo stato in `/admin/ops` come nuovo widget "Backup integrity: ultima verifica OK/FAIL".

**Effort stimato**: ~½g · **Dipende da**: `backupScheduler` esistente · **Note**: usa `pg_restore` con utente dedicato `cadenza_verify` con privilegi minimi (CREATE DATABASE + DROP solo sul DB scratch).

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

### 2.10 PWA installable + offline shell

**Perché**: dopo l'overhaul mobile di v1.8.0 l'esperienza su iPhone/Android è "quasi nativa" ma non installabile né resiliente al network. Aggiungere PWA significa: icona homescreen, splash screen, apertura standalone (no chrome browser), capacità offline read-only per consultare le ultime prenotazioni viste.

**Cosa**: `vite-plugin-pwa` con manifest che usa `logo3.png` come icon canonica (vedi feedback memory). Service worker Workbox con strategy:

- **NetworkFirst** su `/api/*` (con timeout 3s → cache)
- **StaleWhileRevalidate** su `/api/rooms/*` e `/api/buildings/*` (poco mutevoli)
- **CacheFirst** su asset statici (fonts, images, CSS, JS bundle)
- **NetworkOnly** su `/api/auth/*` (no cache su token)

Banner discreto "Aggiungi a Home" che appare solo su mobile la seconda volta che l'utente apre l'app (criterio "user engagement"). Indicatore stato connessione nell'header (offline → banner giallo "Modalità offline · dati al ...timestamp...").

**Effort stimato**: ~2g · **Dipende da**: nessuna · **Note**: zero impatto backend. Su iOS Safari il supporto è parziale (no push notifications su PWA installata) — coperto da §2.13 Web Push come complemento, vedi `develop-enterprise.md` se promosso.

### 2.11 Slot alternativi suggeriti su conflitto

**Perché**: oggi quando un utente tenta una prenotazione su uno slot già occupato vede solo l'errore generico "slot non disponibile". Frustrazione massima, soprattutto su mobile dove ricominciare il flusso è oneroso.

**Cosa**: estendere il response 409 di `POST /api/bookings` quando il fail è per overlap. Oltre al messaggio, includere campo `suggestions: [{roomId, start, end, reason}]` con 3-5 alternative ordinate per "vicinanza":

1. Stessa aula, ±30/60/120 min dall'orario richiesto
2. Aula compatibile (stesso building, stessa capacity, stesso tipo se richiesto strumento specifico) nello stesso orario
3. Stessa aula+orario il giorno successivo (utile per chi flessibile sul quando)

UI in `BookingFormDialog`: quando il POST fallisce mostra "Alternative disponibili" con card cliccabili che pre-fillano il form (`setDefaults({roomId, start, end})`). Una sola riga di codice cliente per chip.

**Effort stimato**: ~2g · **Dipende da**: nessuna · **Sinergia**: aumenta conversion rate (utente non abbandona dopo il primo NO), riduce frustrazione mobile dove ricominciare il flusso è costoso.

### 2.12 Conflict-aware bulk booking (docenti)

**Perché**: un docente con corso ricorrente ("aula X tutti i lunedì 14-16 per 3 mesi") oggi può usare il flag ricorrente del booking, ma se **anche un solo** slot generato è occupato la transazione fallisce in atomico → o riprende a mano slot per slot, o rinuncia. Frustrazione massima per il caso d'uso più comune dei docenti titolari.

**Cosa**: wizard "Prenotazione ricorrente avanzata" (accessibile da `BookingFormDialog` quando l'utente attiva il toggle "ricorrenza" + ruolo docente/admin) con 3 step:

1. **Definizione**: aula, frequenza (daily/weekly), giorni della settimana, orario, range date (da/a)
2. **Preview**: anteprima della lista di tutti gli slot generati (es. 13 lunedì), ognuno con badge: ✅ libero, ⚠️ conflitto (con dettaglio "occupato da Tizio per Y") o ❌ aula chiusa (fuori orari operativi)
3. **Aggiusta e conferma**: l'utente può deselezionare i conflittuali, cliccare "Trova alternativa" per ogni conflitto (riusa §2.11), confermare → POST atomico solo degli slot selezionati

Endpoint: `POST /api/bookings/bulk-preview` (read-only, ritorna tutti i conflitti senza scrivere) + `POST /api/bookings/bulk-create` (transazione su array di booking pre-validati).

**Effort stimato**: ~4g · **Dipende da**: §2.11 (riusa la logica di "alternativa") · **Categoria**: UX docente power-user · **Coda**: alta priorità per ASIMUT parity (vedi §1.6).

### 2.13 Stima e priorità complessiva

> Tabella aggiornata al 2026-05-15 (post v1.8.0). §2.6 ✅ done in v1.7.0 — rimossa dalla coda.

| #    | Voce                                   | Effort | Categoria      | Coda                  |
| ---- | -------------------------------------- | ------ | -------------- | --------------------- |
| 2.1  | Device token kiosk mobili              | ~3g    | Security       | Quando serve          |
| 2.2  | PIN ruotabile via mail                 | ~2g    | Security       | Quando serve          |
| 2.3  | Monitor esterno + alert                | ~0.5g  | Ops resilience | Quando serve          |
| 2.4  | PgBouncer + PM2 cluster mode           | ~2g    | Performance    | Se >150 utenti        |
| 2.5  | Slow query digest settimanale          | ~1g    | Observability  | Quando serve          |
| 2.6  | ~~Dashboard ops `/admin/ops`~~         | —      | ✅ done v1.7.0 | —                     |
| 2.7  | QR code dinamico sul display           | ~1g    | Feature kiosk  | Quando serve          |
| 2.8  | **Backup verification automatica** 🎯  | ~½g    | Ops resilience | **Quick win**         |
| 2.9  | GDPR self-service export               | ~1g    | Compliance     | Quando serve          |
| 2.10 | **PWA installable + offline shell** 🎯 | ~2g    | UX mobile      | **Naturale post-1.8** |
| 2.11 | Slot alternativi suggeriti             | ~2g    | UX/conversion  | Quando serve          |
| 2.12 | Conflict-aware bulk booking            | ~4g    | UX docente     | Pre-requisito §1      |

**Totale backlog aperto**: ~19g se eseguito interamente. Tutti scope indipendenti tranne 2.12 che dipende da 2.11. Quick win: 2.8 + 2.9 in 1.5g totali (zero rischio, alto valore difensivo).

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
- [`docs/ANALISI_TIPI_PRENOTAZIONE.md`](docs/ANALISI_TIPI_PRENOTAZIONE.md) — studio sui tipi di prenotazione (Opzione B referenziata in Fase 0)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architettura sistema, modelli dati
- [`docs/KIOSK_IP_ALLOWLIST.md`](docs/KIOSK_IP_ALLOWLIST.md) — restrizione IP nginx del kiosk (base sopra cui poggiano 2.1-2.3)
- [`scripts/pg-tune-4gb.sh`](scripts/pg-tune-4gb.sh) — tuning Postgres VPS 4 GB (prerequisito di 2.5)
- [`develop-enterprise.md`](develop-enterprise.md) — roadmap enterprise (LDAP, SAML, RFID)
