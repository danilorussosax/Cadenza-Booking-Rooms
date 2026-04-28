# Installazione di Aula Book su VPS Hetzner Cloud

Guida passo-passo per portare in produzione (o staging/test) l'applicazione su una VPS Hetzner Cloud.
Lo stack target è **Ubuntu 24.04 LTS + Node.js 20 + PostgreSQL 16 + nginx + systemd**.
HTTPS via **certbot (Let's Encrypt)** se hai un dominio, oppure HTTP puro / cert self-signed se usi solo l'IP.

---

## 1. Scelta del piano Hetzner

Aula Book è un'app moderata: Express + Sequelize + frontend statico. Niente ML, niente carichi pesanti.

| Piano           | CPU / RAM / Disco     | Quando sceglierlo                                                                                                      | Note                                                            |
| --------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **CAX11** (ARM) | 2 vCPU · 4 GB · 40 GB | **Consigliato per dev/test** e piccole istanze prod (<100 utenti attivi). Il prezzo / mese è il più basso del listino. | ARM Ampere; Node 20 e Postgres 16 ufficiali girano nativamente. |
| **CX22** (x86)  | 2 vCPU · 4 GB · 40 GB | Se preferisci x86 per massima compatibilità con immagini/binari di terze parti.                                        | Pochi centesimi di differenza rispetto a CAX11.                 |
| **CX32** (x86)  | 2 vCPU · 8 GB · 80 GB | Produzione con ~500 utenti, backup locali generosi, logging prolungato.                                                |                                                                 |
| CAX21 (ARM)     | 4 vCPU · 8 GB · 80 GB | Carichi sostenuti / picchi di concert booking.                                                                         |                                                                 |

**Per dev/test**: `CAX11`. Lo Snapshot e il Backup automatico Hetzner (~20% sopra il prezzo base) sono opzionali ma consigliati.

> I prezzi variano: verifica quello aggiornato su [hetzner.com/cloud](https://www.hetzner.com/cloud).

**Posizione del datacenter**: scegli `Falkenstein (FSN1)` o `Nuremberg (NBG1)` se i tuoi utenti sono in Italia (latenza ~25-35 ms).

---

## 2. Pre-requisiti prima di toccare il VPS

1. **Account Hetzner Cloud** + Project creato.
2. **Dominio** (opzionale ma consigliato — senza dominio non puoi avere HTTPS pubblico via Let's Encrypt). Esempio: `aulabook.miodominio.it`.
3. **Chiave SSH pubblica**. Su macOS / Linux:
   ```bash
   ssh-keygen -t ed25519 -C "tuo@email.it"   # se non l'hai già
   cat ~/.ssh/id_ed25519.pub                 # questo testo lo carichi su Hetzner
   ```
4. **URL Git del repo Aula Book** (publicly accessible o con deploy key). Esempio: `https://github.com/tuo-utente/aula-book.git`.

---

## 3. Creare il VPS dalla console Hetzner

1. Login su [console.hetzner.cloud](https://console.hetzner.cloud) → progetto → **Add Server**.
2. **Location**: FSN1 / NBG1.
3. **Image**: `Ubuntu 24.04`.
4. **Type**: `CAX11` (ARM) per dev/test.
5. **Networking**: lascia IPv4 + IPv6 attivi.
6. **SSH Keys**: aggiungi la tua chiave pubblica (passo 2.3).
7. **Firewall**: crea/seleziona uno con queste regole inbound:
   - `22/tcp` (SSH) — opzionalmente solo dal tuo IP
   - `80/tcp` (HTTP)
   - `443/tcp` (HTTPS)
8. **Backups**: attiva (consigliato anche per ambienti test).
9. **Name**: `aulabook-test`.
10. Click **Create & Buy now**. In 30 secondi hai un IP pubblico.

---

## 4. Configurare il DNS _(solo se hai un dominio)_

Vai dal tuo registrar / pannello DNS e crea due record:

| Tipo | Nome               | Valore                                         |
| ---- | ------------------ | ---------------------------------------------- |
| A    | `aulabook` (o `@`) | `<IP-IPv4-del-VPS>`                            |
| AAAA | `aulabook`         | `<IP-IPv6-del-VPS>` (opzionale ma consigliato) |

TTL 300 va bene per il debugging iniziale. Aspetta 1-5 minuti, poi verifica con:

```bash
dig +short aulabook.miodominio.it
# → deve restituire l'IP del VPS
```

Se vai con IP-only, salta questo passo.

---

## 5. Primo accesso e hardening base

```bash
ssh root@<IP-VPS>
```

Per entrambi (script o manuale) conviene fare prima un aggiornamento + hardening minimo:

```bash
apt update && apt upgrade -y
apt install -y unattended-upgrades ufw
dpkg-reconfigure --priority=low unattended-upgrades   # rispondi "Yes" agli aggiornamenti automatici di sicurezza

# Firewall: SSH + HTTP + HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

A questo punto due alternative:

- **Veloce**: usa lo script automatico in [§7](#7-installazione-automatica-via-script).
- **Manuale**: prosegui con [§6](#6-installazione-manuale).

---

## 6. Installazione manuale

### 6.1. Pacchetti di base

```bash
apt install -y curl git build-essential ca-certificates gnupg openssl
```

### 6.2. Node.js 20 LTS (NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # deve dire v20.x
```

### 6.3. PostgreSQL 16

```bash
apt install -y postgresql postgresql-contrib
systemctl enable --now postgresql

# Crea utente + DB con password casuale
DB_PASSWORD="$(openssl rand -hex 24)"
sudo -u postgres psql <<SQL
CREATE USER aulabook WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE aulabook OWNER aulabook;
GRANT ALL PRIVILEGES ON DATABASE aulabook TO aulabook;
SQL

echo "Salva questa password, la useremo dopo: ${DB_PASSWORD}"
```

> Postgres ascolta solo su `localhost` di default. Va bene così — il backend sta sulla stessa macchina.

### 6.4. nginx + certbot (HTTPS automatico se hai un dominio)

```bash
apt install -y nginx
systemctl enable --now nginx

# Solo se hai un dominio: certbot per Let's Encrypt
apt install -y certbot python3-certbot-nginx
```

### 6.5. Utente di sistema dedicato

```bash
useradd --system --create-home --home-dir /opt/aulabook --shell /bin/bash aulabook
```

### 6.6. Clone del repo

```bash
sudo -u aulabook -H bash <<'EOF'
cd /opt/aulabook
git clone https://github.com/<tuo-utente>/<repo>.git app
cd app
EOF
```

### 6.7. Configurazione `.env`

Genera segreti e crea il file. Scegli il tuo scenario URL:

```bash
# === Scenario A: dominio + HTTPS ===
PUBLIC_URL="https://aulabook.miodominio.it"
SERVER_NAME="aulabook.miodominio.it"

# === Scenario B: solo IP, HTTP ===
PUBLIC_IP="$(curl -fs https://api.ipify.org || hostname -I | awk '{print $1}')"
PUBLIC_URL="http://${PUBLIC_IP}"
SERVER_NAME="${PUBLIC_IP}"

# === Scenario C: solo IP, HTTPS self-signed ===
# Stesso PUBLIC_IP/SERVER_NAME del B; PUBLIC_URL=https://...
```

```bash
JWT_SECRET="$(openssl rand -hex 32)"
SESSION_SECRET="$(openssl rand -hex 32)"
ADMIN_PASSWORD="$(openssl rand -base64 24)"

cat > /opt/aulabook/app/backend/.env <<ENV
NODE_ENV=production
PORT=3000
APP_URL=${PUBLIC_URL}
FRONTEND_URL=${PUBLIC_URL}

# Database
DB_DIALECT=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=aulabook
DB_USER=aulabook
DB_PASSWORD=${DB_PASSWORD}
DB_SSL=false
DB_SYNC_MODE=safe

# Sicurezza
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=2h
SESSION_SECRET=${SESSION_SECRET}
BCRYPT_COST=12

# Admin di default (creato dal seeder al primo avvio)
DEFAULT_ADMIN_EMAIL=admin@${SERVER_NAME}
DEFAULT_ADMIN_PASSWORD=${ADMIN_PASSWORD}
DEFAULT_ADMIN_FIRSTNAME=Amministratore
DEFAULT_ADMIN_LASTNAME=Sistema

# SMTP (opzionali)
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM=
ENV

chown aulabook:aulabook /opt/aulabook/app/backend/.env
chmod 600 /opt/aulabook/app/backend/.env

echo
echo "==> Salva queste credenziali, NON sono mostrate di nuovo:"
echo "Admin email   : admin@${SERVER_NAME}"
echo "Admin password: ${ADMIN_PASSWORD}"
```

### 6.8. Install dipendenze + build frontend

```bash
sudo -u aulabook -H bash <<'EOF'
set -e
cd /opt/aulabook/app/backend
npm ci --omit=dev
cd /opt/aulabook/app/frontend
npm ci
npm run build
EOF
```

> Il backend serve direttamente `frontend/dist` (vedi `app.js`). Niente static separato in nginx.

### 6.9. Prima sincronizzazione schema + seed

Allo startup il backend:

- Esegue `runPreSyncMigrations()` per le colonne aggiunte negli ultimi rilasci.
- Esegue `sequelize.sync()` (modalità `safe`).
- Esegue il seeder iniziale (idempotente — niente paura di rigenerare).

Quindi non c'è uno step manuale: parte tutto al primo `systemctl start aulabook`.

### 6.10. Unit systemd

```bash
cat > /etc/systemd/system/aulabook.service <<'UNIT'
[Unit]
Description=Aula Book backend
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=aulabook
Group=aulabook
WorkingDirectory=/opt/aulabook/app/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/aulabook/app/backend/data /opt/aulabook/app/backend/uploads /opt/aulabook/app/backend/logs

[Install]
WantedBy=multi-user.target
UNIT

mkdir -p /opt/aulabook/app/backend/{data,uploads,logs}
chown -R aulabook:aulabook /opt/aulabook/app/backend/{data,uploads,logs}

systemctl daemon-reload
systemctl enable aulabook
systemctl start aulabook
sleep 3
systemctl status aulabook --no-pager
```

Verifica health endpoint:

```bash
curl -s http://localhost:3000/api/health
# → {"status":"ok","timestamp":"..."}
```

### 6.11. Configurazione nginx

Crea il vhost. Il contenuto dipende dallo scenario:

#### Scenario A — dominio + HTTPS automatico (certbot)

```bash
cat > /etc/nginx/sites-available/aulabook <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name aulabook.miodominio.it;

    # Headers di sicurezza minimi
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Body size: gli upload (foto profilo / aula) arrivano fino a 8 MB
    client_max_body_size 16m;

    # Compressione (gzip già attivo nel default; brotli richiede modulo extra)
    gzip on;
    gzip_proxied any;
    gzip_types application/json application/javascript text/css text/plain image/svg+xml;
    gzip_min_length 1024;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/aulabook /etc/nginx/sites-enabled/aulabook
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Ora ottieni il certificato Let's Encrypt — certbot modifica automaticamente il vhost aggiungendo `listen 443 ssl`, redirect HTTP→HTTPS e l'HSTS:

```bash
certbot --nginx -d aulabook.miodominio.it --non-interactive --agree-tos -m admin@miodominio.it --redirect
systemctl reload nginx
```

> Il rinnovo è già schedulato dal pacchetto certbot (`/etc/cron.d/certbot` o systemd timer). Verifica: `systemctl list-timers | grep certbot`.

#### Scenario B — solo IP, HTTP puro

```bash
cat > /etc/nginx/sites-available/aulabook <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    client_max_body_size 16m;

    gzip on;
    gzip_proxied any;
    gzip_types application/json application/javascript text/css text/plain image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/aulabook /etc/nginx/sites-enabled/aulabook
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Apri `http://<IP>` dal browser.

#### Scenario C — solo IP, HTTPS self-signed

Genera un cert con openssl (validità 1 anno, SAN sull'IP):

```bash
PUBLIC_IP="$(curl -fs https://api.ipify.org)"
mkdir -p /etc/ssl/aulabook
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout /etc/ssl/aulabook/privkey.pem \
  -out /etc/ssl/aulabook/fullchain.pem \
  -subj "/CN=${PUBLIC_IP}" \
  -addext "subjectAltName=IP:${PUBLIC_IP}"
chmod 600 /etc/ssl/aulabook/privkey.pem
```

Vhost:

```bash
cat > /etc/nginx/sites-available/aulabook <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    http2 on;
    server_name _;

    ssl_certificate     /etc/ssl/aulabook/fullchain.pem;
    ssl_certificate_key /etc/ssl/aulabook/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    client_max_body_size 16m;

    gzip on;
    gzip_proxied any;
    gzip_types application/json application/javascript text/css text/plain image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/aulabook /etc/nginx/sites-enabled/aulabook
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

> I browser mostreranno un warning ("Connessione non sicura"). Per evitarlo sui tuoi device, importa `/etc/ssl/aulabook/fullchain.pem` come autorità di fiducia, oppure usa un dominio + Let's Encrypt.

### 6.12. Backup automatico (cron)

Il repo include `backend/scripts/backup.js` con rotazione (30 giorni / 12 settimane / 12 mesi). Schedula un backup notturno:

```bash
cat > /etc/cron.d/aulabook-backup <<'CRON'
# Backup giornaliero alle 03:30 (server time)
30 3 * * * aulabook cd /opt/aulabook/app/backend && /usr/bin/node scripts/backup.js >> /opt/aulabook/app/backend/logs/backup.log 2>&1
CRON
```

I file finiscono in `/opt/aulabook/app/backups/`.

---

## 7. Installazione automatica via script

Tutto quanto sopra è impacchettato in `scripts/install.sh`. Su un VPS pulito (root):

```bash
# 1) carica lo script (scegli il modo che preferisci)
curl -fsSL https://raw.githubusercontent.com/<tuo-utente>/<repo>/main/scripts/install.sh -o install.sh
# oppure: scp scripts/install.sh root@<IP>:/root/

chmod +x install.sh
```

### Esecuzione

**Con dominio (HTTPS via Let's Encrypt):**

```bash
DOMAIN="aulabook.miodominio.it" \
ADMIN_EMAIL="admin@miodominio.it" \
REPO_URL="https://github.com/<tuo-utente>/<repo>.git" \
./install.sh
```

**Solo IP, HTTP:**

```bash
ADMIN_EMAIL="admin@example.com" \
REPO_URL="https://github.com/<tuo-utente>/<repo>.git" \
./install.sh
# Auto-rileva IP pubblico. App raggiungibile su http://<IP>.
```

**Solo IP, HTTPS self-signed:**

```bash
USE_TLS_INTERNAL=1 \
ADMIN_EMAIL="admin@example.com" \
REPO_URL="https://github.com/<tuo-utente>/<repo>.git" \
./install.sh
```

Lo script:

- Aggiorna il sistema, abilita unattended-upgrades + ufw.
- Installa Node 20, Postgres 16, nginx (+ certbot se DOMAIN è valorizzato).
- Crea utente `aulabook` con DB dedicato + password casuale.
- Clona il repo, fa `npm ci` + `npm run build`.
- Genera `JWT_SECRET`, `SESSION_SECRET`, `DEFAULT_ADMIN_PASSWORD` casuali.
- Configura systemd + vhost nginx (con la modalità giusta).
- Per dominio: lancia `certbot --nginx` per il certificato Let's Encrypt.
- Per IP+TLS: genera cert self-signed via openssl.
- Avvia tutto.
- Stampa le credenziali admin a fine run (è l'unica volta che le vedi).

È **idempotente**: rieseguirlo aggiorna il codice via `git pull`, ricostruisce, riavvia il service. NON sovrascrive `.env` né le password generate.

---

## 8. Operazioni quotidiane

### Vedere i log

```bash
journalctl -u aulabook -f                     # log live del backend
journalctl -u nginx -f                        # eventi nginx
tail -f /var/log/nginx/access.log             # access log
tail -f /var/log/nginx/error.log              # errori
tail -f /opt/aulabook/app/backend/logs/backup.log  # log backup
```

### Riavviare l'app

```bash
systemctl restart aulabook
systemctl reload nginx     # se hai modificato vhost
```

### Aggiornare l'app (manuale)

```bash
sudo -u aulabook -H bash -c '
  cd /opt/aulabook/app
  git pull
  cd backend && npm ci --omit=dev
  cd ../frontend && npm ci && npm run build
'
systemctl restart aulabook
```

### Migrazioni schema dopo cambi al modello

```bash
sudo -u aulabook -H bash -c '
  cd /opt/aulabook/app/backend
  DB_SYNC_MODE=alter node server.js   # Ctrl+C dopo "Schema DB sincronizzato"
'
systemctl restart aulabook
```

### Snapshot manuale

Dalla console Hetzner: server → **Snapshots** → "Take snapshot". Per dev/test prendine uno prima di un cambio rischioso.

### Rinnovo certificato (Scenario A)

Automatico via timer di certbot. Verifica:

```bash
systemctl list-timers | grep certbot
certbot renew --dry-run
```

### Rinnovo certificato self-signed (Scenario C)

Manuale, una volta l'anno (o cambia validità a `-days 3650` per dimenticartelo):

```bash
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout /etc/ssl/aulabook/privkey.pem \
  -out /etc/ssl/aulabook/fullchain.pem \
  -subj "/CN=$(curl -fs https://api.ipify.org)" \
  -addext "subjectAltName=IP:$(curl -fs https://api.ipify.org)"
systemctl reload nginx
```

---

## 9. Troubleshooting

| Sintomo                       | Causa probabile                          | Cosa fare                                                                |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `aulabook.service` failed     | Errore di avvio Node                     | `journalctl -u aulabook -n 100`                                          |
| nginx 502 Bad Gateway         | Backend down o non in ascolto su :3000   | `curl -s http://localhost:3000/api/health` ; `systemctl status aulabook` |
| `nginx -t` fallisce           | Errore di sintassi nel vhost             | Leggi l'errore: indica file e riga esatti                                |
| certbot fallisce              | DNS non propagato o porta 80 bloccata    | `dig +short <dominio>`; verifica firewall (`ufw status`)                 |
| Errore connessione DB         | Password sbagliata in `.env`             | `sudo -u postgres psql -c "ALTER USER aulabook WITH PASSWORD '...'"`     |
| Email non partono             | SMTP non configurato                     | OK in dev/test (l'app è no-op se SMTP off)                               |
| Frontend stale dopo deploy    | Cache browser su `index.html`            | Hard refresh (Ctrl+Shift+R)                                              |
| OAuth Google rifiuta callback | URL HTTP con IP non valido come callback | OAuth richiede dominio HTTPS pubblico — non funziona con IP              |

---

## 10. Cose che NON sono in questa guida (ma valuta per la produzione)

- **Monitoring esterno**: Uptime Kuma / Better Stack pingando `/api/health`.
- **Log shipping**: Loki / Grafana Cloud per i log Pino strutturati.
- **Off-site backup**: replica `/opt/aulabook/app/backups/` su Hetzner Storage Box.
- **Fail2ban** per SSH se decidi di non restringere `22/tcp` per IP.
- **Postgres replica**: per HA serve un secondo VPS + streaming replication.
- **Docker / docker-compose**: l'app non ha Dockerfile committato. Setup alternativo che eviterebbe la maggior parte dei comandi `apt` qui sopra.
