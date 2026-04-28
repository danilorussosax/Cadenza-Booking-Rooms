# Deploy & PWA — Guida operativa

Questa guida copre le verifiche post-deploy, con focus sulla **Progressive Web App** (PWA) introdotta nel ciclo "PWA + manifest + service worker".

> Per la procedura di installazione su VPS Ubuntu (Hetzner / DigitalOcean / on-prem), vedi [`docs/install.md`](./install.md). Questo documento parte dal presupposto che backend, frontend e nginx siano già deployati e raggiungibili via HTTPS.

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

| Sintomo                                      | Causa probabile                                    | Fix                                                                                                               |
| -------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "Installa app" non compare in URL bar Chrome | Manifest non valido o icone mancanti               | DevTools → Application → Manifest, leggi gli errori                                                               |
| SW non si registra                           | CSP blocca `worker-src`                            | Verifica header risposta: deve includere `worker-src 'self' blob:`                                                |
| Banner A2HS non appare mai                   | Visit count < 2 oppure dismissed in passato        | `localStorage.removeItem('cadenza:visit-count')` + `localStorage.removeItem('cadenza:a2hs-dismissed')` e ricarica |
| Banner "Connessione persa" sempre acceso     | `agendaQuery` non riesce mai per CORS              | Verifica nginx proxy `/api/*` → backend                                                                           |
| App standalone si apre con barra browser     | `start_url` non corrisponde alla rotta corrente    | Manifest dichiara `/dashboard`, deve essere raggiungibile autenticato                                             |
| Vecchia versione cached anche dopo deploy    | SW in waiting, l'utente non ha cliccato "Ricarica" | Toast Sonner "Aggiornamento disponibile" deve apparire entro pochi secondi                                        |

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
