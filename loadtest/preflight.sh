#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Pre/post-flight per la finestra di load test.
#
# Cosa fa:
#   on   →  alza RATE_LIMIT_API_PER_MIN a 200000 nel backend/.env del VPS,
#           pm2 restart, healthcheck. Salva backup del .env originale.
#   off  →  ripristina .env originale, pm2 restart, healthcheck.
#
# Uso:
#   ./loadtest/preflight.sh on    # PRIMA di lanciare k6
#   ./loadtest/preflight.sh off   # DOPO i test
#
# Idempotente: se chiamato due volte di seguito non rompe nulla.
# =============================================================================

VPS_USER="cadenza"
VPS_HOST="82.165.110.193"
VPS_PATH="/home/cadenza/cadenza"
SSH_TARGET="${VPS_USER}@${VPS_HOST}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new"
ENV_PATH="${VPS_PATH}/backend/.env"
BACKUP_TAG="${ENV_PATH}.preloadtest"

action="${1:-}"
case "$action" in
  on|off) ;;
  *) echo "Uso: $0 on|off"; exit 2 ;;
esac

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
blue()   { printf '\033[34m%s\033[0m\n' "$*"; }

healthcheck() {
  local code
  code=$(ssh ${SSH_OPTS} "$SSH_TARGET" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")
  if [[ "$code" =~ ^(200|301|302|404)$ ]]; then
    green "    ✓ backend risponde (HTTP $code)"
  else
    red "    ✗ backend non risponde (HTTP $code)"
    exit 1
  fi
}

if [[ "$action" == "on" ]]; then
  blue "[preflight ON] Salvataggio .env originale + override rate limit…"
  ssh ${SSH_OPTS} "$SSH_TARGET" "
    set -e
    if [ ! -f '${BACKUP_TAG}' ]; then
      cp -p '${ENV_PATH}' '${BACKUP_TAG}'
      echo '    backup creato: ${BACKUP_TAG}'
    else
      echo '    backup già presente: ${BACKUP_TAG} (idempotente)'
    fi
    # Rimuovi eventuali precedenti override e aggiungi il nuovo in coda.
    sed -i '/^RATE_LIMIT_API_PER_MIN=/d' '${ENV_PATH}'
    echo 'RATE_LIMIT_API_PER_MIN=200000' >> '${ENV_PATH}'
    echo '    RATE_LIMIT_API_PER_MIN=200000 impostato'
  "
  blue "[preflight ON] pm2 restart con --update-env…"
  ssh ${SSH_OPTS} "$SSH_TARGET" "pm2 restart cadenza-backend --update-env >/dev/null"
  sleep 3
  healthcheck
  green "Pronto al load test. Ricorda 'preflight.sh off' a fine sessione!"
fi

if [[ "$action" == "off" ]]; then
  blue "[preflight OFF] Ripristino .env originale…"
  ssh ${SSH_OPTS} "$SSH_TARGET" "
    set -e
    if [ -f '${BACKUP_TAG}' ]; then
      mv '${BACKUP_TAG}' '${ENV_PATH}'
      echo '    .env ripristinato dal backup'
    else
      # Niente backup: rimuovi solo l'override se presente.
      sed -i '/^RATE_LIMIT_API_PER_MIN=/d' '${ENV_PATH}'
      echo '    backup mancante, rimosso solo l\\'override RATE_LIMIT_API_PER_MIN'
    fi
  "
  blue "[preflight OFF] pm2 restart con --update-env…"
  ssh ${SSH_OPTS} "$SSH_TARGET" "pm2 restart cadenza-backend --update-env >/dev/null"
  sleep 3
  healthcheck
  green "Rate limit tornato al default. Done."
fi
