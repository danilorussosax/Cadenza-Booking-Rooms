#!/usr/bin/env bash
# =============================================================================
# Cadenza · Migrazione assistita dominio
#
# Sposta l'app da un dominio a un altro (es. prenotazioneaule.it →
# rota.prenotazioneaule.it) attraverso 4 fasi controllate, con backup
# automatici dell'.env e della configurazione nginx, conferme interattive
# e healthcheck.
#
# Uso (sul VPS):
#   sudo bash scripts/migrate-domain.sh \
#        --old prenotazioneaule.it \
#        --new rota.prenotazioneaule.it \
#        --phase preflight     # poi: --phase cutover, --phase redirect, --phase finalize
#
# Opzioni:
#   --old DOMAIN       Dominio attuale (obbligatorio)
#   --new DOMAIN       Dominio nuovo (obbligatorio)
#   --phase NAME       preflight | cutover | redirect | finalize
#                      (se omesso, mostra menu interattivo)
#   --env-file PATH    Path al .env del backend (default: /home/cadenza/cadenza/backend/.env
#                      con fallback a /opt/cadenza/app/backend/.env)
#   --nginx-dir PATH   Default: /etc/nginx/sites-available
#   --service NAME     Nome del servizio (auto-detect: pm2 cadenza-backend, systemd cadenza/aulabook)
#   --backend-port N   Default: 3000
#   --dry-run          Mostra cosa farebbe senza modificare nulla
#   --yes              Salta le conferme interattive (uso CI / esperti)
#   --help             Mostra questo aiuto
#
# FASI:
#   preflight  → DNS check, cert SSL, server block nginx per il NUOVO dominio
#                (vecchio dominio resta intatto e funzionante)
#   cutover    → backup + update .env, restart backend, healthcheck. Promemoria
#                per OAuth (UI admin) e Telegram (UI admin).
#   redirect   → riconfigura il VECCHIO dominio come 301 → nuovo, mantenendo
#                però attivi /api/bookings/ical e /check-in/room/* (token già
#                emessi: feed iCal nei calendari utenti, QR stampati in aula).
#   finalize   → (dopo ~90gg) rimuove il vecchio server block. Cleanup finale.
#
# Sicurezza:
#   - ogni step destructive richiede conferma "yes" esplicita (skip con --yes)
#   - backup prima di ogni modifica in ~/cadenza-migration-backups/<timestamp>/
#   - rollback manuale possibile copiando indietro i file di backup
# =============================================================================

set -euo pipefail

# ------------------------------------------------------------ Defaults & arg parse
OLD_DOMAIN=""
NEW_DOMAIN=""
PHASE=""
ENV_FILE=""
NGINX_DIR="/etc/nginx/sites-available"
NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"
SERVICE_NAME=""
BACKEND_PORT="3000"
DRY_RUN=0
ASSUME_YES=0

usage() { sed -n '2,46p' "$0" | sed 's/^# \?//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --old)          OLD_DOMAIN="$2"; shift 2 ;;
    --new)          NEW_DOMAIN="$2"; shift 2 ;;
    --phase)        PHASE="$2"; shift 2 ;;
    --env-file)     ENV_FILE="$2"; shift 2 ;;
    --nginx-dir)    NGINX_DIR="$2"; shift 2 ;;
    --service)      SERVICE_NAME="$2"; shift 2 ;;
    --backend-port) BACKEND_PORT="$2"; shift 2 ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --yes|-y)       ASSUME_YES=1; shift ;;
    --help|-h)      usage ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------ Output helpers
TTY_OK=0
[[ -t 1 ]] && TTY_OK=1
red()    { [[ $TTY_OK -eq 1 ]] && printf '\033[31m%s\033[0m\n' "$*" || echo "$*"; }
green()  { [[ $TTY_OK -eq 1 ]] && printf '\033[32m%s\033[0m\n' "$*" || echo "$*"; }
yellow() { [[ $TTY_OK -eq 1 ]] && printf '\033[33m%s\033[0m\n' "$*" || echo "$*"; }
blue()   { [[ $TTY_OK -eq 1 ]] && printf '\033[34m%s\033[0m\n' "$*" || echo "$*"; }
bold()   { [[ $TTY_OK -eq 1 ]] && printf '\033[1m%s\033[0m\n' "$*" || echo "$*"; }
dim()    { [[ $TTY_OK -eq 1 ]] && printf '\033[2m%s\033[0m\n' "$*" || echo "$*"; }

step()  { echo; bold "▶ $*"; }
ok()    { green "  ✓ $*"; }
warn()  { yellow "  ⚠ $*"; }
err()   { red "  ✗ $*"; }
info()  { blue "  ⓘ $*"; }
plan()  { dim "  → $*"; }

confirm() {
  local prompt="$1"
  if [[ $ASSUME_YES -eq 1 ]]; then
    echo "$prompt [y/N] (--yes attivo, prosegue)"
    return 0
  fi
  read -rp "  $prompt [y/N] " ans
  [[ "$ans" =~ ^[yYsS]$ ]]
}

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    plan "DRY-RUN: $*"
    return 0
  fi
  "$@"
}

run_eval() {
  if [[ $DRY_RUN -eq 1 ]]; then
    plan "DRY-RUN: $1"
    return 0
  fi
  eval "$1"
}

# Esegue $@ con sudo SOLO se non possiamo scrivere il file target.
# Permette di lanciare lo script come utente già privilegiato senza chiedere password.
maybe_sudo() {
  local target="$1"; shift
  if [[ -w "$target" ]] || [[ "$(stat -c '%u' "$target" 2>/dev/null || stat -f '%u' "$target" 2>/dev/null)" == "$(id -u)" ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

# Variante: esegue il comando con sudo se il PATH richiede privilegi.
need_sudo_for() {
  local target="$1"
  [[ -w "$target" ]] && return 1 || return 0
}

# ------------------------------------------------------------ Validations
[[ -n "$OLD_DOMAIN" && -n "$NEW_DOMAIN" ]] || { err "--old e --new sono obbligatori"; exit 2; }

if [[ "$OLD_DOMAIN" == "$NEW_DOMAIN" ]]; then
  err "Il dominio vecchio e nuovo coincidono"; exit 2;
fi

# Auto-detect ENV file
if [[ -z "$ENV_FILE" ]]; then
  for c in /home/cadenza/cadenza/backend/.env /opt/cadenza/app/backend/.env; do
    [[ -f "$c" ]] && ENV_FILE="$c" && break
  done
fi
if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  err ".env non trovato. Specifica con --env-file PATH"
  exit 2
fi

# Auto-detect service
detect_service() {
  if [[ -n "$SERVICE_NAME" ]]; then
    echo "$SERVICE_NAME"; return 0
  fi
  if command -v pm2 >/dev/null 2>&1 && sudo -u cadenza pm2 jlist 2>/dev/null | grep -q '"cadenza-backend"'; then
    echo "pm2:cadenza-backend"; return 0
  fi
  for s in cadenza aulabook; do
    if systemctl list-unit-files 2>/dev/null | grep -q "^${s}\.service"; then
      echo "systemd:$s"; return 0
    fi
  done
  echo ""
}

restart_backend() {
  local svc; svc="$(detect_service)"
  if [[ -z "$svc" ]]; then
    warn "Servizio non rilevato (né pm2 né systemd cadenza/aulabook). Riavvialo a mano."
    return 0
  fi
  case "$svc" in
    pm2:*)
      info "Restart via pm2: ${svc#pm2:}"
      run sudo -u cadenza pm2 restart "${svc#pm2:}" --update-env
      ;;
    systemd:*)
      info "Restart via systemd: ${svc#systemd:}"
      run sudo systemctl restart "${svc#systemd:}"
      ;;
  esac
}

# ------------------------------------------------------------ Backup setup
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${HOME}/cadenza-migration-backups/${TS}"
[[ "$DRY_RUN" -eq 0 ]] && mkdir -p "$BACKUP_DIR"

backup_file() {
  local src="$1"
  [[ -f "$src" ]] || return 0
  local dest="$BACKUP_DIR/$(basename "$src")"
  if [[ $DRY_RUN -eq 1 ]]; then
    plan "DRY-RUN: backup $src → $dest"
  else
    cp -p "$src" "$dest"
    ok "Backup salvato: $dest"
  fi
}

# ============================================================================
# PHASE 1 — preflight
# ============================================================================
phase_preflight() {
  step "Fase 1/4 — Preflight (DNS + SSL + nginx server block per ${NEW_DOMAIN})"

  # 1.1 DNS resolution
  echo
  bold "  1.1 — Risoluzione DNS"
  if command -v dig >/dev/null 2>&1; then
    local ip; ip="$(dig +short "$NEW_DOMAIN" | head -n1)"
    if [[ -z "$ip" ]]; then
      err "DNS NON ancora propagato per $NEW_DOMAIN."
      info "Aggiungi un record A/AAAA sul tuo provider DNS che punti all'IP del VPS."
      info "Verifica con: dig +short $NEW_DOMAIN"
      return 1
    fi
    ok "Risolto $NEW_DOMAIN → $ip"
  else
    warn "dig non disponibile, skip check DNS (apt install dnsutils)"
  fi

  # 1.2 Certbot SSL
  echo
  bold "  1.2 — Certificato Let's Encrypt"
  if [[ -d "/etc/letsencrypt/live/${NEW_DOMAIN}" ]]; then
    ok "Certificato già presente in /etc/letsencrypt/live/${NEW_DOMAIN}/"
  else
    info "Eseguo: sudo certbot --nginx -d ${NEW_DOMAIN} --redirect=false"
    if ! confirm "Procedo con l'emissione del certificato?"; then
      warn "Skipped certbot. Lo riprenderai da te con: sudo certbot --nginx -d ${NEW_DOMAIN}"
      return 1
    fi
    if ! command -v certbot >/dev/null 2>&1; then
      err "certbot non installato. Esegui: sudo apt install -y certbot python3-certbot-nginx"
      return 1
    fi
    run sudo certbot --nginx -d "$NEW_DOMAIN" --redirect --non-interactive --agree-tos --email "admin@${NEW_DOMAIN#*.}" || {
      err "certbot fallito. Controlla i log e riprova manualmente."
      return 1
    }
    ok "Certificato emesso"
  fi

  # 1.3 nginx server block per il nuovo dominio
  echo
  bold "  1.3 — Server block nginx per ${NEW_DOMAIN}"
  local NEW_CONF="${NGINX_DIR}/cadenza-${NEW_DOMAIN}.conf"
  if [[ -f "$NEW_CONF" ]]; then
    ok "Già presente: $NEW_CONF (skip)"
  else
    info "Creo $NEW_CONF"
    if [[ $DRY_RUN -eq 0 ]]; then
      sudo tee "$NEW_CONF" >/dev/null <<NGINX
# Cadenza · vhost per ${NEW_DOMAIN}
# Generato da scripts/migrate-domain.sh il ${TS}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${NEW_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${NEW_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${NEW_DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${NEW_DOMAIN};
    return 301 https://\$host\$request_uri;
}
NGINX
    else
      plan "DRY-RUN: scriverei $NEW_CONF (vhost cadenza standard, proxy_pass :${BACKEND_PORT})"
    fi
    ok "Scritto $NEW_CONF"
  fi

  # 1.4 Symlink in sites-enabled
  if [[ ! -L "${NGINX_ENABLED_DIR}/cadenza-${NEW_DOMAIN}.conf" ]]; then
    info "Attivo il vhost (symlink in sites-enabled)"
    run sudo ln -sf "$NEW_CONF" "${NGINX_ENABLED_DIR}/"
  else
    ok "Symlink già attivo"
  fi

  # 1.5 nginx -t + reload
  echo
  bold "  1.4 — Test e reload nginx"
  if run sudo nginx -t; then
    run sudo systemctl reload nginx
    ok "nginx ricaricato"
  else
    err "nginx -t fallito. NON ho ricaricato. Risolvi e ritenta."
    return 1
  fi

  # 1.6 Healthcheck del nuovo dominio
  echo
  bold "  1.5 — Healthcheck nuovo dominio"
  if [[ $DRY_RUN -eq 1 ]]; then
    plan "DRY-RUN: curl -s -f https://${NEW_DOMAIN}/api/health"
  else
    if curl -fsS --max-time 8 "https://${NEW_DOMAIN}/api/health" >/dev/null; then
      ok "https://${NEW_DOMAIN}/api/health risponde"
    else
      err "https://${NEW_DOMAIN}/api/health NON risponde."
      info "Possibili cause: backend down, FRONTEND_URL non ancora aggiornato (questo è normale a questo punto: fase cutover)."
    fi
  fi

  echo
  green "✓ Preflight completata. Il nuovo dominio è raggiungibile fianco a fianco con il vecchio."
  info "Prossima fase: --phase cutover (richiede prima di aggiornare i redirect URI OAuth nei provider)"
}

# ============================================================================
# PHASE 2 — cutover
# ============================================================================
phase_cutover() {
  step "Fase 2/4 — Cutover (.env update + restart backend)"

  echo
  bold "  Pre-condizioni"
  cat <<EOF
  Prima di procedere assicurati di aver:
    □ Aggiunto i nuovi redirect URI nei provider OAuth (Google Cloud Console + Microsoft Entra):
        https://${NEW_DOMAIN}/api/auth/google/callback
        https://${NEW_DOMAIN}/api/auth/microsoft/callback
      mantenendo anche quelli vecchi.
    □ Aggiornato i Callback URL nella UI admin di Cadenza
      (Impostazioni Server → Servizi → OAuth) ai nuovi URL.
EOF
  echo
  if ! confirm "Confermi che hai fatto entrambe le cose sopra?"; then
    warn "Cutover annullato. Esci dallo script (Ctrl+C) o rilancia quando sei pronto."
    return 1
  fi

  # 2.1 Backup .env
  echo
  bold "  2.1 — Backup .env"
  backup_file "$ENV_FILE"

  # 2.2 Update FRONTEND_URL e APP_URL
  echo
  bold "  2.2 — Aggiorno FRONTEND_URL e APP_URL nel .env"
  local before; before="$(grep -E '^(FRONTEND_URL|APP_URL)=' "$ENV_FILE" || true)"
  echo "  Stato attuale:"
  echo "$before" | sed 's/^/    /'

  if [[ $DRY_RUN -eq 0 ]]; then
    # awk → file temporaneo → sostituzione (sudo solo se non scrivibile dall'utente corrente).
    local tmp; tmp="$(mktemp)"
    awk -v old="$OLD_DOMAIN" -v new="$NEW_DOMAIN" '
      /^FRONTEND_URL=/ { sub(old, new); print; next }
      /^APP_URL=/      { sub(old, new); print; next }
      { print }
    ' "$ENV_FILE" > "$tmp"
    if need_sudo_for "$ENV_FILE"; then
      sudo cp "$tmp" "$ENV_FILE"
      sudo chmod 600 "$ENV_FILE" 2>/dev/null || true
    else
      cp "$tmp" "$ENV_FILE"
      chmod 600 "$ENV_FILE" 2>/dev/null || true
    fi
    rm -f "$tmp"
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    plan "DRY-RUN: avrei sostituito ${OLD_DOMAIN} → ${NEW_DOMAIN} in FRONTEND_URL e APP_URL (file non toccato)"
  else
    local after; after="$(grep -E '^(FRONTEND_URL|APP_URL)=' "$ENV_FILE" || true)"
    echo "  Nuovo stato:"
    echo "$after" | sed 's/^/    /'

    # Cerca la presenza del vecchio dominio come HOST (non come substring del nuovo).
    # Es. prenotazioneaule.it è substring di rota.prenotazioneaule.it: il regex
    # con escape dei punti + lookahead boundary evita il falso positivo.
    local old_re; old_re="$(printf '%s' "$OLD_DOMAIN" | sed 's/\./\\./g')"
    if echo "$after" | grep -qE "https?://${old_re}([/:?#]|$)"; then
      err "Il vecchio dominio è ancora presente in qualche URL. Controlla manualmente."
      return 1
    fi
    if ! echo "$after" | grep -q "$NEW_DOMAIN"; then
      err "Il nuovo dominio NON è stato sostituito. Stop."
      return 1
    fi
    ok "Variabili aggiornate"
  fi

  # 2.3 Restart backend
  echo
  bold "  2.3 — Riavvio backend"
  if confirm "Procedo con il restart del backend?"; then
    restart_backend
    ok "Restart inviato"
  else
    warn "Restart manuale richiesto. Senza, il backend continua con il VECCHIO dominio in env."
    return 1
  fi

  # 2.4 Healthcheck
  echo
  bold "  2.4 — Healthcheck nuovo dominio"
  local attempts=0 max_attempts=10
  while [[ $attempts -lt $max_attempts ]]; do
    if [[ $DRY_RUN -eq 1 ]]; then
      plan "DRY-RUN: curl -s -f https://${NEW_DOMAIN}/api/health"
      break
    fi
    if curl -fsS --max-time 5 "https://${NEW_DOMAIN}/api/health" >/dev/null 2>&1; then
      ok "Backend operativo su https://${NEW_DOMAIN}"
      break
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  if [[ $attempts -eq $max_attempts ]]; then
    err "Backend non risponde dopo 20 secondi. Controlla i log."
    return 1
  fi

  # 2.5 Promemoria post-cutover
  echo
  green "✓ Cutover completato."
  cat <<EOF

  PROSSIMI PASSI MANUALI (non automatizzabili):
    1. Apri https://${NEW_DOMAIN} in browser pulito → testa login email + Google + Microsoft.
    2. Verifica che le nuove email (es. password reset) puntino al nuovo dominio.
    3. Vai in Impostazioni Server → Servizi → Messaging → Telegram
       → click "Configura automaticamente" per ri-registrare il webhook sul nuovo URL.
    4. Annuncia agli utenti il cambio di dominio (UI Annunci, broadcast email).

  Quando hai verificato che tutto funziona, lancia:
      bash scripts/migrate-domain.sh --old ${OLD_DOMAIN} --new ${NEW_DOMAIN} --phase redirect
EOF
}

# ============================================================================
# PHASE 3 — redirect (vecchio dominio → 301 nuovo, eccetto iCal e check-in)
# ============================================================================
phase_redirect() {
  step "Fase 3/4 — Redirect (vecchio dominio ${OLD_DOMAIN} → 301 nuovo)"

  local OLD_CONFS=("${NGINX_DIR}/cadenza.conf" "${NGINX_DIR}/cadenza-${OLD_DOMAIN}.conf" "${NGINX_DIR}/aulabook.conf" "${NGINX_DIR}/default")
  local OLD_CONF=""
  for c in "${OLD_CONFS[@]}"; do
    if [[ -f "$c" ]] && grep -qE "server_name[[:space:]]+${OLD_DOMAIN}" "$c"; then
      OLD_CONF="$c"; break
    fi
  done

  if [[ -z "$OLD_CONF" ]]; then
    err "Non trovo il server block del vecchio dominio in ${NGINX_DIR}/."
    info "Controlla manualmente quale file contiene 'server_name ${OLD_DOMAIN}' e specificalo:"
    info "   sudo grep -l \"server_name ${OLD_DOMAIN}\" ${NGINX_DIR}/*"
    return 1
  fi

  ok "Trovato vecchio vhost: $OLD_CONF"

  # 3.1 Backup
  echo
  bold "  3.1 — Backup vecchio vhost"
  backup_file "$OLD_CONF"

  # 3.2 Riscrivi come redirect zone
  echo
  bold "  3.2 — Riscrittura come redirect zone (con passthrough iCal e QR)"
  echo "  Il nuovo file:"
  echo "    - serve direttamente /api/bookings/ical (sottoscrizioni iCal già emesse)"
  echo "    - serve direttamente /check-in/room/* (QR già stampati nelle aule)"
  echo "    - 301 permanente per TUTTO il resto → https://${NEW_DOMAIN}\$request_uri"
  echo

  if ! confirm "Procedo con la riscrittura?"; then
    warn "Skipped. Il vecchio dominio continua a servire la app come prima."
    return 1
  fi

  if [[ $DRY_RUN -eq 0 ]]; then
    sudo tee "$OLD_CONF" >/dev/null <<NGINX
# Cadenza · vhost di redirect per ${OLD_DOMAIN}
# Sostituito da scripts/migrate-domain.sh il ${TS}.
# Mantenuto attivo per ~90 gg per non rompere iCal/QR già emessi.

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${OLD_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${OLD_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${OLD_DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    # Sottoscrizioni iCal già attive nei calendari degli utenti.
    location /api/bookings/ical {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host ${NEW_DOMAIN};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # QR check-in già stampati nelle aule.
    location /check-in/room/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host ${NEW_DOMAIN};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Tutto il resto: 301 permanente al nuovo dominio.
    location / {
        return 301 https://${NEW_DOMAIN}\$request_uri;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${OLD_DOMAIN};
    return 301 https://${NEW_DOMAIN}\$request_uri;
}
NGINX
  else
    plan "DRY-RUN: scriverei la redirect zone in $OLD_CONF"
  fi
  ok "Scritto"

  # 3.3 Test + reload
  echo
  bold "  3.3 — Test e reload nginx"
  if run sudo nginx -t; then
    run sudo systemctl reload nginx
    ok "nginx ricaricato"
  else
    err "nginx -t fallito. RIPRISTINO il file vecchio dal backup."
    [[ $DRY_RUN -eq 0 ]] && sudo cp "$BACKUP_DIR/$(basename "$OLD_CONF")" "$OLD_CONF"
    return 1
  fi

  # 3.4 Sanity check redirect
  echo
  bold "  3.4 — Verifica redirect"
  if [[ $DRY_RUN -eq 1 ]]; then
    plan "DRY-RUN: curl -sI https://${OLD_DOMAIN}/dashboard"
  else
    local code loc
    code="$(curl -sIo /dev/null -w '%{http_code}' --max-time 5 "https://${OLD_DOMAIN}/dashboard" || echo 000)"
    loc="$(curl -sI --max-time 5 "https://${OLD_DOMAIN}/dashboard" | grep -i '^location:' | tr -d '\r' || true)"
    if [[ "$code" == "301" ]] && echo "$loc" | grep -q "$NEW_DOMAIN"; then
      ok "${OLD_DOMAIN}/dashboard → 301 ${loc#*: }"
    else
      warn "Redirect non confermato (HTTP $code · $loc). Controlla manualmente."
    fi
  fi

  echo
  green "✓ Redirect attivato."
  info "Lascia il vecchio vhost in piedi per ~90 giorni, poi: --phase finalize"
}

# ============================================================================
# PHASE 4 — finalize (cleanup, dopo ~90gg)
# ============================================================================
phase_finalize() {
  step "Fase 4/4 — Finalize (cleanup, dopo ~90 gg)"

  cat <<EOF
  Stai per:
    1. Disattivare il server block del vecchio dominio (${OLD_DOMAIN}).
    2. Le sottoscrizioni iCal e QR check-in ancora attive sul vecchio
       dominio smetteranno di funzionare (gli utenti dovranno
       riprendere il link aggiornato dal proprio profilo Cadenza).
    3. È irreversibile via questo script (ma c'è il backup).

  Prima di procedere considera di:
    □ Rigenerare i QR delle aule da Impostazioni Server → QR Codes → Rigenera tutti.
    □ Rimuovere i redirect URI vecchi da Google Cloud Console e Microsoft Entra.

EOF
  if ! confirm "Confermi di procedere con il cleanup?"; then
    info "Cleanup annullato."
    return 0
  fi

  # 4.1 Trova il vhost
  local OLD_CONFS=("${NGINX_DIR}/cadenza.conf" "${NGINX_DIR}/cadenza-${OLD_DOMAIN}.conf")
  local OLD_CONF=""
  for c in "${OLD_CONFS[@]}"; do
    if [[ -f "$c" ]] && grep -qE "server_name[[:space:]]+${OLD_DOMAIN}" "$c"; then
      OLD_CONF="$c"; break
    fi
  done

  if [[ -z "$OLD_CONF" ]]; then
    warn "Server block del vecchio dominio non trovato — già rimosso?"
    return 0
  fi

  # 4.2 Backup + disattiva
  echo
  bold "  4.1 — Backup e disattivazione"
  backup_file "$OLD_CONF"
  local link="${NGINX_ENABLED_DIR}/$(basename "$OLD_CONF")"
  if [[ -L "$link" ]]; then
    info "Rimuovo $link"
    run sudo rm "$link"
  fi
  ok "Vhost disattivato (file di config conservato in $OLD_CONF + backup)"

  # 4.3 Reload
  echo
  bold "  4.2 — Reload nginx"
  if run sudo nginx -t; then
    run sudo systemctl reload nginx
    ok "nginx ricaricato"
  else
    err "nginx -t fallito. Reverto."
    [[ $DRY_RUN -eq 0 ]] && sudo ln -sf "$OLD_CONF" "$link"
    return 1
  fi

  echo
  green "✓ Migrazione completata."
  info "Vecchio dominio non più servito. Backup di sicurezza in $BACKUP_DIR"
}

# ============================================================================
# Menu interattivo (se --phase non fornito)
# ============================================================================
show_menu() {
  cat <<EOF

Cadenza — Migrazione dominio
  Da: ${OLD_DOMAIN}
  A:  ${NEW_DOMAIN}

  ENV file rilevato:  ${ENV_FILE}
  Servizio:           $(detect_service)
  Backup dir:         ${BACKUP_DIR}
  Dry-run:            $([[ $DRY_RUN -eq 1 ]] && echo "ON" || echo "off")

Scegli la fase:
  1) preflight  — DNS check + cert SSL + nginx server block per il NUOVO dominio
  2) cutover    — backup .env, switch FRONTEND_URL, restart backend, healthcheck
  3) redirect   — vecchio dominio → 301, mantenendo iCal/QR attivi
  4) finalize   — (dopo ~90gg) cleanup vecchio vhost
  q) quit

EOF
  read -rp "Fase> " choice
  case "$choice" in
    1|preflight) phase_preflight ;;
    2|cutover)   phase_cutover ;;
    3|redirect)  phase_redirect ;;
    4|finalize)  phase_finalize ;;
    q|Q|quit)    exit 0 ;;
    *) err "Scelta non valida"; exit 2 ;;
  esac
}

# ============================================================================
# Main
# ============================================================================
echo
bold "Cadenza · Migrazione assistita dominio"
echo "  ${OLD_DOMAIN} → ${NEW_DOMAIN}"
[[ $DRY_RUN -eq 1 ]] && yellow "  ✱ DRY-RUN: nessuna modifica verrà applicata."
echo

case "$PHASE" in
  preflight) phase_preflight ;;
  cutover)   phase_cutover ;;
  redirect)  phase_redirect ;;
  finalize)  phase_finalize ;;
  "")        show_menu ;;
  *) err "Fase sconosciuta: $PHASE (usa preflight, cutover, redirect, finalize)"; exit 2 ;;
esac
