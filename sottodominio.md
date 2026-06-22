# Migrazione dominio: prenotazioneaule.it → aule.prenotazioneaule.it

## Context

Cadenza gira su VPS IONOS, servito su apex `prenotazioneaule.it`. L'utente vuole
spostare l'app sul sottodominio `aule.prenotazioneaule.it` e **liberare l'apex**
per altro uso (nessun redirect apex→sottodominio).

Esplorazione confermata:

- **Frontend**: zero dominio hardcoded. Tutti gli URL costruiti da
  `window.location.origin` (`frontend/src/lib/api.ts`, `CalendarSubscriptionSection.tsx`,
  `DisplayKiosk.tsx`). **Nessun rebuild né modifica frontend.**
- **Backend**: tutto parametrizzato via `FRONTEND_URL` (e `APP_URL` legacy) nel
  `.env` del VPS (non versionato). Da quel valore dipendono: CORS (`app.js:140-148`,
  fail-fast in prod se manca), Origin guard (`middleware/originGuard.js`), link reset
  password (`services/auth/sendSetupLink.js`), webhook Telegram
  (`services/messaging/telegramSetup.js`), URL QR check-in (`routes/structure.js:1203`),
  redirect OAuth (`routes/auth.js`). `icalService.js` usa `cadenza.local` solo per gli
  UID VEVENT (non è un URL navigabile, non va toccato).
- **nginx**: reverse-proxy puro → backend `127.0.0.1:3000` che serve anche la SPA
  (confermato `scripts/install.sh:404-414`). Config nginx vive **solo sul VPS**, non
  nel repo.
- **Esiste già lo script di migrazione**: `scripts/migrate-domain.sh`, il cui esempio
  in docstring è letteralmente `prenotazioneaule.it → rota.prenotazioneaule.it` (stesso
  pattern apex→sottodominio). Lo usiamo **as-is** (nessuna modifica repo).

Esito atteso: l'app risponde su `https://aule.prenotazioneaule.it`; l'apex smette di
servire Cadenza e resta libero.

## Decisioni prese

1. **Apex liberato** — niente redirect 301, niente passthrough iCal/QR sull'apex.
   → useremo **solo le fasi `preflight` e `cutover`** di `migrate-domain.sh`; **NON** la
   fase `redirect`. La liberazione dell'apex è un disable manuale del vhost (3 comandi).
2. **Runbook con script esistente** — nessun commit/modifica al repository.

## ⚠️ Rotture attese (decisione accettata "libero l'apex")

Liberando l'apex senza passthrough, si rompono **subito** i riferimenti che puntano a
`https://prenotazioneaule.it/...`:

- **Feed iCal già sottoscritti** nei calendari degli utenti (`/api/bookings/ical?token=…`)
  → smettono di aggiornarsi. Gli utenti devono riprendere il link dal proprio profilo
  Cadenza (sezione "Sottoscrizione calendario").
- **QR check-in già stampati nelle aule** (`/check-in/room/:id?t=…`) → non risolvono più.
  Vanno **rigenerati e ristampati** (Impostazioni Server → QR Codes → Rigenera tutti),
  oppure ristampati dopo il cutover.

Mitigazione consigliata prima del go-live: avvisare gli utenti (UI Annunci / broadcast
email) e pianificare la ristampa QR. Se in futuro si volesse evitare la rottura,
l'alternativa è la fase `redirect` dello script (apex→301 con passthrough iCal/QR) — ma
tiene l'apex occupato da Cadenza, in conflitto con "liberare l'apex".

## Prerequisiti manuali (prima delle fasi script)

1. **DNS (pannello IONOS) — correggi i record parking pre-compilati.**
   Stato verificato il 2026-06-20:
   - `prenotazioneaule.it` (apex): A → **82.165.110.193** = VPS, **nessun AAAA** (VPS senza IPv6) ✓
   - `www`: A → 82.165.110.193 (VPS) ✓
   - `aule`: A → **217.160.0.28** + AAAA → **2001:8d8:100f:f000::200**, entrambi reverse
     `…elastic-ssl.ui-r.com` = **parking/SSL IONOS, NON il VPS** (record di default IONOS).

   Causa confermata dal pannello (screenshot): `aule` è agganciato al prodotto IONOS
   **"Default Site"** (Domain Connect). I record auto-gestiti `A aule → 217.160.0.28`,
   `AAAA aule → 2001:8d8:100f:f000::200` e `TXT _dep_ws_mutex.aule` puntano al parking
   `elastic-ssl.ui-r.com`. Le righe `aule` A/AAAA hanno solo matita+⊘ (niente cestino):
   non eliminabili finché legate al Default Site. I record **Mail** (`MX/CNAME/TXT` di
   `@`/`aule`/`musa`) e gli A `@`/`www` → VPS restano invariati.

   Via pulita (consigliata):
   1. MENU → **Siti web e negozi** (Default Site / Deploy Now) → scollega il dominio
      `aule.prenotazioneaule.it`. Questo rimuove i record auto-gestiti A/AAAA/\_dep_ws_mutex.
   2. DNS → **Aggiungi record** → A, host `aule`, valore **`82.165.110.193`**, TTL 1h.
   3. Nessun AAAA (apex senza AAAA, VPS solo IPv4).

   Via rapida (se non trovi dove scollegare):
   1. Matita su `A aule` → valore → **`82.165.110.193`**; se chiede di scollegare dal
      sito predefinito, conferma; salva.
   2. `AAAA aule`: niente cestino → **⊘ disabilita**. Obiettivo: `aule` senza AAAA.
   3. Se il valore torna `217.160.0.28` da solo → usa la via pulita.

   Verifica (occhio al TTL/cache):
   `dig +short aule.prenotazioneaule.it A` → **82.165.110.193**;
   `dig +short aule.prenotazioneaule.it AAAA` → **vuoto**.
   **Non procedere con la Fase A finché A=VPS e AAAA vuoto.**

2. **OAuth provider** (solo se è attivo login Google/Microsoft): in Google Cloud Console
   e Microsoft Entra **aggiungi** i redirect URI del sottodominio (mantenendo per ora i
   vecchi):
   - `https://aule.prenotazioneaule.it/api/auth/google/callback`
   - `https://aule.prenotazioneaule.it/api/auth/microsoft/callback`
3. **Admin UI Cadenza** (se OAuth attivo): Impostazioni Server → Servizi → OAuth →
   aggiorna i Callback URL al sottodominio.

## Runbook (eseguito sul VPS via SSH)

Tutti i comandi girano sul VPS. `--env-file` di default è
`/home/cadenza/cadenza/backend/.env` (auto-detect ok).

### Fase A — Preflight (cert + vhost sottodominio, app affiancata)

```bash
# Prova a vuoto prima
sudo bash scripts/migrate-domain.sh --old prenotazioneaule.it \
     --new aule.prenotazioneaule.it --phase preflight --dry-run
# Esecuzione reale
sudo bash scripts/migrate-domain.sh --old prenotazioneaule.it \
     --new aule.prenotazioneaule.it --phase preflight
```

Cosa fa: check DNS, emette cert Let's Encrypt per il sottodominio, crea
`/etc/nginx/sites-available/cadenza-aule.prenotazioneaule.it.conf` (proxy→:3000) +
symlink, `nginx -t` + reload, healthcheck `https://aule.…/api/health`.
A questo punto sottodominio e apex rispondono **entrambi** (apex ancora canonico).

### Fase B — Security headers sul nuovo vhost (gap noto da colmare)

Il vhost generato da preflight **non** include lo snippet HSTS/CSP. Applicalo
puntando esplicitamente al nuovo file (la regex dello script matcha `server_name`
contenente `prenotazioneaule.it`, quindi il sottodominio è coperto):

```bash
sudo bash scripts/apply-nginx-security-headers.sh \
     /etc/nginx/sites-enabled/cadenza-aule.prenotazioneaule.it.conf --dry-run
sudo bash scripts/apply-nginx-security-headers.sh \
     /etc/nginx/sites-enabled/cadenza-aule.prenotazioneaule.it.conf
```

### Fase C — Cutover (.env → sottodominio + restart)

Pre-condizione: OAuth redirect URI e Admin UI già aggiornati (prerequisiti 2-3).

```bash
sudo bash scripts/migrate-domain.sh --old prenotazioneaule.it \
     --new aule.prenotazioneaule.it --phase cutover
```

Cosa fa: backup `.env`, sostituisce `FRONTEND_URL`/`APP_URL`
(`https://prenotazioneaule.it` → `https://aule.prenotazioneaule.it`), restart backend
(`pm2 restart cadenza-backend --update-env`), healthcheck con retry.
Da qui CORS/originGuard/email/Telegram/QR usano il sottodominio.

### Fase D — Re-registrazione servizi esterni (manuale, post-cutover)

- **Telegram** (se attivo): Admin UI → Impostazioni Server → Servizi → Messaging →
  Telegram → "Configura automaticamente" (ri-registra il webhook su
  `https://aule.prenotazioneaule.it/api/messaging/telegram/webhook`; HTTPS pubblico
  obbligatorio).
- **QR aule**: Admin UI → Impostazioni Server → QR Codes → Rigenera tutti → ristampa.

### Fase E — Libera l'apex (disable manuale, NON la fase redirect)

Trova il vhost dell'apex e disabilitalo (NON rimuovere il file, solo il symlink):

```bash
# Individua il file che serve l'apex (nome possibile: aulabook | cadenza | cadenza.conf)
sudo grep -l 'server_name .*prenotazioneaule\.it' /etc/nginx/sites-enabled/* \
  | grep -v 'aule\.prenotazioneaule\.it'
# Disabilita il vhost apex trovato (esempio: aulabook)
sudo rm /etc/nginx/sites-enabled/aulabook
sudo nginx -t && sudo systemctl reload nginx
```

Dopo il reload l'apex non serve più Cadenza ed è libero per il nuovo uso. Il cert
apex in `/etc/letsencrypt/live/prenotazioneaule.it/` può restare (riutilizzabile) o
essere rimosso più avanti con `sudo certbot delete --cert-name prenotazioneaule.it`.

## Verifica end-to-end

1. `curl -fsS https://aule.prenotazioneaule.it/api/health` → 200.
2. Browser pulito su `https://aule.prenotazioneaule.it`: login email; se attivo,
   login Google/Microsoft (verifica redirect sul sottodominio).
3. Email reset password: il link punta a `https://aule.prenotazioneaule.it/reset-password/…`.
4. Header sicurezza: `curl -sI https://aule.prenotazioneaule.it/ | grep -i strict-transport`.
5. iCal nuovo: dal profilo, copia link sottoscrizione → contiene il sottodominio →
   apri in app calendario.
6. QR rigenerato: scansiona un QR nuovo → apre `https://aule.prenotazioneaule.it/check-in/room/…`.
7. Apex liberato: `curl -sI https://prenotazioneaule.it/` → NON più la app Cadenza
   (404/default nginx o il nuovo uso che gli darai).
8. Telegram (se attivo): invia un messaggio al bot, verifica risposta.

## Rollback

- `.env`: backup automatico in `~/cadenza-migration-backups/<timestamp>/` →
  ripristina e `pm2 restart cadenza-backend --update-env`.
- Apex: ripristina il symlink rimosso
  (`sudo ln -sf /etc/nginx/sites-available/<vhost> /etc/nginx/sites-enabled/` + reload).
- nginx: ogni fase fa `nginx -t` prima del reload; backup vhost in
  `~/cadenza-migration-backups/` e `/var/backups/nginx/`.

## File coinvolti

- **Repo**: nessuna modifica (decisione "runbook con script esistente"). Si usano
  `scripts/migrate-domain.sh` e `scripts/apply-nginx-security-headers.sh` as-is.
- **VPS** (fuori repo): `backend/.env` (FRONTEND_URL/APP_URL), vhost nginx in
  `/etc/nginx/sites-{available,enabled}/`, cert in `/etc/letsencrypt/live/`.
