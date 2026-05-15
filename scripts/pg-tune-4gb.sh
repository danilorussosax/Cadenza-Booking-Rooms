#!/usr/bin/env bash
# =============================================================================
# pg-tune-4gb.sh  (v1.0)
#
# Applica un tuning Postgres idempotente calibrato per VPS:
#   4 vCPU · 4 GB RAM · disco SSD/NVMe · workload OLTP web (Cadenza)
#
# Cosa fa:
#   1. Rileva la major version di Postgres in uso e il path della config.
#   2. Snapshot dei valori correnti in /var/backups/postgresql/ (per audit/rollback).
#   3. Applica i parametri via `ALTER SYSTEM` (scrive su postgresql.auto.conf,
#      non tocca il file principale → rollback con --rollback o ALTER SYSTEM RESET).
#   4. Riavvia Postgres (param come shared_buffers/max_connections lo richiedono).
#   5. Riavvia il backend Cadenza (PM2) per ricreare il pool sulle nuove conn.
#   6. Stampa la verifica finale dei valori attivi.
#
# Idempotente: rilanciandolo applica gli stessi valori e li riconferma.
#
# Uso:
#   sudo bash scripts/pg-tune-4gb.sh                # applica + restart
#   sudo bash scripts/pg-tune-4gb.sh --dry-run      # mostra cosa farebbe
#   sudo bash scripts/pg-tune-4gb.sh --no-restart   # applica ma non restarta
#   sudo bash scripts/pg-tune-4gb.sh --rollback     # ALTER SYSTEM RESET dei param toccati
#   sudo bash scripts/pg-tune-4gb.sh --help
# =============================================================================

set -euo pipefail

DRY_RUN=0
NO_RESTART=0
ROLLBACK=0
PM2_APP="cadenza-backend"
BACKUP_DIR="/var/backups/postgresql"

# Parametri target del tuning. Un'unica fonte di verità: stessa lista usata per
# applicare, snapshot e rollback → niente drift fra le sezioni.
declare -a TUNED_PARAMS=(
  "shared_buffers=1GB"
  "effective_cache_size=2GB"
  "work_mem=8MB"
  "maintenance_work_mem=256MB"
  "wal_buffers=16MB"
  "max_connections=50"
  "random_page_cost=1.1"
  "effective_io_concurrency=200"
  "checkpoint_completion_target=0.9"
  "min_wal_size=1GB"
  "max_wal_size=4GB"
  "max_worker_processes=4"
  "max_parallel_workers=4"
  "max_parallel_workers_per_gather=2"
  "log_min_duration_statement=500"
)

# ---------- CLI ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)    DRY_RUN=1; shift ;;
    --no-restart) NO_RESTART=1; shift ;;
    --rollback)   ROLLBACK=1; shift ;;
    -h|--help)
      sed -n '2,/^# ===/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Argomento sconosciuto: $1" >&2
      exit 2
      ;;
  esac
done

# ---------- colori ----------
if [[ -t 1 ]]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_BOLD=$'\033[1m'; C_END=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_BOLD=""; C_END=""
fi
ok()   { printf "  %s✓%s %s\n" "$C_OK"   "$C_END" "$*"; }
warn() { printf "  %s⚠%s %s\n" "$C_WARN" "$C_END" "$*"; }
err()  { printf "  %s✗%s %s\n" "$C_ERR"  "$C_END" "$*" >&2; }
hdr()  { printf "\n%s== %s ==%s\n" "$C_BOLD" "$*" "$C_END"; }

# ---------- preflight ----------
hdr "1. Preflight"

if [[ $EUID -ne 0 ]]; then
  err "Questo script va lanciato come root (usa sudo)."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  err "psql non trovato. Postgres è installato su questa VPS?"
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  err "systemctl non trovato. Lo script assume Linux con systemd."
  exit 1
fi

# Major version e path config: chiediamoli a Postgres stesso, evita di
# hardcoddare "16" quando un domani la VPS sarà su 17/18.
PG_MAJOR="$(sudo -u postgres psql -tAc "SHOW server_version_num;" | awk '{printf "%d", $1/10000}')"
PG_CONF="$(sudo -u postgres psql -tAc "SHOW config_file;")"
PG_DATA="$(sudo -u postgres psql -tAc "SHOW data_directory;")"

ok "Postgres major version: $PG_MAJOR"
ok "Config file:            $PG_CONF"
ok "Data directory:         $PG_DATA"

if ! systemctl is-active --quiet postgresql; then
  err "Il servizio postgresql non è attivo (systemctl is-active = no)."
  exit 1
fi
ok "Servizio postgresql attivo"

# ---------- rollback path ----------
if [[ $ROLLBACK -eq 1 ]]; then
  hdr "Rollback: ALTER SYSTEM RESET sui parametri toccati"

  if [[ $DRY_RUN -eq 1 ]]; then
    for kv in "${TUNED_PARAMS[@]}"; do
      echo "  [dry-run] ALTER SYSTEM RESET ${kv%%=*};"
    done
    warn "Dry-run: nessuna modifica applicata."
    exit 0
  fi

  for kv in "${TUNED_PARAMS[@]}"; do
    sudo -u postgres psql -c "ALTER SYSTEM RESET ${kv%%=*};" >/dev/null
  done
  ok "Reset completato. Ora riavvio Postgres per applicare."
  systemctl restart postgresql
  ok "Postgres riavviato. Backend (PM2) → riavvio anche lui per rifare il pool."
  if command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -q "\"name\":\"$PM2_APP\""; then
    pm2 restart "$PM2_APP" --update-env >/dev/null
    ok "$PM2_APP riavviato"
  else
    warn "PM2 o app $PM2_APP non trovato — riavvialo a mano se necessario."
  fi
  exit 0
fi

# ---------- snapshot ----------
hdr "2. Snapshot valori correnti"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
SNAPSHOT_FILE="${BACKUP_DIR}/settings-before-${TS}.txt"

# Lista dei nomi dei parametri (chiave "=" valore → solo chiave)
PARAM_NAMES_SQL=$(printf "'%s'," "${TUNED_PARAMS[@]%%=*}" | sed "s/,$//")

sudo -u postgres psql -P pager=off <<SQL | tee "$SNAPSHOT_FILE" >/dev/null
SELECT name, setting, unit, source
FROM pg_settings
WHERE name IN ($PARAM_NAMES_SQL)
ORDER BY name;
SQL

ok "Snapshot scritto in $SNAPSHOT_FILE"

# Backup defensivo del postgresql.auto.conf (file generato da ALTER SYSTEM).
if [[ -f "${PG_DATA}/postgresql.auto.conf" ]]; then
  cp "${PG_DATA}/postgresql.auto.conf" "${BACKUP_DIR}/postgresql.auto.conf.bak-${TS}"
  ok "Backup di postgresql.auto.conf in ${BACKUP_DIR}/postgresql.auto.conf.bak-${TS}"
fi

# ---------- apply ----------
hdr "3. Applicazione tuning"

if [[ $DRY_RUN -eq 1 ]]; then
  for kv in "${TUNED_PARAMS[@]}"; do
    echo "  [dry-run] ALTER SYSTEM SET ${kv%%=*} = '${kv#*=}';"
  done
  warn "Dry-run: nessuna modifica applicata."
  exit 0
fi

for kv in "${TUNED_PARAMS[@]}"; do
  key="${kv%%=*}"
  val="${kv#*=}"
  sudo -u postgres psql -c "ALTER SYSTEM SET ${key} = '${val}';" >/dev/null
  ok "${key} = ${val}"
done

# ---------- restart ----------
hdr "4. Restart Postgres + backend"

if [[ $NO_RESTART -eq 1 ]]; then
  warn "--no-restart: NON ho riavviato Postgres. I parametri che richiedono"
  warn "  restart (shared_buffers, max_connections, max_worker_processes,"
  warn "  wal_buffers) resteranno pending finché non lanci:"
  warn "    sudo systemctl restart postgresql && pm2 restart $PM2_APP --update-env"
  exit 0
fi

systemctl restart postgresql

# Aspetto che Postgres torni up — più robusto di `sleep 3`.
for i in {1..20}; do
  if sudo -u postgres psql -tAc "SELECT 1;" >/dev/null 2>&1; then
    ok "Postgres rispondente dopo ${i}s"
    break
  fi
  sleep 1
  if [[ $i -eq 20 ]]; then
    err "Postgres non risponde dopo 20s. Controlla: journalctl -u postgresql -n 50"
    exit 1
  fi
done

if command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -q "\"name\":\"$PM2_APP\""; then
  pm2 restart "$PM2_APP" --update-env >/dev/null
  ok "$PM2_APP riavviato"
else
  warn "PM2 o app '$PM2_APP' non trovato — riavvialo a mano se serve."
fi

# ---------- verify ----------
hdr "5. Verifica valori attivi"

sudo -u postgres psql -P pager=off <<SQL
SELECT name, setting, unit, pending_restart
FROM pg_settings
WHERE name IN ($PARAM_NAMES_SQL)
ORDER BY name;
SQL

PENDING="$(sudo -u postgres psql -tAc "SELECT count(*) FROM pg_settings WHERE pending_restart;" | tr -d '[:space:]')"
if [[ "$PENDING" != "0" ]]; then
  warn "Ci sono $PENDING parametri con pending_restart=t. Restart non riuscito?"
  warn "  Controlla: journalctl -u postgresql -n 50"
else
  ok "Nessun parametro pending — tuning attivo."
fi

hdr "Fatto"
echo "  Snapshot pre-tuning:  $SNAPSHOT_FILE"
echo "  Per rollback:         sudo bash $0 --rollback"
