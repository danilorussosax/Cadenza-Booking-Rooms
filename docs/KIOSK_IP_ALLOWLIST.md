# Kiosk display · Restrizione per IP via nginx

Questa guida spiega come limitare l'accesso al **kiosk pubblico** (`/display` + endpoint `/api/public/*`) ai soli IP dell'istituto, senza toccare il codice applicativo. È la soluzione più economica e sicura quando la VPS è esposta su Internet ma il kiosk deve restare visibile **solo da dentro l'istituto**.

> Riferimento codice: `frontend/src/pages/Display.tsx`, `backend/routes/public.js` (endpoint `/api/public/*`), `backend/middleware/rateLimit.js`, `deploy.sh` (vhost nginx).
>
> Pattern nginx: lo stesso usato in `scripts/apply-nginx-security-headers.sh` (snippet condiviso + include nel vhost).

---

## 1. Quando ha senso questa soluzione

| Scenario                                                                                           | Adatto?                                       |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Istituto con connessione internet a IP pubblico **statico** (la maggior parte degli enti pubblici) | ✅ Sì, è la soluzione ideale                  |
| Più sedi con IP statici diversi                                                                    | ✅ Sì, basta listare tutti gli IP             |
| IP dinamico ma con range provider noto (es. blocco /24 dell'ISP)                                   | ⚠️ Funziona ma allarga la superficie          |
| Kiosk mobili (laptop su 4G, eventi esterni)                                                        | ❌ No, serve invece il modello "device token" |
| Vuoi che operatori vedano il kiosk anche da casa                                                   | ❌ No (oppure: ammetti VPN dell'istituto)     |

**Cosa NON viene bloccato** (e va bene così): `/api/auth/*`, `/api/admin/*`, `/api/users/*`, ecc. Gli admin/docenti/studenti continuano ad accedere da qualunque rete con le loro credenziali. Si chiude **solo** la finestra "pubblica senza auth".

---

## 2. Prerequisiti

### 2.1 Sapere qual è l'IP pubblico dell'istituto

Dalla rete dell'istituto (qualunque PC dietro al firewall di sede), apri un terminale e lancia:

```bash
curl -4 ifconfig.me     # IPv4 pubblico in uscita
curl -6 ifconfig.me     # IPv6 (se presente)
```

> ⚠️ **L'IP del kiosk in LAN (192.168.x.x, 10.x.x.x) NON serve**: nginx vede l'IP **pubblico** con cui esce il NAT dell'istituto. Quello è l'indirizzo da inserire in allowlist.

Se l'IP cambia ogni tot (linea consumer con IP dinamico), chiedi al provider/IT dell'istituto di confermarne la staticità. In alternativa, individua il **range CIDR** del provider (es. `82.165.0.0/16`).

### 2.2 Conoscere il path del vhost nginx

Sulla VPS:

```bash
ls -la /etc/nginx/sites-enabled/
# atteso: cadenza  (o cadenza.conf)
```

Tutti gli esempi sotto assumono `/etc/nginx/sites-enabled/cadenza`. Adatta il path se diverso.

### 2.3 Backup del vhost prima di modificare

```bash
sudo mkdir -p /var/backups/nginx
sudo cp /etc/nginx/sites-enabled/cadenza /var/backups/nginx/cadenza.bak-$(date +%F-%H%M%S)
```

---

## 3. Snippet di allowlist (single source of truth)

Centralizzare la lista IP in un file separato include-ato dal vhost: così per aggiungere/rimuovere un IP non si tocca mai il vhost, solo lo snippet. Stesso pattern usato in `scripts/apply-nginx-security-headers.sh`.

Crea il file:

```bash
sudo mkdir -p /etc/nginx/snippets
sudo nano /etc/nginx/snippets/cadenza-display-allowlist.conf
```

Contenuto (sostituisci `203.0.113.10` con l'IP pubblico dell'istituto rilevato al §2.1):

```nginx
# =============================================================================
# cadenza-display-allowlist.conf
#
# Allowlist IP per gli endpoint pubblici del kiosk Cadenza.
# Inclusa dai location `/api/public/` e `/display` nel vhost principale.
#
# Per aggiungere/rimuovere IP: modifica questo file, poi:
#   sudo nginx -t && sudo systemctl reload nginx
# =============================================================================

# --- IP istituto (sede principale) ---
allow 203.0.113.10;

# --- IP istituto (sede distaccata, se presente) ---
# allow 198.51.100.42;

# --- IPv6 (decommenta se l'istituto ha anche IPv6) ---
# allow 2001:db8:abcd::/48;

# --- Loopback: utile per healthcheck e curl dalla VPS stessa ---
allow 127.0.0.1;
allow ::1;

# --- Tutto il resto: nega con 403 ---
deny all;
```

**Nota IPv6**: se l'istituto ha sia IPv4 sia IPv6, devi listare entrambi. Verifica con il secondo `curl` del §2.1 se serve.

---

## 4. Modifica del vhost

Apri il vhost:

```bash
sudo nano /etc/nginx/sites-enabled/cadenza
```

Identifica il `server { listen 443 ssl; ... }` principale (quello con `server_name prenotazioneaule.it` o equivalente). Dentro a quel server block, aggiungi (o modifica, se già esistono) i seguenti `location`:

```nginx
server {
    listen 443 ssl http2;
    server_name prenotazioneaule.it;

    # ... resto della config (ssl_certificate, root, ecc.) ...

    # -------------------------------------------------------------------------
    # 1. Endpoint pubblici del kiosk: SOLO da IP dell'istituto.
    #    Senza questo blocco chiunque su Internet può scaricare /api/public/agenda.
    # -------------------------------------------------------------------------
    location /api/public/ {
        include snippets/cadenza-display-allowlist.conf;

        # Proxy verso il backend Node (rimane invariato)
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # -------------------------------------------------------------------------
    # 2. (Opzionale) Anche la pagina HTML del kiosk solo da IP dell'istituto.
    #    Non strettamente necessario: senza dati API la pagina è inutile,
    #    ma evita di mostrare la UI in chiaro a un curioso esterno.
    # -------------------------------------------------------------------------
    location = /display {
        include snippets/cadenza-display-allowlist.conf;
        try_files $uri /index.html;
    }

    # -------------------------------------------------------------------------
    # 3. Tutto il resto (SPA, /api/auth, /api/admin, /api/users, …)
    #    resta accessibile da Internet: gli utenti loggati devono poter entrare
    #    da casa, da mobile, da reti diverse. NON aggiungere qui l'allowlist.
    # -------------------------------------------------------------------------
    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> ⚠️ **Ordine importante**: nginx applica il `location` **più specifico**. `/api/public/` è più specifico di `/api/`, quindi solo le richieste a `/api/public/...` ereditano l'allowlist. Le altre `/api/...` no.

---

## 5. Test e reload

**Test sintattico** (non applica nulla):

```bash
sudo nginx -t
```

Se l'output dice `syntax is ok` e `test is successful`, procedi. Se errore, **non** ricaricare: ripristina il backup del §2.3 e indaga.

**Reload** (zero downtime):

```bash
sudo systemctl reload nginx
```

---

## 6. Verifica

### 6.1 Dalla VPS stessa (loopback → deve passare)

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/public/display-config
# atteso: 200 (chiamata diretta al backend, bypassa nginx)

curl -s -o /dev/null -w "%{http_code}\n" https://prenotazioneaule.it/api/public/display-config
# atteso: 200 (loopback via nginx è in allowlist)
```

### 6.2 Da IP dell'istituto (deve passare)

Da un PC in sede:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://prenotazioneaule.it/api/public/display-config
# atteso: 200

# Test del kiosk in browser:
# https://prenotazioneaule.it/display
# atteso: pagina carica e mostra i dati
```

### 6.3 Da IP esterno (deve essere bloccato)

Dal tuo Mac di casa (rete diversa):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://prenotazioneaule.it/api/public/display-config
# atteso: 403
```

In browser, aprire `https://prenotazioneaule.it/display` deve mostrare `403 Forbidden` (se hai abilitato anche il punto 2 del vhost) oppure caricare la SPA ma con i dati che non arrivano (errore 403 in console).

**Verifica che il login resti aperto**:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://prenotazioneaule.it/api/auth/login \
  -H 'Content-Type: application/json' -d '{}'
# atteso: 400 (richiesta malformata, ma non 403) — confermo che l'allowlist NON si applica al login
```

---

## 7. Manutenzione

### 7.1 Aggiungere un IP

```bash
sudo nano /etc/nginx/snippets/cadenza-display-allowlist.conf
# aggiungi una riga: allow <nuovo-ip>;
sudo nginx -t && sudo systemctl reload nginx
```

### 7.2 Rimuovere un IP

Stesso file, commenta o cancella la riga, poi reload.

### 7.3 Monitorare i tentativi bloccati

I 403 generati dall'allowlist finiscono in `/var/log/nginx/access.log`. Per vedere quanti tentativi esterni di accesso al kiosk avvengono:

```bash
sudo grep ' 403 ' /var/log/nginx/access.log | grep -E '/api/public/|/display' | tail -20

# Conteggio per IP (top 10 IP che provano ad accedere):
sudo awk '$9=="403" && ($7 ~ /^\/api\/public\// || $7 ~ /^\/display/) {print $1}' \
  /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -10
```

Se vedi pattern strani (bruteforce, scraper aggressivo) puoi sempre integrare con `fail2ban` o un blocco esplicito a livello firewall.

---

## 8. Rollback

Se qualcosa va storto e devi tornare allo stato precedente:

```bash
# Ripristina il vhost dal backup creato al §2.3
sudo cp /var/backups/nginx/cadenza.bak-<timestamp> /etc/nginx/sites-enabled/cadenza
sudo nginx -t && sudo systemctl reload nginx

# (Opzionale) rimuovi anche lo snippet
sudo rm /etc/nginx/snippets/cadenza-display-allowlist.conf
```

Il kiosk torna pubblico in <1 secondo.

---

## 9. Limiti di questa soluzione

| Limite                                                                                                                                                                       | Mitigazione                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Se l'IP pubblico dell'istituto cambia (es. il provider svecchia la rete), il kiosk smette di funzionare e nessuno se ne accorge fino a quando un operatore guarda lo schermo | Imposta un check esterno: `curl https://prenotazioneaule.it/api/public/display-config` da una macchina interna ogni 10 min e mail su 403 |
| Operatori in smartworking che vogliono "dare un'occhiata al kiosk" dal portatile non riescono                                                                                | Per loro c'è già `/admin/display` (UI admin) accessibile da qualunque rete con login                                                     |
| Eventi esterni (saggio in teatro fuori sede, open day in centro città) con kiosk temporanei                                                                                  | Aggiungi temporaneamente l'IP della rete dell'evento allo snippet e rimuovilo dopo                                                       |
| Non protegge dal _visitatore in sede che si collega al WiFi guest e apre l'URL_                                                                                              | Combina con il **modello device token** (v. analisi conversazionale, non in questo doc) — soluzione più solida ma più costosa            |

Se in futuro questi limiti diventano vincolanti, l'allowlist IP resta come **prima linea** e ci si aggiunge sopra un meccanismo applicativo (PIN/token). Non c'è ragione di rimuoverla anche quando si scala la sicurezza.
