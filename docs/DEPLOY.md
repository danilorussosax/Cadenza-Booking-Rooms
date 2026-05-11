# Deploy operativo & PWA — Guida

Questa guida copre due fasi:

1. **§ 0** — il flusso di **deploy operativo** quotidiano (`./deploy.sh` da Mac → VPS), inclusi setup SSH, normalizzazione permessi statici e troubleshooting.
2. **§ 1-10** — le **verifiche post-deploy** della Progressive Web App (manifest, service worker, caching, CSP, Lighthouse).

> Per il **primo provisioning** di un VPS Ubuntu (Hetzner / DigitalOcean / on-prem) vedi [`docs/install.md`](./install.md). Questo documento parte dal presupposto che backend, frontend e nginx siano già deployati e raggiungibili via HTTPS.

---

## 0. Flusso deploy `./deploy.sh`

Lo script `deploy.sh` nella root del repo gestisce il deploy incrementale **Mac → VPS** in 8 step. Tutti gli step sono idempotenti.

### 0.1 Setup SSH (one-time)

Lo script si appoggia a un **alias** definito in `~/.ssh/config` — di default `cadenza-vps`. Cambiando server, utente o chiave si modifica solo quel blocco, lo script resta invariato.

**Procedura iniziale (una volta sola, dal Mac):**

```bash
# 1. Genera una chiave dedicata al deploy (ed25519 raccomandato)
ssh-keygen -t ed25519 -C "deploy@cadenza" -f ~/.ssh/cadenza_deploy
# (lascia vuota la passphrase se vuoi un deploy non interattivo)

# 2. Installa la chiave pubblica sul VPS
ssh-copy-id -i ~/.ssh/cadenza_deploy.pub cadenza@<IP_VPS>

# 3. Aggiungi il blocco a ~/.ssh/config
cat >> ~/.ssh/config <<'EOF'

Host cadenza-vps
    HostName 82.165.110.193
    User cadenza
    IdentityFile ~/.ssh/cadenza_deploy
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 4
EOF
chmod 600 ~/.ssh/config

# 4. Test: deve rispondere senza chiedere password
ssh cadenza-vps 'whoami && hostname'
```

**Hardening (opzionale ma raccomandato)** — dopo aver verificato che la chiave funziona, disabilita il login con password sul VPS:

```bash
ssh cadenza-vps
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sshd -t && sudo systemctl reload ssh
```

Tieni una sessione SSH già aperta come rete di sicurezza finché non hai testato un nuovo login.

**Rotazione futura della chiave** (zero-downtime):

1. Genera una nuova coppia (`cadenza_deploy_2`)
2. `ssh-copy-id` della nuova
3. Aggiorna `IdentityFile` in `~/.ssh/config`
4. Testa
5. Rimuovi la riga della vecchia chiave da `~/.ssh/authorized_keys` sul VPS

### 0.2 Flusso degli 8 step

| Step    | Azione                                                                  | Note                                                                |
| ------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `[1/8]` | Build frontend in locale (`tsc -b && vite build`)                       | Saltabile con `--no-build` se la `dist/` è già fresca               |
| `[2/8]` | Dry-run rsync con `--itemize-changes`                                   | Mostra cosa cambierebbe sul VPS prima di toccare nulla              |
| `[3/8]` | Verifica versioni moduli (lock-based)                                   | Annulla il deploy se il VPS ha già versioni più recenti del locale  |
| `[4/8]` | rsync incrementale del codice + dist                                    | Esclude `.env`, `uploads/`, `data/`, `backups/`, `public/logo-app/` |
| `[5/8]` | **Normalizza permessi statici sul VPS**                                 | `chmod 755` dir + `644` file su `dist/`, `public/`, `uploads/`      |
| `[6/8]` | `npm ci --omit=dev` sul backend, solo se `package-lock.json` è cambiato | Hash-based                                                          |
| `[7/8]` | `pm2 restart cadenza-backend --update-env`                              | Reset env vars + restart                                            |
| `[8/8]` | Healthcheck `curl http://127.0.0.1:3000/`                               | Atteso 200/301/302/404                                              |

### 0.3 Perché lo step `[5/8]` esiste

`rsync -a` preserva i mode dei file dal Mac. La umask di macOS può produrre file/dir a `700` per ragioni varie (file da `frontend/public/` con mode preservati, dir create dall'utente locale, ecc.). Sul VPS nginx gira come `www-data`, che ha bisogno del bit `x` di traversal sulle directory e `r` sui file per servire i contenuti.

**Sintomi tipici se lo step viene saltato:**

- `https://<dominio>/` → **500 Internal Server Error** (generico, da nginx)
- `https://<dominio>/api/*` → **200 OK** (proxy al backend, non legge file)
- `https://<dominio>/logo-app/*` → **404** (alias verso `frontend/public/logo-app/`)
- `https://<dominio>/storage/*` → **404** (alias verso `backend/uploads/`)
- log nginx (richiede sudo): `(13: Permission denied)` su `/home/cadenza/cadenza/frontend/dist/index.html`

Lo step `[5/8]` previene sia regressioni sia recupera da stati pregressi rotti.

### 0.4 Uso comune

```bash
./deploy.sh                # deploy interattivo con conferma
./deploy.sh --yes          # senza conferma (CI o uso rapido)
./deploy.sh --no-build     # salta la build frontend (se già fatta)
./deploy.sh --update-deps  # npm outdated + scelta y/N per workspace prima del deploy
./deploy.sh --help         # mostra l'header dello script
```

---

## 1. Cosa serve perché la PWA sia installabile

La spec PWA (Chromium / Firefox / Safari) richiede TUTTI questi requisiti per esporre il prompt "Installa app":

1. ✅ La pagina è servita su **HTTPS** (oppure `http://localhost` per i test locali).
2. ✅ Esiste un **manifest** valido linkato in `<head>`: `/manifest.webmanifest`.
3. ✅ Il manifest dichiara almeno: `name`, `short_name`, `start_url`, `display: 'standalone'` (o `minimal-ui`/`fullscreen`), e icone `192x192` + `512x512` PNG.
4. ✅ Un **service worker** è registrato e ha gestito almeno un evento `fetch`.
5. ✅ L'utente ha "engagement" minimo (varia per browser: solitamente 30s di permanenza o 2 navigazioni).

Tutti questi requisiti sono soddisfatti dal repository:

- `frontend/public/manifest.webmanifest` — manifest statico con `name`, `short_name="Cadenza"`, icone 192/512 PNG (any + maskable), `theme_color="#1a3367"`.
- `vite-plugin-pwa` (workbox `generateSW`) genera `dist/sw.js` + `dist/registerSW.js`.
- `frontend/src/lib/pwa.ts` registra il SW con `workbox-window` solo in produzione (`import.meta.env.PROD`).
- CSP del backend (`backend/app.js`) include `worker-src 'self' blob:` e `manifest-src 'self'`.

---

## 2. Verifica installabilità in locale

```bash
cd frontend
npm install
npm run build
npm run preview        # serve dist/ su http://localhost:4173

# In un altro shell:
cd ../backend
NODE_ENV=production node server.js
```

Apri **http://localhost:4173/dashboard** in Chrome o Edge, fai login e:

1. **DevTools → Application → Manifest** — deve mostrare:
   - "Cadenza — Prenotazione Aule del Conservatorio"
   - Icone 192×192 e 512×512 (preview verde)
   - `start_url: /dashboard`
   - `theme_color: #1a3367`
   - 0 errori
2. **Application → Service Workers** — `sw.js` in stato "activated and is running".
3. **Application → Cache Storage** — vedrai `workbox-precache-v2-https://...` e `public-agenda-v1`, `institutes-v1`, `storage-v1`, `google-fonts-*-v1` man mano che le request vengono cached.
4. **URL bar → icona "Installa app"** (a destra). Clicca → l'app si apre come finestra standalone con la sua icona.

> **Nota Safari/macOS**: Safari Desktop (≥ 17) supporta PWA installabili dal menu File → "Aggiungi al Dock". iOS Safari non emette `beforeinstallprompt`: il banner mostra istruzioni manuali ("Apri Condividi → Aggiungi alla schermata Home").

---

## 3. Verifica installabilità su mobile

### Android Chrome / Edge / Brave

1. Apri il sito HTTPS.
2. Naviga almeno **2 volte** (la logica A2HS interna mostra il prompt dalla 2ª visita).
3. Vedrai in basso un banner Cadenza "Installa Cadenza" → tap su **Installa**.
4. L'icona appare nella home, l'avvio apre l'app in `display: standalone` senza barra del browser.

In alternativa il browser propone in autonomo il prompt nativo dopo qualche secondo di permanenza.

### iOS Safari

1. Apri il sito HTTPS.
2. Dal banner Cadenza (oppure dal menu Condividi) tap su **Aggiungi alla schermata Home**.
3. L'icona ha il design `theme_color #1a3367` su sfondo crema.

---

## 4. Verifica caching strategie

In DevTools → Application → Cache Storage devi vedere:

| Cache                     | Strategia            | TTL       | Note                                                                             |
| ------------------------- | -------------------- | --------- | -------------------------------------------------------------------------------- |
| `workbox-precache-v2-...` | Precache             | immutable | tutti gli `assets/*-{hash}.js/css/svg/png`                                       |
| `public-agenda-v1`        | StaleWhileRevalidate | 5 min     | `/api/public/agenda` + `/api/public/display-config` — abilita kiosk offline-soft |
| `institutes-v1`           | CacheFirst           | 1 h       | `/api/structure/institutes/*` — cambia raramente                                 |
| `storage-v1`              | CacheFirst           | 7 gg      | foto utente/aula `/storage/*`                                                    |
| `google-fonts-css-v1`     | StaleWhileRevalidate | —         | CSS Inter                                                                        |
| `google-fonts-static-v1`  | CacheFirst           | 1 anno    | woff2                                                                            |

**Test rapido offline-soft**:

1. Apri `/display` con backend raggiungibile, attendi che agenda + display-config carichino.
2. DevTools → Network → **Offline**.
3. Refresh `/display`: la pagina deve continuare a funzionare con i dati cached.
4. Dopo 2 minuti compare il banner "**Connessione persa · ultimo aggiornamento HH:mm**" (warm amber stripe sotto l'header).

**Test rapido API non cached**:

1. Naviga su `/admin/users` (richiesta `/api/users`).
2. Online: 200 OK.
3. Offline: la richiesta fallisce con errore di rete (corretto: non vogliamo cached private data senza policy).

---

## 5. Verifica dell'aggiornamento del SW

Cadenza usa `registerType: 'prompt'`: nessun reload sorpresa.

1. Deploy nuova versione → push frontend → reload browser apre la nuova versione del SW in stato `waiting`.
2. Il client mostra un toast (Sonner): "**Aggiornamento disponibile · Ricarica**".
3. L'utente clicca **Ricarica** → workbox-window fa `messageSkipWaiting()` → il nuovo SW prende il controllo → reload pagina.

In alternativa l'utente può continuare a lavorare e l'aggiornamento si applicherà al prossimo refresh manuale.

**Per forzare il rilascio immediato dell'aggiornamento** (raro: solo per security fix urgenti), modifica `vite.config.ts` settando `clientsClaim: true` + `skipWaiting: true` nel blocco `workbox`.

---

## 6. Verifica CSP

```bash
curl -I https://cadenza.example.it/dashboard | grep -i 'content-security-policy'
```

Devi vedere (riga unica):

```
content-security-policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.googleusercontent.com https://*.microsoftonline.com; connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; worker-src 'self' blob:; manifest-src 'self'
```

Il browser deve avere **0 violations** in DevTools → Console al boot di `/dashboard` e `/display`.

---

## 7. Lighthouse audit

```bash
npx lighthouse https://cadenza.example.it/dashboard \
  --view --preset=desktop --only-categories=pwa
```

Risultati attesi (Lighthouse 12+):

- **PWA badge installabile**: ✅
- **Manifest contains required keys**: ✅
- **Configured for a custom splash screen**: ✅
- **Sets a theme color for the address bar**: ✅
- **Content is sized correctly for the viewport**: ✅
- **Has a `<meta name="viewport">` tag with width or initial-scale**: ✅
- **Page is registered as a service worker controller**: ✅

Lighthouse non emette più punteggio numerico per la categoria PWA (rimosso in v12), ma la presenza dei badge equivale al passing del check.

---

## 8. Disabilitare la PWA in dev

Per default la PWA è **OFF in `vite dev`** (`devOptions.enabled: false` in `vite.config.ts`). Questo evita che il SW intrappoli i bundle in cache durante lo sviluppo.

Se hai bisogno di testare il SW in dev:

```ts
// vite.config.ts
VitePWA({
  devOptions: { enabled: true, type: 'module' },
  ...
})
```

Ricorda di disinstallare il SW (DevTools → Application → Service Workers → Unregister) prima di tornare al dev normale.

---

## 9. Troubleshooting

### 9.1 PWA / frontend

| Sintomo                                      | Causa probabile                                    | Fix                                                                                                               |
| -------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "Installa app" non compare in URL bar Chrome | Manifest non valido o icone mancanti               | DevTools → Application → Manifest, leggi gli errori                                                               |
| SW non si registra                           | CSP blocca `worker-src`                            | Verifica header risposta: deve includere `worker-src 'self' blob:`                                                |
| Banner A2HS non appare mai                   | Visit count < 2 oppure dismissed in passato        | `localStorage.removeItem('cadenza:visit-count')` + `localStorage.removeItem('cadenza:a2hs-dismissed')` e ricarica |
| Banner "Connessione persa" sempre acceso     | `agendaQuery` non riesce mai per CORS              | Verifica nginx proxy `/api/*` → backend                                                                           |
| App standalone si apre con barra browser     | `start_url` non corrisponde alla rotta corrente    | Manifest dichiara `/dashboard`, deve essere raggiungibile autenticato                                             |
| Vecchia versione cached anche dopo deploy    | SW in waiting, l'utente non ha cliccato "Ricarica" | Toast Sonner "Aggiornamento disponibile" deve apparire entro pochi secondi                                        |

### 9.2 Nginx / deploy lato server

#### 500 Internal Server Error generico su `/` ma `/api/health` OK

**Causa più frequente**: directory `frontend/dist` (o `frontend/public`, `backend/uploads`) con mode `drwx------` — nginx (`www-data`) non riesce ad attraversarle.

**Diagnosi rapida**:

```bash
# Backend healthy (dovrebbe rispondere 200)
ssh cadenza-vps "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health"

# Permessi attuali sui path serviti da nginx
ssh cadenza-vps "stat -c '%n %A' /home/cadenza/cadenza /home/cadenza/cadenza/frontend /home/cadenza/cadenza/frontend/dist /home/cadenza/cadenza/frontend/public /home/cadenza/cadenza/backend /home/cadenza/cadenza/backend/uploads"
```

**Fix immediato** (idempotente, sicuro su prod):

```bash
ssh cadenza-vps '
  chmod 755 ~/cadenza ~/cadenza/frontend ~/cadenza/backend
  for d in ~/cadenza/frontend/dist ~/cadenza/frontend/public ~/cadenza/backend/uploads; do
    [ -d "$d" ] || continue
    chmod 755 "$d"
    find "$d" -type d -exec chmod 755 {} +
    find "$d" -type f -exec chmod 644 {} +
  done
'
```

**Fix permanente**: già integrato nello step `[5/8]` di `deploy.sh`. Se ricompare, controlla che lo script non sia stato modificato.

#### 404 sull'icona/logo dell'app (`/logo-app/*`)

Stesso pattern del 500: nginx mappa `/logo-app/` → `frontend/public/logo-app/` con `alias`. Se `frontend/public/` è `drwx------`, ritorna **404** invece di 500 (nginx tratta EACCES come "non trovato" in `try_files`). Stesso fix di § 9.2 sopra.

L'endpoint admin `/api/app-icons` continua a funzionare perché legge la directory dal Node (utente `cadenza`, che è proprietario), non da nginx.

#### Vhost duplicato dopo `scripts/migrate-domain.sh`

Lo script genera un nuovo file in `/etc/nginx/sites-enabled/cadenza-<fqdn>.conf` ma **non disabilita** eventuali vhost preesistenti con lo stesso `server_name` (es. dentro `/etc/nginx/sites-available/cadenza`). Risultato: nginx avvisa con "conflicting server name" e sceglie un vhost a caso, tipicamente quello minimale generato dallo script → routing rotto.

**Cleanup**:

```bash
ssh -t cadenza-vps 'sudo cp /etc/nginx/sites-enabled/cadenza-<fqdn>.conf /root/cadenza-<fqdn>-backup.conf && sudo rm /etc/nginx/sites-enabled/cadenza-<fqdn>.conf && sudo nginx -t && sudo systemctl reload nginx && ls -la /etc/nginx/sites-enabled/'
```

Sostituisci `<fqdn>` con il subdomain effettivo (es. `rota.prenotazioneaule.it`). Il file in `sites-available/` resta intatto come backup.

#### `nginx -t` errore "config file syntax is not OK"

`sudo nginx -t` indica la riga esatta. Cause più comuni:

- direttiva `listen 443 ssl http2` duplicata su due `server` block diversi → rimuovi `http2` dal più recente
- certificato Let's Encrypt scaduto → `sudo certbot renew --force-renewal`
- include di file inesistente (es. dopo aver spostato `sites-available/`)

#### Deploy chiede password ogni step

`deploy.sh` si aspetta l'alias `cadenza-vps` in `~/.ssh/config` con chiave privata. Se non configurato, ogni `ssh` interno richiede password.

**Verifica**:

```bash
ssh -G cadenza-vps | grep -E '^(hostname|user|identityfile)'
```

Se l'output è vuoto o ritorna `hostname cadenza-vps` letterale, vedi § 0.1.

---

## 10. Disinstallazione rapida (debug)

```js
// Console DevTools — pulisce SW + caches + localStorage chiavi PWA
navigator.serviceWorker
  .getRegistrations()
  .then((rs) => rs.forEach((r) => r.unregister()));
caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
[
  'cadenza:visit-count',
  'cadenza:a2hs-dismissed',
  'cadenza:a2hs-installed',
].forEach((k) => localStorage.removeItem(k));
location.reload();
```
