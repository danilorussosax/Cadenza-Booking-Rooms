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

## 2. Setup Telegram (production-ready, 5 minuti)

**Costo**: 0 €/mese, volumi senza limiti pratici.

### 2.1 Crea il bot

1. Apri Telegram → cerca **@BotFather** → `/newbot`
2. Scegli un nome ("Cadenza Conservatorio") e uno username (`cadenza_conservatorio_bot`)
3. BotFather risponde con il **token** (formato `12345:AAAA…`). Conservalo.

### 2.2 Genera webhook secret

```bash
openssl rand -hex 32
# es: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

### 2.3 Configura Cadenza

1. Login admin → menu **Bot messaging** (`/admin/messaging`)
2. Card **Telegram**: incolla `Bot token` + `Webhook secret` → toggle ON → `Salva`
3. Click `Test connessione` → deve risultare `Connessione OK · {"username":"…"}`

### 2.4 Registra il webhook

Sostituisci `TOKEN` e `SECRET`:

```bash
curl -F "url=https://cadenza.example.it/api/messaging/telegram/webhook" \
     -F "secret_token=SECRET" \
     https://api.telegram.org/botTOKEN/setWebhook
```

Risposta attesa: `{"ok":true,"result":true,"description":"Webhook was set"}`.

### 2.5 Test end-to-end

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
/help                   → guida completa
/book                   → wizard 3-step (aula → data+ora → conferma)
/book A.101 ven 14-15   → shortcut con tutti i parametri
/list                   → ultime 5 prenotazioni future
/cancel <id> [motivo]   → annulla
/check A.101 venerdì    → slot liberi del giorno
bind XXXXXX             → completa il binding (solo prima volta)
annulla                 → esce dal wizard
```

Formati orario accettati: `14:00-15:00`, `14-15`, `9:00-10:30`. Date: `oggi`, `domani`, `lun..dom`, `venerdì`, `2026-04-30`, `30/04/2026`.

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
6. **`/book A.101 ven 14-15`** dopo binding → conferma o errore validator
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
