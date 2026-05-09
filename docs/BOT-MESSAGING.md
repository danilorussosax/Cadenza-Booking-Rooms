# Bot messaging — Telegram / WhatsApp / Signal / Email

Cadenza espone un bot conversazionale che permette agli utenti di prenotare le aule via messaggio. Supporta 4 canali pluggable, ciascuno gestito da un adapter dedicato.

> **Implementazione attuale**: Telegram = pieno (production-ready). WhatsApp Cloud API = scaffolding completo (verifica handshake, send/receive, HMAC) ma richiede onboarding Meta Business. Signal (`signal-cli`) e Email IMAP = stub funzionali per la pipeline interna; il trigger inbound vero richiederà uno sprint dedicato.

> **Riferimenti codice**: `backend/services/messaging/`, `backend/routes/messagingWebhook.js`, `backend/routes/botBindings.js`, `backend/routes/messagingSettings.js`, `frontend/src/components/profile/BotBindingsSection.tsx`, `frontend/src/pages/admin/MessagingSettings.tsx`.

---

## 1. Architettura

```
                ┌─────────────────────────────┐
                │      Cadenza API          │
                │   (booking, validator…)     │
                └──────────────▲──────────────┘
                               │ services/bookingValidator
                               │ + services/messaging
                ┌──────────────┴──────────────┐
                │   services/messaging/       │
                │     index.js (orchestratore)│
                │   - rate limit              │
                │   - binding check           │
                │   - intent + state machine  │
                │   - audit log               │
                └──────────────▲──────────────┘
                               │
   ┌─────────────┬─────────────┼─────────────┬─────────────┐
   │             │             │             │             │
┌──┴────┐   ┌────┴───┐   ┌─────┴───┐   ┌─────┴────┐   ┌────┴───┐
│telegram│   │whatsapp│   │ signal  │   │  email   │   │ future │
│ Bot API│   │  Cloud │   │  -cli   │   │  IMAP    │   │        │
└────────┘   └────────┘   └─────────┘   └──────────┘   └────────┘
```

**Pipeline di una request inbound** (POST /api/messaging/{channel}/webhook):

1. `routes/messagingWebhook.js` carica config canale + adapter
2. Adapter verifica firma webhook (HMAC SHA256 / secret token / etc.)
3. Endpoint risponde **200 immediato** al provider (evita retry storm)
4. Async: adapter parsa payload → IncomingMessage `{channel, externalId, text, raw}`
5. `services/messaging.handleIncoming`:
   - Rate limit `(channel, externalId)` — 30/min, 200/giorno, cooldown 1h
   - Audit log inbound
   - Cerca `BotBinding` per `(channel, externalId)`
     - Se assente: accetta solo `bind <OTP>`, altrimenti rifiuta con messaggio standard
   - Carica/crea `ChatSession`
   - `intent.handle({ text, user, session })` → reply
   - Audit log outbound
6. Adapter `send(externalId, reply, config)` invia il messaggio

**Sicurezza**:

- Tutti i secret (botToken, accessToken, appSecret, webhookSecret) sono cifrati a riposo via `lib/crypto` (AES-256-GCM con `ENCRYPTION_KEY`).
- Webhook signature obbligatoria — payload non firmato → 401.
- Bot **NON** bypassa `bookingValidator`: rules/quotas/requiresApproval rispettate identicamente al frontend.
- Audit log per ogni messaggio in/out (`target_type='ChatMessage'`).
- Rate limit in-memory; cooldown 1h dopo flood.

**Privacy**:

- `botBindingChallenge` su User come hash bcrypt + scadenza 10 min.
- `BotBinding.externalIdMasked` nella UI: chat_id parzialmente nascosto.
- Sub-processor (Meta/Twilio per WhatsApp) da dichiarare in `Institute` form.
- Rifiuto per numeri non bound: messaggio uniforme che non rivela informazioni su utenti registrati.

---

## 2. Setup Telegram (production-ready, 2 minuti)

**Costo**: 0 €/mese, volumi senza limiti pratici.

> **⭐ Da v2.7 il setup è 1 click** dopo aver creato il bot su @BotFather. Il bottone **"Configura automaticamente"** sulla scheda Telegram fa per te: generazione del webhook secret, registrazione del webhook su Telegram, pubblicazione della lista comandi, descrizione lunga e breve. Niente curl, niente openssl.

### 2.1 Crea il bot su @BotFather

1. Apri Telegram → cerca **@BotFather** → `/newbot`
2. Scegli un nome ("Cadenza Conservatorio") e uno username (`cadenza_conservatorio_bot`)
3. BotFather risponde con il **token** (formato `12345:AAAA…`). Conservalo.

### 2.2 Configura Cadenza (modalità automatica — consigliata)

1. Login admin → **Impostazioni server → Servizi → Messaging**.
2. Card **Telegram**: incolla il `Bot token` (lascia vuoto il `Webhook secret`).
3. Click **Salva** una volta.
4. Click **Configura automaticamente** ⭐.

Cadenza esegue in sequenza:

| Step                    | Cosa fa                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `getMe`                 | Verifica che il token sia valido e recupera lo username del bot                                      |
| (genera secret)         | Crea un webhook secret di 32 byte hex e lo salva cifrato nel DB                                      |
| `setWebhook`            | Registra `https://<FRONTEND_URL>/api/messaging/telegram/webhook` su Telegram con quel secret         |
| `setMyCommands`         | Pubblica `/help`, `/book`, `/list`, `/cancel`, `/check` nel menu del bot (visibile in tutte le chat) |
| `setMyDescription`      | Imposta il testo lungo "Cadenza — prenota le aule del Conservatorio…" mostrato all'apertura del bot  |
| `setMyShortDescription` | Imposta il testo breve usato nei link condivisi al bot                                               |
| `getWebhookInfo`        | Conferma finale che il webhook è registrato sull'URL atteso e non ci sono errori in pending          |

L'esito di ogni step viene mostrato in un alert info (✓ verde / ⚠ ambra per i warning non bloccanti). Se uno step opzionale come `setMyDescription` viene rate-limitato da Telegram (raro), gli altri vanno comunque a buon fine e il bot resta operativo.

> **Pre-requisito**: `FRONTEND_URL` impostato a un URL pubblico HTTPS (Telegram rifiuta `http://` e i loopback). In dev usa un tunnel come ngrok/cloudflared e impostalo come `FRONTEND_URL`.

> **Idempotente**: cliccare di nuovo "Configura automaticamente" non rompe nulla — re-invia gli stessi valori. Utile dopo una migrazione di dominio.

### 2.3 Configura Cadenza (modalità manuale — alternativa)

Se preferisci controllare ogni passaggio:

1. Genera il webhook secret a mano:
   ```bash
   openssl rand -hex 32
   ```
2. Card Telegram: incolla `Bot token` + `Webhook secret` → toggle ON → **Salva**.
3. Click **Test connessione** → deve risultare `Connessione OK · {"username":"…"}`.
4. Registra il webhook (sostituisci `TOKEN` e `SECRET`):
   ```bash
   curl -F "url=https://cadenza.example.it/api/messaging/telegram/webhook" \
        -F "secret_token=SECRET" \
        https://api.telegram.org/botTOKEN/setWebhook
   ```
   Risposta attesa: `{"ok":true,"result":true,"description":"Webhook was set"}`.

### 2.4 Test end-to-end

1. Sul tuo profilo Cadenza → sezione **Bot messaging** → `Genera codice`
2. Copia il comando `bind XXXXXX`
3. Apri il tuo bot Telegram, manda il comando
4. Il bot risponde "✅ Collegamento completato" → ora puoi usare `/help`, `/book`, `/list`, `/cancel`

---

## 3. Setup WhatsApp Cloud API

**Costo**: 1000 conversazioni di servizio gratis/mese, oltre ~€0.04 ciascuna in EU.

### 3.1 Onboarding Meta Business (1-3 settimane)

1. Crea **Meta Business Account**: https://business.facebook.com
2. Verifica l'azienda (richiede docs ufficiali, P.IVA, ecc.)
3. Crea **WhatsApp Business** sotto la business account
4. Aggiungi un numero di telefono dedicato (no SIM personale!)
5. Crea una **Meta Business app** (https://developers.facebook.com/apps) → Add product → WhatsApp

### 3.2 Recupera credenziali

Dalla dashboard:

| Credenziale         | Dove                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Phone Number ID** | WhatsApp → API Setup                                                                                                         |
| **Access Token**    | WhatsApp → API Setup. Per produzione genera un **System User** con permessi `whatsapp_business_messaging` (token long-lived) |
| **App Secret**      | App settings → Basic                                                                                                         |
| **Verify Token**    | Stringa random scelta da te (es. `openssl rand -hex 16`)                                                                     |

### 3.3 Configura Cadenza

1. `/admin/messaging` → Card **WhatsApp Cloud API**: salva tutti e 4 i campi
2. Toggle ON → Salva

### 3.4 Webhook su Meta

1. Dashboard app Meta → WhatsApp → Configuration → Webhooks → **Edit**
2. Callback URL: `https://cadenza.example.it/api/messaging/whatsapp_cloud/webhook`
3. Verify token: lo stesso che hai messo in Cadenza
4. Click **Verify and save** (Meta fa una GET di handshake immediata)
5. Sotto **Webhook fields** → Subscribe a: `messages`

### 3.5 Test

Manda un WhatsApp al numero dedicato → atteso messaggio "Numero non riconosciuto…" se non sei bindato. Bind via `/profile` → `bind <OTP>` → ok.

> ⚠️ **24h rule**: dopo 24 ore dall'ultimo messaggio inbound dell'utente, ogni messaggio outbound DEVE essere un **template approvato** (categoria `utility` per conferme prenotazione, `marketing` solo con opt-in). I template si gestiscono dalla dashboard Meta — non implementati in questa versione MVP, ma facilmente aggiungibili in `adapters/whatsapp_cloud.js#sendTemplate`.

---

## 4. Setup Signal (signal-cli)

**Costo**: 0 € software (numero dedicato eventualmente low-cost).

### 4.1 Host signal-cli

Docker consigliato:

```yaml
# docker-compose.signal.yml
services:
  signal-cli:
    image: bbernhard/signal-cli-rest-api:latest
    restart: unless-stopped
    ports:
      - '8080:8080'
    volumes:
      - ./signal-data:/home/.local/share/signal-cli
    environment:
      - MODE=normal
```

### 4.2 Registra il numero

```bash
docker exec -it signal-cli signal-cli -a +393331234567 register
# inserisci il codice ricevuto via SMS
docker exec -it signal-cli signal-cli -a +393331234567 verify <CODE>
```

### 4.3 Configura Cadenza

1. `/admin/messaging` → Card **Signal**:
   - **Numero registrato**: `+393331234567`
   - **URL daemon**: `http://signal-cli:8080` (o IP esterno)
   - **Webhook secret**: stringa random (`openssl rand -hex 32`)
2. Toggle ON → Salva

### 4.4 Inbound forwarder

`signal-cli-rest-api` espone `POST /v1/receive` per fare polling. Per il flusso webhook serve un piccolo wrapper che faccia poll e POST verso Cadenza con header `X-Signal-Webhook-Secret`. Esempio in `scripts/signal-poller.example.js` (da creare nel proprio deploy).

> Lo stub funzionale di `adapters/signal_cli.js` è già completo — manca solo il forwarder esterno per attivarlo.

---

## 5. Setup Email IMAP (stub)

Adapter incluso ma il poller IMAP non è ancora implementato. Roadmap Sprint 5+. Per ora, configurare i campi non produce messaggi inbound.

---

## 6. Comandi utente del bot

```
📅 Vista d'insieme
/aule (alias /rooms)             → elenco aule prenotabili (nome + codice + tipo)
/agenda [data]                   → chi prenota cosa nel giorno, raggruppato per sede
/oggi                            → alias /agenda (oggi)
/domani                          → alias /agenda (domani)
/libere [@sede] [data] [ora]     → cerca aule libere con filtri opzionali

📝 Prenotazione
/book                            → wizard 5-step (sede → aula → quando → tipo → conferma)
/book <codice> ven 14-15         → shortcut: aula + giorno + ora (tipo chiesto a parte)
/book <codice> ven 14-15 lezione → shortcut completo (anche il tipo)
/list                            → ultime 5 prenotazioni future dell'utente
/cancel <id> [motivo]            → annulla
/check <codice> venerdì          → slot liberi del giorno per UNA specifica aula
/check <codice>@<sede> venerdì   → idem, scoping sulla sede (per aule omonime)

ℹ️ Altro
/help                            → guida completa
bind XXXXXX                      → completa il binding (solo prima volta)
annulla                          → esce dal wizard
```

### 6.0 Vista d'insieme: `/aule`, `/agenda` e `/libere`

Pensati per dare una **panoramica** prima di prenotare:

- **`/aule`** mostra l'elenco di tutte le aule prenotabili, **raggruppate per sede**, con nome + codice tra backtick + tipo + capienza. Utile per memorizzare i codici da usare poi con `/book A12` o `/check A12 venerdì`. Edifici cestinati e aule con `isBookable=false` sono esclusi automaticamente.
- **`/agenda [data]`** mostra il **calendario del giorno** su tutte le aule. Per ognuna: 🟢 libera oppure 🟡 con la lista dei range orari occupati. Le prenotazioni in attesa di approvazione sono marcate con ⏳. Default: oggi. Accetta gli stessi formati data di `/check` e `/book`.
- **`/libere [@sede] [data] [ora]`** è la ricerca **mirata** di aule libere con filtri componibili. L'ordine dei token è libero — il parser estrae `@sede`, riconosce il range orario per forma (`14-15`, `14:00-15:30`) e tratta il resto come data:
  - `/libere` → tutte le aule libere oggi (intero giorno)
  - `/libere ven` → libere venerdì (intero giorno)
  - `/libere ven 14-15` → libere venerdì in fascia 14-15
  - `/libere @Storica ven 14-15` → libere a _Storica_ venerdì 14-15
  - `/libere @"Sede Verdi"` → forma con virgolette per sedi multi-parola
    Le aule risultano libere se non hanno **alcuna** prenotazione `confirmed` o `pending_approval` che si sovrappone alla finestra (intero giorno o fascia).

**Differenza con `/agenda`**: `/agenda` mostra il calendario completo (tutte le aule + tutte le prenotazioni del giorno), `/libere` filtra per orario e mostra **solo** le aule disponibili.

Esempio di output `/agenda`:

```
📅 Agenda · venerdì 9 maggio

🏢 Sede Storica
🟢 Aula 12 (A12) — libera
🟡 Sala Prove (SP)
   ▸ 09:00–11:00 lezione
   ▸ 14:00–16:00 prova ⏳

🏢 Succursale
🟢 Studio Yamaha (SY1) — libera

📊 Libere: 2/3 aule
```

Entrambi i comandi truncano il messaggio se supera 4000 caratteri (limite Telegram).

### 6.1 Wizard `/book` a 5 step

Il bot guida l'utente passo-passo. Ogni step viene **saltato automaticamente** se la risposta è univoca o già fornita nel comando iniziale:

| Step                    | Cosa chiede                                                                                                                                        | Skip automatico se                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1. **Sede** ⭐          | Mostra lista numerata delle sedi (edifici con aule prenotabili). L'utente risponde con il numero o il nome (anche parziale).                       | C'è una sola sede attiva nell'istituto                                         |
| 2. **Aula**             | Chiede il codice o il nome dell'aula. La ricerca è **scoped sulla sede scelta**: due aule omonime in edifici diversi non si confondono.            | L'aula è già stata fornita nel comando iniziale (`/book <codice> …`)           |
| 3. **Quando**           | Chiede giorno + orario (es. `venerdì 14-15`, `2026-04-30 09:00-10:30`).                                                                            | Già forniti nel comando iniziale                                               |
| 4. **Tipo attività** ⭐ | Mostra lista numerata dei tipi attivi dal catalogo (Studio individuale · Lezione · Prova · Concerto · Altro). L'utente risponde con numero o nome. | L'admin ha 1 solo tipo attivo, oppure l'utente lo passa nel comando (4° token) |
| 5. **Conferma**         | Riassunto completo: sede + aula + quando + tipo. Risposta `si` o `no`.                                                                             | —                                                                              |

I tipi attività sono presi dal **catalogo configurabile** (`Impostazioni Server → Tipi prenotazione` lato admin) — se l'admin disattiva un tipo, sparisce dal bot al messaggio successivo.

In ogni momento `annulla` (o `/annulla`) esce dal wizard.

### 6.2 Formati accettati

- **Orario**: `14:00-15:00`, `14-15`, `9:00-10:30`, `9-10:30`
- **Date**: `oggi`, `domani`, `lun`/`lunedì`/`mar`/`martedì`/…/`dom`/`domenica`, `2026-04-30`, `30/04/2026`, `30-04-2026`

---

## 7. Test e verifica

```bash
cd backend
npx vitest run tests/integration/messaging.test.js   # quando disponibile
```

Verifiche manuali consigliate:

1. **Webhook senza firma** → 401
2. **Webhook con firma valida ma payload vuoto** → 200 + nessuna risposta
3. **Messaggio da chat non bindata** → reply standard "Per usare questo bot..."
4. **`bind XXXXXX` con OTP errato** → "Codice non valido o scaduto"
5. **`bind XXXXXX` con OTP valido** → binding creato + welcome
6. **`/book <codice> ven 14-15`** dopo binding → conferma o errore validator
7. **30 messaggi/min superati** → cooldown 1h

---

## 8. Costi mensili realistici

Conservatorio ~500 utenti, ~30 prenotazioni/giorno = ~660 conversazioni/mese:

| Setup                         | Costo mese | Note                                                                                 |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| **Solo Telegram**             | **0 €**    | volume infinito sotto Telegram TOS                                                   |
| **Telegram + WhatsApp Cloud** | **~€36**   | ~660 conv WA × ~€0.04 utility (sopra le 1000 free) — qui sotto soglia free, costo ~0 |
| **Twilio WA + Telegram**      | ~€55       | overhead Twilio + numero $1.50/mese                                                  |
| **Solo Signal**               | ~€2-10     | numero prepagato; richiede ops manuale signal-cli                                    |

Hosting: messaging gira nello stesso processo Cadenza → 0 € overhead. Il poller IMAP (futuro) potrebbe necessitare di un worker dedicato.

---

## 9. Audit & GDPR

- Ogni messaggio in/out è in `audit_logs` con `target_type='ChatMessage'`, `payload={text, intent}`, `actorId=userId` (se bindato), `userAgent='bot/{channel}'`.
- Retention: la tabella `audit_logs` ha già lo scheduler 24 mesi (vedi `services/retentionScheduler.js`).
- `ChatSession` è `paranoid: true`, quindi soft-delete consente recovery e segue la stessa retention applicativa.
- Sub-processor: Meta/WhatsApp Cloud trasferisce dati a US (con SCC EU-US Data Privacy Framework). Per uso PA italiana strict, preferire Telegram + Signal + email (no transfer US).

---

## 10. Roadmap

**Sprint corrente** (DONE):

- Pipeline core, adapter Telegram pieno, scaffolding altri 3 canali
- Modelli, routes webhook + admin settings + bot bindings
- UI profilo + admin
- i18n IT/EN/ES

**Sprint futuri**:

- WhatsApp Cloud: gestione template messages outbound (oltre 24h)
- Signal: poller bundled (o forwarder Docker side-car)
- Email IMAP: poller `node-imap` integrato
- NLU LLM (Claude Haiku / GPT-4o-mini) come opt-in per conversazioni meno strutturate
- Multi-utente per chat (oggi: 1:1 binding)
- E2E Playwright per flow binding
