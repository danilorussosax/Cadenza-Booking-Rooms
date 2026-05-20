# Installazione di Cadenza su server Linux

Guida passo-passo per portare in produzione (o staging/test) Cadenza su un
qualsiasi VPS o server fisico Linux. La guida è scritta in modo provider-agnostico:
funziona allo stesso modo su una macchina Hetzner, IONOS, Aruba Cloud, OVH,
Scaleway, Contabo, AWS Lightsail o un server on-premise dell'istituto.

Nella sezione finale trovi una panoramica sui **provider VPS attualmente
testati** e sul **dimensionamento consigliato per 500, 1.500 e 3.000 utenti**.

---

## Sommario

1. [Stack target e requisiti](#1-stack-target-e-requisiti)
2. [Pre-requisiti operativi](#2-pre-requisiti-operativi)
3. [Configurazione DNS (solo se hai un dominio)](#3-configurazione-dns-solo-se-hai-un-dominio)
4. [Primo accesso e hardening base](#4-primo-accesso-e-hardening-base)
5. [Installazione manuale](#5-installazione-manuale)
6. [Installazione automatica via script](#6-installazione-automatica-via-script)
7. [Operazioni quotidiane](#7-operazioni-quotidiane)
8. [Troubleshooting](#8-troubleshooting)
9. [Cose che NON sono in questa guida](#9-cose-che-non-sono-in-questa-guida)
10. [Provider VPS e dimensionamento per utenti attivi](#10-provider-vps-e-dimensionamento-per-utenti-attivi)

---

## 1. Stack target e requisiti

| Componente     | Versione consigliata       | Note                                                                            |
| -------------- | -------------------------- | ------------------------------------------------------------------------------- |
| **SO**         | Ubuntu 24.04 LTS           | Anche Debian 12, Rocky/AlmaLinux 9, Fedora 40+ funzionano (adatta `apt`→`dnf`). |
| **Node.js**    | 22 LTS (≥ 20)              | Node 22 è in "Active LTS" fino ad aprile 2027. Il codice richiede ≥ 20.         |
| **PostgreSQL** | 18                         | Cadenza supporta 13+. Per nuove installazioni: 18 (uscita settembre 2025).      |
| **nginx**      | ≥ 1.24                     | Solo reverse proxy + TLS termination.                                           |
| **certbot**    | ≥ 2.x (snap o apt)         | Per certificato Let's Encrypt automatico (solo se hai un dominio).              |
| **systemd**    | qualsiasi versione moderna | Per gestire il servizio in background.                                          |

> Architettura: ARM (aarch64) e x86_64 sono entrambe supportate ufficialmente
> per Node 22 e PostgreSQL 18. Su ARM Ampere/Graviton il prezzo/performance
> è in genere migliore del 15-30 %.

### Cosa NON serve

- **Docker**: il deploy nativo via systemd è più semplice e leggero.
- **Redis / Memcached**: la cache è in-process, basata sulle quote attive.
- **Worker separati**: scheduler e mail outbox girano nel processo principale.
- **Object storage S3**: gli upload (foto profilo, locandine concerti) vivono
  su filesystem locale. Per off-site backup vedi `setup-rclone-backups.sh`.

---

## 2. Pre-requisiti operativi

1. **Server Linux** con accesso root via SSH. Vedi §10 per il dimensionamento.
2. **Dominio** (opzionale ma consigliato — senza dominio non puoi avere HTTPS
   pubblico via Let's Encrypt). Esempio: `cadenza.tuoistituto.it`.
3. **Chiave SSH pubblica**. Su macOS / Linux:
   ```bash
   ssh-keygen -t ed25519 -C "tuo@email.it"   # se non l'hai già
   cat ~/.ssh/id_ed25519.pub                 # questo testo lo carichi sul provider
   ```
4. **URL Git del repo Cadenza** (publicly accessible o con deploy key).
   Esempio: `https://github.com/<tuo-utente>/<repo>.git`.
5. **Porte aperte** sul firewall del provider:
   - `22/tcp` (SSH) — opzionalmente solo dal tuo IP
   - `80/tcp` (HTTP) — anche se userai HTTPS, certbot ne ha bisogno per i renewal
   - `443/tcp` (HTTPS)

---

## 3. Configurazione DNS (solo se hai un dominio)

Vai dal tuo registrar / pannello DNS e crea due record:

| Tipo | Nome              | Valore                                            |
| ---- | ----------------- | ------------------------------------------------- |
| A    | `cadenza` (o `@`) | `<IP-IPv4-del-server>`                            |
| AAAA | `cadenza`         | `<IP-IPv6-del-server>` (opzionale ma consigliato) |

TTL 300 va bene per il debugging iniziale. Aspetta 1-5 minuti, poi verifica con:

```bash
dig +short cadenza.tuoistituto.it
# → deve restituire l'IP del server
```

Se vai con IP-only, salta questo passo.

---

## 4. Primo accesso e hardening base

```bash
ssh root@<IP-server>
```

A prescindere se userai lo script automatico o l'installazione manuale,
conviene partire da una base aggiornata e con firewall attivo:

```bash
# Su Ubuntu/Debian:
apt update && apt upgrade -y
apt install -y unattended-upgrades ufw
dpkg-reconfigure --priority=low unattended-upgrades   # rispondi "Yes" agli aggiornamenti automatici di sicurezza

# Firewall: SSH + HTTP + HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

> Su Rocky/AlmaLinux/Fedora: usa `dnf` al posto di `apt`, `dnf-automatic` al
> posto di `unattended-upgrades`, `firewalld` al posto di `ufw`.

A questo punto due alternative:

- **Veloce**: usa lo script automatico in [§6](#6-installazione-automatica-via-script).
- **Manuale**: prosegui con [§5](#5-installazione-manuale).

---

## 5. Installazione manuale

### 5.1. Pacchetti di base

```bash
apt install -y curl git build-essential ca-certificates gnupg openssl
```

### 5.2. Node.js 22 LTS (NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # deve dire v22.x
npm -v
```

> Se preferisci restare su Node 20 LTS (supportato fino ad aprile 2026 in
> maintenance), sostituisci `setup_22.x` con `setup_20.x`. Il codice è
> compatibile con entrambe.

### 5.3. PostgreSQL 18

Su Ubuntu/Debian usa il repository ufficiale PGDG (la versione di sistema è
più vecchia: in Ubuntu 24.04 il default è Postgres 16):

```bash
# Aggiungi il repository PGDG
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list

apt update
apt install -y postgresql-18 postgresql-contrib-18
systemctl enable --now postgresql

# Crea utente + DB con password casuale
DB_PASSWORD="$(openssl rand -hex 24)"
sudo -u postgres psql <<SQL
CREATE USER cadenza WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE cadenza OWNER cadenza;
GRANT ALL PRIVILEGES ON DATABASE cadenza TO cadenza;
SQL

echo "Salva questa password, la useremo dopo: ${DB_PASSWORD}"
```

> Postgres ascolta solo su `localhost` di default. Va bene così — il backend
> sta sulla stessa macchina.

> 💡 **Tuning per server piccoli** (2-4 vCPU · 4 GB RAM): i default Postgres
> sono molto conservativi. Lo script idempotente `scripts/pg-tune-4gb.sh`
> applica via `ALTER SYSTEM` un set di parametri calibrato (shared_buffers 1GB,
> effective_cache_size 2GB, work_mem 8MB, max_connections 50, checkpoint/WAL/
> parallel workers). Usa `--dry-run` per ispezionare, `--rollback` per tornare
> ai default. Lancialo dopo aver popolato il DB e prima di mettere il sito
> in produzione.

### 5.4. nginx + certbot (HTTPS automatico se hai un dominio)

```bash
apt install -y nginx
systemctl enable --now nginx

# Solo se hai un dominio: certbot per Let's Encrypt
apt install -y certbot python3-certbot-nginx
```

### 5.5. Utente di sistema dedicato

```bash
useradd --system --create-home --home-dir /opt/cadenza --shell /bin/bash cadenza
```

### 5.6. Clone del repo

```bash
sudo -u cadenza -H bash <<'EOF'
cd /opt/cadenza
git clone https://github.com/<tuo-utente>/<repo>.git app
EOF
```

### 5.7. Configurazione `.env`

Genera segreti e crea il file. Scegli il tuo scenario URL:

```bash
# === Scenario A: dominio + HTTPS ===
PUBLIC_URL="https://cadenza.tuoistituto.it"
SERVER_NAME="cadenza.tuoistituto.it"

# === Scenario B: solo IP, HTTP ===
PUBLIC_IP="$(curl -fs https://api.ipify.org || hostname -I | awk '{print $1}')"
PUBLIC_URL="http://${PUBLIC_IP}"
SERVER_NAME="${PUBLIC_IP}"

# === Scenario C: solo IP, HTTPS self-signed ===
# Stesso PUBLIC_IP/SERVER_NAME del B; PUBLIC_URL=https://...
```

```bash
JWT_SECRET="$(openssl rand -hex 32)"
ADMIN_PASSWORD="$(openssl rand -base64 24)"

cat > /opt/cadenza/app/backend/.env <<ENV
NODE_ENV=production
PORT=3000
APP_URL=${PUBLIC_URL}
FRONTEND_URL=${PUBLIC_URL}

# Database
DB_DIALECT=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cadenza
DB_USER=cadenza
DB_PASSWORD=${DB_PASSWORD}
DB_SSL=false
DB_SYNC_MODE=safe

# Sicurezza
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=2h
BCRYPT_COST=12

# Admin di default (creato dal seeder al primo avvio)
DEFAULT_ADMIN_EMAIL=admin@${SERVER_NAME}
DEFAULT_ADMIN_PASSWORD=${ADMIN_PASSWORD}
DEFAULT_ADMIN_FIRSTNAME=Amministratore
DEFAULT_ADMIN_LASTNAME=Sistema

# SMTP (opzionali — possono essere configurati dopo dalla UI admin)
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM=
ENV

chown cadenza:cadenza /opt/cadenza/app/backend/.env
chmod 600 /opt/cadenza/app/backend/.env

echo
echo "==> Salva queste credenziali, NON sono mostrate di nuovo:"
echo "Admin email   : admin@${SERVER_NAME}"
echo "Admin password: ${ADMIN_PASSWORD}"
```

### 5.8. Install dipendenze + build frontend

```bash
sudo -u cadenza -H bash <<'EOF'
set -e
cd /opt/cadenza/app/backend
npm ci --omit=dev
cd /opt/cadenza/app/frontend
npm ci
npm run build
EOF
```

> Il backend serve direttamente `frontend/dist` (vedi `app.js`). Niente static
> separato in nginx.

### 5.9. Prima sincronizzazione schema + seed

Allo startup il backend:

- Esegue `runPreSyncMigrations()` per le colonne aggiunte negli ultimi rilasci.
- Esegue `sequelize.sync()` (modalità `safe`).
- Esegue il seeder iniziale (idempotente — niente paura di rigenerare).

Quindi non c'è uno step manuale: parte tutto al primo `systemctl start cadenza`.

### 5.10. Unit systemd

```bash
cat > /etc/systemd/system/cadenza.service <<'UNIT'
[Unit]
Description=Cadenza backend
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=cadenza
Group=cadenza
WorkingDirectory=/opt/cadenza/app/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/cadenza/app/backend/data /opt/cadenza/app/backend/uploads /opt/cadenza/app/backend/logs

[Install]
WantedBy=multi-user.target
UNIT

mkdir -p /opt/cadenza/app/backend/{data,uploads,logs}
chown -R cadenza:cadenza /opt/cadenza/app/backend/{data,uploads,logs}

systemctl daemon-reload
systemctl enable cadenza
systemctl start cadenza
sleep 3
systemctl status cadenza --no-pager
```

Verifica health endpoint:

```bash
curl -s http://localhost:3000/api/health
# → {"status":"ok","timestamp":"..."}
```

### 5.11. Configurazione nginx

Crea il vhost. Il contenuto dipende dallo scenario:

#### Scenario A — dominio + HTTPS automatico (certbot)

```bash
cat > /etc/nginx/sites-available/cadenza <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name cadenza.tuoistituto.it;

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

ln -sf /etc/nginx/sites-available/cadenza /etc/nginx/sites-enabled/cadenza
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Ora ottieni il certificato Let's Encrypt — certbot modifica automaticamente
il vhost aggiungendo `listen 443 ssl`, redirect HTTP→HTTPS e l'HSTS:

```bash
certbot --nginx -d cadenza.tuoistituto.it --non-interactive --agree-tos -m admin@tuoistituto.it --redirect
systemctl reload nginx
```

> Il rinnovo è già schedulato dal pacchetto certbot (`/etc/cron.d/certbot`
> o systemd timer). Verifica: `systemctl list-timers | grep certbot`.

#### Scenario B — solo IP, HTTP puro

```bash
cat > /etc/nginx/sites-available/cadenza <<NGINX
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

ln -sf /etc/nginx/sites-available/cadenza /etc/nginx/sites-enabled/cadenza
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Apri `http://<IP>` dal browser.

#### Scenario C — solo IP, HTTPS self-signed

Genera un cert con openssl (validità 1 anno, SAN sull'IP):

```bash
PUBLIC_IP="$(curl -fs https://api.ipify.org)"
mkdir -p /etc/ssl/cadenza
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout /etc/ssl/cadenza/privkey.pem \
  -out /etc/ssl/cadenza/fullchain.pem \
  -subj "/CN=${PUBLIC_IP}" \
  -addext "subjectAltName=IP:${PUBLIC_IP}"
chmod 600 /etc/ssl/cadenza/privkey.pem
```

Vhost:

```bash
cat > /etc/nginx/sites-available/cadenza <<NGINX
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

    ssl_certificate     /etc/ssl/cadenza/fullchain.pem;
    ssl_certificate_key /etc/ssl/cadenza/privkey.pem;
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

ln -sf /etc/nginx/sites-available/cadenza /etc/nginx/sites-enabled/cadenza
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

> I browser mostreranno un warning ("Connessione non sicura"). Per evitarlo
> sui tuoi device, importa `/etc/ssl/cadenza/fullchain.pem` come autorità di
> fiducia, oppure usa un dominio + Let's Encrypt.

### 5.12. Backup automatico (cron)

Il repo include `backend/scripts/backup.js` con rotazione (30 giorni / 12
settimane / 12 mesi). Schedula un backup notturno:

```bash
cat > /etc/cron.d/cadenza-backup <<'CRON'
# Backup giornaliero alle 03:30 (server time)
30 3 * * * cadenza cd /opt/cadenza/app/backend && /usr/bin/node scripts/backup.js >> /opt/cadenza/app/backend/logs/backup.log 2>&1
CRON
```

I file finiscono in `/opt/cadenza/app/backups/`.

---

## 6. Installazione automatica via script

Tutto quanto sopra è impacchettato in `scripts/install.sh`. Su un server pulito (root):

```bash
# 1) Carica lo script (scegli il modo che preferisci)
curl -fsSL https://raw.githubusercontent.com/<tuo-utente>/<repo>/main/scripts/install.sh -o install.sh
# oppure: scp scripts/install.sh root@<IP>:/root/

chmod +x install.sh
```

### Esecuzione

**Con dominio (HTTPS via Let's Encrypt):**

```bash
DOMAIN="cadenza.tuoistituto.it" \
ADMIN_EMAIL="admin@tuoistituto.it" \
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
- Installa Node (default 22), PostgreSQL, nginx (+ certbot se DOMAIN è valorizzato).
- Crea utente `cadenza` con DB dedicato + password casuale.
- Clona il repo, fa `npm ci` + `npm run build`.
- Genera `JWT_SECRET`, `DEFAULT_ADMIN_PASSWORD` casuali.
- Configura systemd + vhost nginx (con la modalità giusta).
- Per dominio: lancia `certbot --nginx` per il certificato Let's Encrypt.
- Per IP+TLS: genera cert self-signed via openssl.
- Avvia tutto.
- Stampa le credenziali admin a fine run (è l'unica volta che le vedi).

È **idempotente**: rieseguirlo aggiorna il codice via `git pull`, ricostruisce,
riavvia il service. NON sovrascrive `.env` né le password generate.

Variabili opzionali utili:

| Variabile         | Default            | Descrizione                                                      |
| ----------------- | ------------------ | ---------------------------------------------------------------- |
| `NODE_MAJOR`      | `22`               | Major Node da installare (es. `20` se vuoi restare in LTS prec.) |
| `BRANCH`          | `main`             | Branch git da deployare                                          |
| `APP_USER`        | `cadenza`          | Utente di sistema                                                |
| `APP_DIR`         | `/opt/cadenza/app` | Directory di installazione                                       |
| `DB_NAME`         | `cadenza`          | Nome database                                                    |
| `DB_USER`         | `cadenza`          | Utente database                                                  |
| `PORT`            | `3000`             | Porta HTTP del backend Node                                      |
| `SKIP_FIREWALL=1` | —                  | Non tocca ufw                                                    |
| `SKIP_NGINX=1`    | —                  | Non installa né configura nginx (se hai già un proxy esterno)    |

---

## 7. Operazioni quotidiane

### Vedere i log

```bash
journalctl -u cadenza -f                          # log live del backend
journalctl -u nginx -f                             # eventi nginx
tail -f /var/log/nginx/access.log                  # access log
tail -f /var/log/nginx/error.log                   # errori
tail -f /opt/cadenza/app/backend/logs/backup.log   # log backup
```

### Riavviare l'app

```bash
systemctl restart cadenza
systemctl reload nginx     # se hai modificato vhost
```

### Aggiornare l'app (manuale)

```bash
sudo -u cadenza -H bash -c '
  cd /opt/cadenza/app
  git pull
  cd backend && npm ci --omit=dev
  cd ../frontend && npm ci && npm run build
'
systemctl restart cadenza
```

### Aggiornare l'app (push da workstation con `deploy.sh`)

Per il flusso "push" da Mac/Linux locale verso il server (build frontend in
locale + rsync incrementale + restart + healthcheck) il repo include lo
script idempotente `deploy.sh` nella root del monorepo:

```bash
./deploy.sh                # interattivo (chiede conferma sul diff dry-run)
./deploy.sh --yes          # senza conferma (CI / uso rapido)
./deploy.sh --no-build     # salta la build frontend (se già fatta)
./deploy.sh --update-deps  # pre-deploy `npm outdated` su backend/ e frontend/,
                           # chiede per ciascuno se applicare aggiornamenti
                           # semver-safe via `npm update` (rispetta i range ^/~
                           # in package.json — niente major bump). Le modifiche
                           # al package-lock.json vengono raccolte dal normale
                           # flusso (rsync + npm ci).
```

Lo script verifica che il server remoto non abbia moduli più moderni del
locale (per non regredire le versioni installate sul server) e fa healthcheck
post-deploy. Le credenziali SSH/host sono nelle prime righe dello script, da
personalizzare al primo uso.

### Migrazioni schema dopo cambi al modello

```bash
sudo -u cadenza -H bash -c '
  cd /opt/cadenza/app/backend
  DB_SYNC_MODE=alter node server.js   # Ctrl+C dopo "Schema DB sincronizzato"
'
systemctl restart cadenza
```

### Snapshot manuale

La maggior parte dei provider VPS permette di creare uno snapshot dal pannello
web (sezione "Snapshot" / "Immagini" / "Backup manuale"). Per ambienti
dev/test prendine uno prima di un cambio rischioso. Per uno snapshot
applicativo-aware (DB consistente) lancia prima `node backend/scripts/backup.js`
e poi lo snapshot del disco.

### Spostare l'app su un altro dominio

Lo script `scripts/migrate-domain.sh` automatizza la migrazione in **4 fasi
guidate** con backup, healthcheck e rollback:

| Fase        | Cosa fa                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight` | Verifica DNS, emette il certificato Let's Encrypt sul nuovo dominio, crea il server block nginx fianco a fianco al vecchio (zero downtime)                              |
| `cutover`   | Backup `.env`, sostituisce `FRONTEND_URL` e `APP_URL`, riavvia il backend (auto-detect pm2/systemd), healthcheck                                                        |
| `redirect`  | Riconfigura il vecchio dominio come 301 al nuovo, **mantenendo attivi** `/api/bookings/ical` e `/check-in/room/*` per non rompere sottoscrizioni iCal e QR già stampati |
| `finalize`  | (dopo ~90 giorni) cleanup del vecchio vhost                                                                                                                             |

Esempio:

```bash
# 1) Aggiungi prima il record DNS A/AAAA per il nuovo sottodominio
# 2) Sul server:
sudo bash scripts/migrate-domain.sh \
  --old vecchio.tuoistituto.it \
  --new nuovo.tuoistituto.it \
  --phase preflight

# 3) Aggiungi i nuovi redirect URI nei provider OAuth (Google + Microsoft)
#    e aggiorna la UI admin Cadenza → Server Settings → OAuth con i nuovi callback.

# 4) Cutover (richiede conferma):
sudo bash scripts/migrate-domain.sh \
  --old vecchio.tuoistituto.it \
  --new nuovo.tuoistituto.it \
  --phase cutover

# 5) Re-registra il webhook Telegram dalla UI admin
#    (Server Settings → Servizi → Messaging → Telegram → "Configura automaticamente")

# 6) Redirect del vecchio dominio:
sudo bash scripts/migrate-domain.sh \
  --old vecchio.tuoistituto.it \
  --new nuovo.tuoistituto.it \
  --phase redirect

# 7) Dopo ~90 giorni, cleanup finale:
sudo bash scripts/migrate-domain.sh \
  --old vecchio.tuoistituto.it \
  --new nuovo.tuoistituto.it \
  --phase finalize
```

Flag utili: `--dry-run` (mostra solo cosa farebbe), `--yes` (skippa le conferme
per CI), `--service NAME` (override auto-detect pm2/systemd), `--env-file PATH`
(override path del `.env`).

I backup di ogni fase finiscono in `~/cadenza-migration-backups/<timestamp>/`.

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
  -keyout /etc/ssl/cadenza/privkey.pem \
  -out /etc/ssl/cadenza/fullchain.pem \
  -subj "/CN=$(curl -fs https://api.ipify.org)" \
  -addext "subjectAltName=IP:$(curl -fs https://api.ipify.org)"
systemctl reload nginx
```

---

## 8. Troubleshooting

| Sintomo                       | Causa probabile                          | Cosa fare                                                               |
| ----------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `cadenza.service` failed      | Errore di avvio Node                     | `journalctl -u cadenza -n 100`                                          |
| nginx 502 Bad Gateway         | Backend down o non in ascolto su :3000   | `curl -s http://localhost:3000/api/health` ; `systemctl status cadenza` |
| `nginx -t` fallisce           | Errore di sintassi nel vhost             | Leggi l'errore: indica file e riga esatti                               |
| certbot fallisce              | DNS non propagato o porta 80 bloccata    | `dig +short <dominio>`; verifica firewall (`ufw status`)                |
| Errore connessione DB         | Password sbagliata in `.env`             | `sudo -u postgres psql -c "ALTER USER cadenza WITH PASSWORD '...'"`     |
| Email non partono             | SMTP non configurato                     | OK in dev/test (l'app è no-op se SMTP off)                              |
| Frontend stale dopo deploy    | Cache browser su `index.html`            | Hard refresh (Ctrl+Shift+R)                                             |
| OAuth Google rifiuta callback | URL HTTP con IP non valido come callback | OAuth richiede dominio HTTPS pubblico — non funziona con IP             |

---

## 9. Cose che NON sono in questa guida

Cose utili da valutare per la produzione "seria":

- **Restrizione IP del kiosk pubblico**: limita `/display` + `/api/public/*`
  ai soli IP dell'istituto via nginx allowlist. Guida passo-passo in
  [`KIOSK_IP_ALLOWLIST.md`](KIOSK_IP_ALLOWLIST.md).
- **Tuning Postgres** per VPS 4 GB RAM: lancia `scripts/pg-tune-4gb.sh`
  (dettagli in §5.3).
- **Monitoring esterno**: Uptime Kuma / Better Stack pingando `/api/health`
  e `/api/ready` (readinessProbe-compatible, dettaglia DB/SMTP/disk).
- **Log shipping**: Loki / Grafana Cloud per i log Pino strutturati.
- **Off-site backup**: replica `/opt/cadenza/app/backups/` su un secondo provider
  via `scripts/setup-rclone-backups.sh` (rclone supporta S3, B2, Google Drive,
  Hetzner Storage Box, qualsiasi WebDAV…).
- **WAL archiving Postgres**: PITR (point-in-time-recovery) via
  `scripts/setup-wal-archiving.sh`.
- **Fail2ban** per SSH se decidi di non restringere `22/tcp` per IP.
- **Postgres replica**: per HA serve un secondo server + streaming replication.
- **Docker / docker-compose**: l'app non ha Dockerfile committato. Setup
  alternativo che eviterebbe la maggior parte dei comandi `apt` qui sopra.

---

## 10. Provider VPS e dimensionamento per utenti attivi

> Le specifiche minime di Cadenza (Node 22 + Postgres 18 + nginx) girano
> tranquillamente su qualsiasi VPS Linux moderno. I tagli sotto sono pensati
> per **istituti reali in produzione**, con margine per backup notturni,
> picchi di concert booking e snapshot consistenti.

### Profili di carico

| Profilo | Utenti registrati | Picco concorrenza | Booking/giorno | Note                                        |
| ------- | ----------------- | ----------------- | -------------- | ------------------------------------------- |
| **S**   | ~500              | ~30-50            | ~200-400       | Conservatorio piccolo / scuola di musica    |
| **M**   | ~1.500            | ~100-150          | ~600-1.000     | Conservatorio medio                         |
| **L**   | ~3.000            | ~250-400          | ~1.500-2.500   | Conservatorio grande o consorzio multi-sede |

### Requisiti hardware consigliati

| Profilo | vCPU | RAM   | Disco SSD | Banda mese | Postgres                | Note                                                                                   |
| ------- | ---- | ----- | --------- | ---------- | ----------------------- | -------------------------------------------------------------------------------------- |
| **S**   | 2    | 4 GB  | 40 GB     | 1-2 TB     | stesso host, default    | Backup giornalieri locali. Snapshot settimanale del provider.                          |
| **M**   | 4    | 8 GB  | 80 GB     | 2-5 TB     | stesso host, `pg-tune`  | `pg-tune-4gb.sh` consigliato. Backup giornaliero + off-site (rclone).                  |
| **L**   | 4-6  | 16 GB | 160 GB    | 5-10 TB    | host dedicato o managed | DB su VPS separato (LAN privata). WAL archiving per PITR. Replica read-only opzionale. |

> **Storage**: i numeri sopra includono OS + app + DB + 30 giorni di backup
> giornalieri rotanti. Se attivi gli upload locandine concerti e foto aule
> a piena risoluzione, aggiungi ~10 GB ogni 1.000 booking di tipo `concerto`.

> **CPU vs RAM**: Cadenza è I/O-bound (DB + filesystem) molto più che CPU-bound.
> Se devi scegliere tra "+2 vCPU" e "+4 GB RAM" a parità di budget, **scegli
> sempre la RAM** (cache Postgres + cache filesystem). ARM è ottimo per il
> profilo S/M; per L valuta x86 se vuoi più scelta di managed Postgres.

### Provider attualmente testati

I tre provider sotto sono quelli su cui Cadenza è effettivamente girata in
produzione/staging. Tutti hanno datacenter in Europa (UE-GDPR-compliant),
SSD NVMe, IPv6, snapshot e backup nativi.

#### Hetzner Cloud (datacenter Germania/Finlandia)

Rapporto qualità/prezzo migliore dei tre. ARM Ampere su tutta la linea CAX.
Backup automatici opzionali al ~20 % sopra il prezzo base.

| Profilo | Piano consigliato (ARM) | Piano consigliato (x86) | Hardware                |
| ------- | ----------------------- | ----------------------- | ----------------------- |
| **S**   | `CAX11`                 | `CX22`                  | 2 vCPU · 4 GB · 40 GB   |
| **M**   | `CAX21`                 | `CX32`                  | 4 vCPU · 8 GB · 80 GB   |
| **L**   | `CAX31`                 | `CX42`                  | 8 vCPU · 16 GB · 160 GB |

Datacenter consigliati per utenti italiani: `Falkenstein (FSN1)`,
`Nuremberg (NBG1)`, `Helsinki (HEL1)` — latenza ~25-40 ms.

#### IONOS Cloud (datacenter Germania/UK)

Provider tedesco affidabile, fatturazione in EUR con P.IVA italiana.
Vantaggio: contratti annuali con sconto significativo, ottimo per istituti
pubblici con bilancio annuale.

| Profilo | Piano consigliato (VPS Linux)         | Hardware                   |
| ------- | ------------------------------------- | -------------------------- |
| **S**   | VPS Linux M (~2 vCPU/2 GB)            | upgrade a 4 GB consigliato |
| **M**   | VPS Linux L (~4 vCPU/8 GB)            | 4 vCPU · 8 GB · 160 GB     |
| **L**   | VPS Linux XL/XXL (~6-8 vCPU/12-24 GB) | 6+ vCPU · 16+ GB · 240+ GB |

> Per profilo L valuta i Cloud Server "Cube" o "Compute Engine" IONOS:
> permettono di separare il DB su un secondo nodo con LAN privata gratuita
> tra istanze nello stesso datacenter.

#### Aruba Cloud (datacenter Italia)

Unico dei tre con datacenter sul territorio italiano (Arezzo / Bergamo).
Vantaggio: latenza minima per utenti italiani, dati in IT, fatturazione
italiana semplificata per PA (CIG/CUP, MEPA).

| Profilo | Piano consigliato       | Hardware               |
| ------- | ----------------------- | ---------------------- |
| **S**   | Cloud VPS Large         | 2 vCPU · 4 GB · 80 GB  |
| **M**   | Cloud VPS XLarge        | 4 vCPU · 8 GB · 160 GB |
| **L**   | Cloud Server PRO Medium | 4-6 vCPU · 16+ GB SSD  |

> Per il profilo L su Aruba valuta la linea **Cloud Server PRO** (risorse
> riservate, no overcommit) anziché il VPS condiviso: la latenza Postgres è
> più stabile sotto carico.

### Come scegliere

- **Vincoli di residenza dati IT/PA-MEPA**: Aruba Cloud (datacenter italiani).
- **Budget minimo a parità di performance**: Hetzner Cloud (ARM CAX).
- **Fatturazione annuale anticipata / scontistica volume**: IONOS Cloud.
- **Latenza minima per utenti italiani**: Aruba (IT) o Hetzner Falkenstein (~25 ms).
- **HA / multi-zona**: tutti e tre offrono snapshot e backup; solo IONOS e
  Aruba hanno SLA contrattuali su uptime (>99.9 %).

> I prezzi cambiano spesso. Prima di acquistare verifica i listini ufficiali:
> [hetzner.com/cloud](https://www.hetzner.com/cloud) · [ionos.it/server-cloud](https://www.ionos.it/server-cloud) · [aruba.it/cloud](https://www.aruba.it/cloud).

### Upgrade in corsa

Tutti e tre i provider permettono il resize "a caldo" del VPS (vCPU/RAM)
con un riavvio di pochi minuti. Strategia consigliata:

1. Partire dal profilo immediatamente sotto le proprie stime (es. S per
   istituto previsto a 500 utenti).
2. Attivare il monitoring esterno su `/api/ready` (vedi §9).
3. Quando l'endpoint mostra `checks.disk.usedPct >= 80%` o la CPU media
   settimanale supera il 60 %, schedulare un upgrade al profilo successivo.
4. Il resize è non distruttivo: filesystem, IP, DNS restano invariati.

---

**Fine guida.** Per supporto operativo apri una issue sul repository o
consulta `develop.md` (note di sviluppo) e `docs/ARCHITECTURE.md` (mappa
dell'applicazione).
