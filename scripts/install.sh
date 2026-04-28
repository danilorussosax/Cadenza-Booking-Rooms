#!/usr/bin/env bash
#
# Aula Book — installer automatico per VPS Ubuntu 24.04 (Hetzner Cloud o equivalenti).
#
# Stack: Node 20 + PostgreSQL 16 + nginx (+ certbot/Let's Encrypt se DOMAIN) + systemd.
#
# USO (con dominio + HTTPS Let's Encrypt):
#   DOMAIN="aulabook.miodominio.it" \
#   ADMIN_EMAIL="admin@miodominio.it" \
#   REPO_URL="https://github.com/<tuo-utente>/<repo>.git" \
#   ./install.sh
#
# USO (solo IP — niente dominio):
#   ADMIN_EMAIL="admin@example.com" \
#   REPO_URL="https://github.com/<tuo-utente>/<repo>.git" \
#   ./install.sh
#   # Lo script auto-rileva l'IP pubblico. App raggiungibile su http://<IP>.
#   # Per HTTPS self-signed (browser warning ma cifrato): USE_TLS_INTERNAL=1
#
# Argomenti opzionali:
#   DOMAIN                  se valorizzato → HTTPS Let's Encrypt automatico via certbot
#   PUBLIC_IP               forza l'IP pubblico (default: rilevato in automatico)
#   USE_TLS_INTERNAL=1      modalità IP-only con cert self-signed (openssl)
#   BRANCH                  branch git da deployare (default: main)
#   APP_USER                utente di sistema (default: aulabook)
#   APP_DIR                 directory installazione (default: /opt/aulabook/app)
#   DB_NAME / DB_USER       (default: aulabook / aulabook)
#   PORT                    porta HTTP del backend Node (default: 3000)
#   SKIP_FIREWALL=1         non tocca ufw
#   SKIP_NGINX=1            non installa né configura nginx (utile se hai già un proxy)
#
# IDEMPOTENTE: rieseguibile senza problemi. Aggiorna il codice (git pull),
# rebuilda il frontend, riavvia il service. NON sovrascrive il .env esistente
# né le password generate al primo run.

set -euo pipefail

# =====================================================
# Helper di output
# =====================================================
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; RESET=$'\033[0m'
log()  { printf "%s[*]%s %s\n" "$BLUE"  "$RESET" "$*"; }
ok()   { printf "%s[✓]%s %s\n" "$GREEN" "$RESET" "$*"; }
warn() { printf "%s[!]%s %s\n" "$YELLOW" "$RESET" "$*"; }
die()  { printf "%s[✗]%s %s\n" "$RED"   "$RESET" "$*" >&2; exit 1; }

# =====================================================
# Validazione parametri
# =====================================================
[[ "$EUID" -eq 0 ]] || die "Devi eseguire come root (o con sudo)."

: "${ADMIN_EMAIL:?ADMIN_EMAIL è obbligatorio (es. admin@miodominio.it)}"
: "${REPO_URL:?REPO_URL è obbligatorio (es. https://github.com/.../repo.git)}"

DOMAIN="${DOMAIN:-}"
USE_TLS_INTERNAL="${USE_TLS_INTERNAL:-0}"
PUBLIC_IP="${PUBLIC_IP:-}"
BRANCH="${BRANCH:-main}"
APP_USER="${APP_USER:-aulabook}"
APP_DIR="${APP_DIR:-/opt/aulabook/app}"
APP_HOME="$(dirname "$APP_DIR")"  # /opt/aulabook
DB_NAME="${DB_NAME:-aulabook}"
DB_USER="${DB_USER:-aulabook}"
PORT="${PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"

# =====================================================
# Detect IP pubblico se DOMAIN non è valorizzato.
# Strategia (in ordine):
#   1) PUBLIC_IP fornito esplicitamente
#   2) curl https://api.ipify.org (servizio echo IP, no auth)
#   3) hostname -I (preso il primo non-loopback) — fallback offline
# =====================================================
detect_public_ip() {
  if [[ -n "$PUBLIC_IP" ]]; then
    echo "$PUBLIC_IP"; return
  fi
  local ip
  ip="$(curl -fs --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [[ -n "$ip" ]]; then echo "$ip"; return; fi
  ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -vE '^(127\.|::1|fe80)' | head -n1 || true)"
  echo "$ip"
}

# DEPLOY_MODE determina:
#   - URL nel .env (APP_URL/FRONTEND_URL)
#   - server_name + listen del vhost nginx
#   - se invocare certbot (Let's Encrypt) o openssl (self-signed)
if [[ -z "$DOMAIN" ]]; then
  PUBLIC_IP="$(detect_public_ip)"
  [[ -n "$PUBLIC_IP" ]] || die "Impossibile rilevare l'IP pubblico. Passa PUBLIC_IP=... esplicitamente."
  PUBLIC_HOST="$PUBLIC_IP"
  if [[ "$USE_TLS_INTERNAL" == "1" ]]; then
    PUBLIC_URL="https://${PUBLIC_HOST}"
    DEPLOY_MODE="ip+tls-internal"
  else
    PUBLIC_URL="http://${PUBLIC_HOST}"
    DEPLOY_MODE="ip-only"
  fi
else
  PUBLIC_HOST="$DOMAIN"
  PUBLIC_URL="https://${DOMAIN}"
  DEPLOY_MODE="domain"
fi

log "Configurazione:"
log "  DEPLOY_MODE = $DEPLOY_MODE"
[[ -n "$DOMAIN" ]] && log "  DOMAIN      = $DOMAIN"
[[ -z "$DOMAIN" ]] && log "  PUBLIC_IP   = $PUBLIC_IP"
log "  PUBLIC_URL  = $PUBLIC_URL"
log "  ADMIN_EMAIL = $ADMIN_EMAIL"
log "  REPO_URL    = $REPO_URL"
log "  BRANCH      = $BRANCH"
log "  APP_DIR     = $APP_DIR"

# =====================================================
# 1. Sistema base + hardening
# =====================================================
log "Aggiorno il sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

log "Installo pacchetti di base..."
apt-get install -y -qq \
  curl git build-essential ca-certificates gnupg \
  unattended-upgrades ufw openssl jq

dpkg-reconfigure --priority=low unattended-upgrades >/dev/null 2>&1 || true
ok "Pacchetti di base installati"

if [[ "${SKIP_FIREWALL:-0}" != "1" ]]; then
  log "Configuro firewall (ufw)..."
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  ok "Firewall: 22/80/443 aperti"
fi

# =====================================================
# 2. Node.js
# =====================================================
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -dv -f2 | cut -d. -f1)" != "$NODE_MAJOR" ]]; then
  log "Installo Node.js ${NODE_MAJOR}.x..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
ok "Node $(node -v) · npm $(npm -v)"

# =====================================================
# 3. PostgreSQL
# =====================================================
if ! command -v psql >/dev/null 2>&1; then
  log "Installo PostgreSQL..."
  apt-get install -y -qq postgresql postgresql-contrib
fi
systemctl enable --now postgresql >/dev/null

# Crea DB user + DB se mancanti (idempotente)
DB_USER_EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")"
if [[ "$DB_USER_EXISTS" != "1" ]]; then
  log "Creo utente PostgreSQL '${DB_USER}' con password casuale..."
  DB_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql >/dev/null <<SQL
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
SQL
  echo "$DB_PASSWORD" > /tmp/aulabook-db-pwd
  chmod 600 /tmp/aulabook-db-pwd
else
  log "Utente PostgreSQL '${DB_USER}' già esistente — riuso credenziali esistenti"
fi

DB_EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")"
if [[ "$DB_EXISTS" != "1" ]]; then
  sudo -u postgres psql >/dev/null <<SQL
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL
fi
ok "PostgreSQL pronto (DB=${DB_NAME}, USER=${DB_USER})"

# =====================================================
# 4. nginx (+ certbot se serve dominio HTTPS)
# =====================================================
if [[ "${SKIP_NGINX:-0}" != "1" ]]; then
  if ! command -v nginx >/dev/null 2>&1; then
    log "Installo nginx..."
    apt-get install -y -qq nginx
  fi
  systemctl enable --now nginx >/dev/null

  if [[ "$DEPLOY_MODE" == "domain" ]] && ! command -v certbot >/dev/null 2>&1; then
    log "Installo certbot (Let's Encrypt)..."
    apt-get install -y -qq certbot python3-certbot-nginx
  fi
  ok "nginx $(nginx -v 2>&1 | awk -F/ '{print $2}') installato"
fi

# =====================================================
# 5. Utente di sistema + clone repo
# =====================================================
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Creo utente di sistema '${APP_USER}'..."
  useradd --system --create-home --home-dir "$APP_HOME" --shell /bin/bash "$APP_USER"
fi
mkdir -p "$APP_HOME"
chown "$APP_USER:$APP_USER" "$APP_HOME"

if [[ ! -d "$APP_DIR/.git" ]]; then
  log "Clono il repository in ${APP_DIR}..."
  sudo -u "$APP_USER" -H git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  log "Repository già presente, faccio git pull..."
  sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && git fetch --all --prune && git checkout '$BRANCH' && git pull"
fi
ok "Repo @ $(sudo -u "$APP_USER" -H git -C "$APP_DIR" rev-parse --short HEAD)"

# =====================================================
# 6. .env (idempotente: non sovrascrive se già presente)
# =====================================================
ENV_FILE="$APP_DIR/backend/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  log "Genero .env con segreti casuali..."

  if [[ -f /tmp/aulabook-db-pwd ]]; then
    DB_PASSWORD="$(cat /tmp/aulabook-db-pwd)"
    rm -f /tmp/aulabook-db-pwd
  else
    DB_PASSWORD="REIMPOSTA_QUI_LA_PASSWORD_DEL_DB"
    warn "Utente DB pre-esistente: la password non è disponibile."
    warn "Modifica DB_PASSWORD in $ENV_FILE manualmente, oppure resettala con:"
    warn "  sudo -u postgres psql -c \"ALTER USER ${DB_USER} WITH PASSWORD '...'\""
  fi

  JWT_SECRET="$(openssl rand -hex 32)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 20)"

  cat > "$ENV_FILE" <<ENV
# Generato da scripts/install.sh — modifica con cautela
NODE_ENV=production
PORT=${PORT}
APP_URL=${PUBLIC_URL}
FRONTEND_URL=${PUBLIC_URL}

# Database
DB_DIALECT=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_SSL=false
DB_SYNC_MODE=safe

# Sicurezza
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=2h
SESSION_SECRET=${SESSION_SECRET}
BCRYPT_COST=12

# Admin di default (creato dal seeder al primo avvio se non già presente)
DEFAULT_ADMIN_EMAIL=${ADMIN_EMAIL}
DEFAULT_ADMIN_PASSWORD=${ADMIN_PASSWORD}
DEFAULT_ADMIN_FIRSTNAME=Amministratore
DEFAULT_ADMIN_LASTNAME=Sistema

# SMTP (opzionali — compila se vuoi inviare email transazionali)
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM=

# OAuth (opzionali — i provider richiedono URL di callback raggiungibili
# pubblicamente. Funzionano anche con IP, ma Google/Microsoft potrebbero
# rifiutare URL HTTP con IP: per OAuth è quasi sempre necessario un dominio.)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GOOGLE_CALLBACK_URL=${PUBLIC_URL}/api/auth/google/callback
# MICROSOFT_CLIENT_ID=
# MICROSOFT_CLIENT_SECRET=
# MICROSOFT_CALLBACK_URL=${PUBLIC_URL}/api/auth/microsoft/callback

# Backup
# BACKUP_KEEP_DAILY=30
# BACKUP_KEEP_WEEKLY=12
# BACKUP_KEEP_MONTHLY=12
ENV

  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok ".env creato"

  cat > /tmp/aulabook-credentials <<CRED
Admin email   : ${ADMIN_EMAIL}
Admin password: ${ADMIN_PASSWORD}

URL: ${PUBLIC_URL}
CRED
  chmod 600 /tmp/aulabook-credentials
else
  log ".env esistente, lo lascio invariato"
fi

# =====================================================
# 7. npm ci + build frontend
# =====================================================
log "Installo dipendenze backend..."
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR/backend' && npm ci --omit=dev --no-audit --no-fund"

log "Installo dipendenze frontend..."
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR/frontend' && npm ci --no-audit --no-fund"

log "Build frontend..."
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR/frontend' && npm run build"
ok "Build frontend completata"

mkdir -p "$APP_DIR/backend/data" "$APP_DIR/backend/uploads" "$APP_DIR/backend/logs" "$APP_DIR/backups"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/backend/data" "$APP_DIR/backend/uploads" "$APP_DIR/backend/logs" "$APP_DIR/backups"

# =====================================================
# 8. systemd unit
# =====================================================
SERVICE_FILE="/etc/systemd/system/aulabook.service"
log "Configuro systemd service ${SERVICE_FILE}..."

cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=Aula Book backend
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}/backend/data ${APP_DIR}/backend/uploads ${APP_DIR}/backend/logs ${APP_DIR}/backups

# Logging via journald (consultabile con journalctl -u aulabook)
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable aulabook >/dev/null
systemctl restart aulabook
ok "aulabook.service abilitato e avviato"

# =====================================================
# 9. nginx vhost
# =====================================================
write_nginx_vhost() {
  local mode="$1"
  local vhost=/etc/nginx/sites-available/aulabook

  case "$mode" in
    domain)
      # Vhost iniziale HTTP-only: certbot lo modifica successivamente
      # aggiungendo il blocco listen 443 ssl + redirect HTTP→HTTPS.
      cat > "$vhost" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    client_max_body_size 16m;

    gzip on;
    gzip_proxied any;
    gzip_types application/json application/javascript text/css text/plain image/svg+xml;
    gzip_min_length 1024;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
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
      ;;

    ip-only)
      cat > "$vhost" <<NGINX
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
    gzip_min_length 1024;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
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
      ;;

    ip+tls-internal)
      cat > "$vhost" <<NGINX
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
    ssl_prefer_server_ciphers off;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    client_max_body_size 16m;

    gzip on;
    gzip_proxied any;
    gzip_types application/json application/javascript text/css text/plain image/svg+xml;
    gzip_min_length 1024;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
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
      ;;
  esac

  ln -sf "$vhost" /etc/nginx/sites-enabled/aulabook
  rm -f /etc/nginx/sites-enabled/default
}

generate_self_signed_cert() {
  local cert_dir=/etc/ssl/aulabook
  local subj="/CN=${PUBLIC_HOST}"
  local san="IP:${PUBLIC_HOST}"

  mkdir -p "$cert_dir"
  if [[ ! -s "$cert_dir/fullchain.pem" || ! -s "$cert_dir/privkey.pem" ]]; then
    log "Genero certificato self-signed (validità 365 gg) per ${PUBLIC_HOST}..."
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -keyout "$cert_dir/privkey.pem" \
      -out    "$cert_dir/fullchain.pem" \
      -subj   "$subj" \
      -addext "subjectAltName=${san}" \
      >/dev/null 2>&1
    chmod 600 "$cert_dir/privkey.pem"
    ok "Certificato self-signed generato"
  else
    log "Certificato self-signed già presente, lo riuso"
  fi
}

if [[ "${SKIP_NGINX:-0}" != "1" ]]; then
  log "Configuro nginx (mode=${DEPLOY_MODE})..."

  case "$DEPLOY_MODE" in
    domain)
      write_nginx_vhost "domain"
      nginx -t
      systemctl reload nginx

      # certbot --nginx: ottiene il cert e modifica il vhost (HTTPS + redirect).
      # È idempotente: se il cert esiste già, lo rinnova solo se necessario.
      log "Richiedo certificato Let's Encrypt per ${DOMAIN}..."
      if certbot --nginx -d "$DOMAIN" \
            --non-interactive --agree-tos -m "$ADMIN_EMAIL" \
            --redirect --no-eff-email; then
        ok "Certificato emesso/aggiornato. HTTPS attivo."
      else
        warn "certbot ha fallito. Possibili cause: DNS non propagato, porta 80 non raggiungibile."
        warn "Riprova dopo aver verificato 'dig +short ${DOMAIN}' e 'ufw status'."
      fi
      systemctl reload nginx
      ;;

    ip+tls-internal)
      generate_self_signed_cert
      write_nginx_vhost "ip+tls-internal"
      nginx -t
      systemctl reload nginx
      ok "nginx configurato con HTTPS self-signed"
      ;;

    ip-only|*)
      write_nginx_vhost "ip-only"
      nginx -t
      systemctl reload nginx
      ok "nginx configurato in HTTP puro su :80"
      ;;
  esac
fi

# =====================================================
# 10. Backup notturno
# =====================================================
CRON_FILE="/etc/cron.d/aulabook-backup"
if [[ ! -f "$CRON_FILE" ]]; then
  log "Programmo backup notturno (03:30)..."
  cat > "$CRON_FILE" <<CRON
# Aula Book — backup giornaliero alle 03:30
30 3 * * * ${APP_USER} cd ${APP_DIR}/backend && /usr/bin/node scripts/backup.js >> ${APP_DIR}/backend/logs/backup.log 2>&1
CRON
  chmod 644 "$CRON_FILE"
  ok "Cron backup configurato"
fi

# =====================================================
# 11. Verifica finale
# =====================================================
log "Verifica health endpoint..."
sleep 3
HEALTH="$(curl -fs --max-time 5 "http://localhost:${PORT}/api/health" || true)"
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  ok "Backend risponde su localhost:${PORT}"
else
  warn "Health check fallito. Controlla: journalctl -u aulabook -n 50"
fi

if [[ "${SKIP_NGINX:-0}" != "1" ]]; then
  case "$DEPLOY_MODE" in
    domain)
      log "Verifica HTTPS pubblico..."
      for _ in {1..10}; do
        if curl -fs --max-time 5 "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
          ok "HTTPS attivo su https://${DOMAIN}"
          break
        fi
        sleep 2
      done
      ;;
    ip+tls-internal)
      if curl -fsk --max-time 5 "${PUBLIC_URL}/api/health" >/dev/null 2>&1; then
        ok "HTTPS self-signed attivo (i browser mostreranno warning sul certificato)"
      else
        warn "Health via HTTPS self-signed fallito. Vedi: tail -n 50 /var/log/nginx/error.log"
      fi
      ;;
    ip-only)
      if curl -fs --max-time 5 "${PUBLIC_URL}/api/health" >/dev/null 2>&1; then
        ok "App raggiungibile via HTTP su ${PUBLIC_URL}"
      else
        warn "Health via HTTP fallito. Vedi: tail -n 50 /var/log/nginx/error.log"
      fi
      ;;
  esac
fi

# =====================================================
# 12. Stampa credenziali (se primo run)
# =====================================================
echo
echo "================================================================"
echo "  Aula Book — installazione completata"
echo "================================================================"
echo
if [[ -f /tmp/aulabook-credentials ]]; then
  cat /tmp/aulabook-credentials
  rm -f /tmp/aulabook-credentials
  echo
  warn "Salva queste credenziali ORA: non saranno mostrate di nuovo."
else
  echo "URL: ${PUBLIC_URL}"
  echo "(Esecuzione successiva: credenziali admin invariate dal primo run.)"
fi

case "$DEPLOY_MODE" in
  ip-only)
    echo
    warn "Modalità HTTP: il traffico NON è cifrato. Va bene per dev/test su rete fidata."
    warn "Per HTTPS self-signed: rilancia con USE_TLS_INTERNAL=1"
    warn "Per HTTPS pubblico via Let's Encrypt: configura un dominio e rilancia con DOMAIN=..."
    ;;
  ip+tls-internal)
    echo
    warn "Certificato self-signed: i browser mostreranno un warning."
    warn "Per evitare il warning sui tuoi device, importa /etc/ssl/aulabook/fullchain.pem"
    warn "come autorità di fiducia, oppure usa un dominio + Let's Encrypt."
    ;;
esac

echo
echo "Comandi utili:"
echo "  systemctl status aulabook         # stato del backend"
echo "  journalctl -u aulabook -f         # log live"
echo "  systemctl restart aulabook        # riavvio"
echo "  systemctl reload nginx            # ricarica vhost"
echo "  tail -f /var/log/nginx/access.log # access log"
echo "  ./install.sh                      # rieseguibile per aggiornare il deploy"
echo
