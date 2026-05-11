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

## 2. Sprint correnti

Sezione da popolare man mano che vengono aperti gli sprint operativi. Per ora rimangono validi gli sprint elencati nel README (§ 9):

- Bot Telegram MVP completo; scaffolding WhatsApp Cloud / Signal / Email
- Push notifications Web Push API
- Embed iframe per concerti pubblici
- Privacy granulare display kiosk

---

## 3. Riferimenti

- [`README.md`](README.md) — overview, stack, stato production-ready
- [`docs/ANALISI_TIPI_PRENOTAZIONE.md`](docs/ANALISI_TIPI_PRENOTAZIONE.md) — studio sui tipi di prenotazione (Opzione B referenziata in Fase 0)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architettura sistema, modelli dati
- [`develop-enterprise.md`](develop-enterprise.md) — roadmap enterprise (LDAP, SAML, RFID)
