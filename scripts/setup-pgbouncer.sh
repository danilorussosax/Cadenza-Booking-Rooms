#!/usr/bin/env bash
# =============================================================================
# setup-pgbouncer.sh  (v1.0)
#
# Installa e configura PgBouncer in transaction pooling davanti a Postgres.
# Riduce il numero di connessioni fisiche a Postgres quando l'app gira in
# PM2 cluster mode (N istanze × 20 connessioni pool Sequelize → PgBouncer
# le multiplexa su ~20 connessioni reali).
#
# Modalità:
#   transaction pooling — la connessione server viene rilasciata alla pool
#   al termine di ogni transazione. Compatibile con Sequelize, FOR UPDATE
#   SKIP LOCKED e SERIALIZABLE (isolation level viene passato a inizio tx).
#
# Prerequisito: lo script pg-tune-4gb.sh DEVE essere già stato eseguito
# (max_connections=50 in postgresql.auto.conf). PgBouncer rispetta questo
# limite come hard cap per le connessioni verso Postgres.
#
# Uso:
#   sudo bash scripts/setup-pgbouncer.sh                     # installa + avvia
#   sudo bash scripts/setup-pgbouncer.sh --dry-run           # mostra cosa farebbe
#   sudo bash scripts/setup-pgbouncer.sh --no-restart        # installa senza riavviare
#   sudo bash scripts/setup-pgbouncer.sh --rollback          # rimuovi config e stop
#   sudo bash scripts/setup-pgbouncer.sh --help
# =============================================================================

set -euo pipefail

DRY_RUN=0
NO_RESTART=0
ROLLBACK=0
PM2_APP="cadenza-backend"

# PgBouncer config
PGB_CONFIG="/etc/pgbouncer/pgbouncer.ini"
PGB_USERLIST="/etc/pgbouncer/userlist.txt"
PGB_LOG="/var/log/pgbouncer/pgbouncer.log"

# Parametri calcolati automaticamente
DB_NAME=""
DB_USER=""

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

if ! systemctl is-active --quiet postgresql; then
  err "Il servizio postgresql non è attivo."
  exit 1
fi
ok "Postgres attivo"

# Rileva nome DB e utente dal .env di Cadenza
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${REPO_ROOT}/backend/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  err "File .env non trovato: $ENV_FILE"
  err "Crea un .env con DB_NAME e DB_USER prima di lanciare lo script."
  exit 1
fi

DB_NAME="$(grep -E '^DB_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_USER="$(grep -E '^DB_USER=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
APP_POOL_MAX="$(grep -E '^DB_POOL_MAX=' "$ENV_FILE" | head -1 | cut -d= -f2-)"

# Default di fallback
DB_NAME="${DB_NAME:-cadenza}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"
APP_POOL_MAX="${APP_POOL_MAX:-20}"

ok "Database: $DB_NAME"
ok "Utente:   $DB_USER"
ok "Pool app: $APP_POOL_MAX (sequelize pool.max)"

# Calcola default_pool_size: allinea con il pool dell'app,
# con un minimo di 10 per gestire i burst.
DEFAULT_POOL_SIZE=$((APP_POOL_MAX + 5))
if [[ $DEFAULT_POOL_SIZE -lt 10 ]]; then
  DEFAULT_POOL_SIZE=10
fi

# ---------- rollback ----------
if [[ $ROLLBACK -eq 1 ]]; then
  hdr "Rollback: rimozione PgBouncer"

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  [dry-run] systemctl stop pgbouncer"
    echo "  [dry-run] systemctl disable pgbouncer"
    echo "  [dry-run] rimozione $PGB_CONFIG e $PGB_USERLIST"
    echo "  [dry-run] ripristino DB_PORT=5432 in $ENV_FILE"
    warn "Dry-run: nessuna modifica applicata."
    exit 0
  fi

  if systemctl is-active --quiet pgbouncer 2>/dev/null; then
    systemctl stop pgbouncer
    ok "PgBouncer fermato"
  fi

  if systemctl is-enabled --quiet pgbouncer 2>/dev/null; then
    systemctl disable pgbouncer
    ok "PgBouncer disabilitato da systemd"
  fi

  # Ripristina DB_PORT a 5432 nel .env
  if grep -qE '^DB_PORT=6432' "$ENV_FILE" 2>/dev/null; then
    sed -i.bak-pgbouncer-rollback 's/^DB_PORT=6432/DB_PORT=5432/' "$ENV_FILE"
    ok "DB_PORT riportato a 5432 in $ENV_FILE"
    rm -f "${ENV_FILE}.bak-pgbouncer-rollback"
  fi

  # Rimuovi commento # PgBouncer
  if grep -qE '^# PgBouncer' "$ENV_FILE" 2>/dev/null; then
    grep -v '^# PgBouncer\|^#DB_PGBOUNCER=\|^DB_PGBOUNCER=' "$ENV_FILE" > "${ENV_FILE}.clean" \
      && mv "${ENV_FILE}.clean" "$ENV_FILE"
    ok "Rimosse annotazioni PgBouncer da $ENV_FILE"
  fi

  # Riavvia PM2 se attivo
  if command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -q "\"name\":\"$PM2_APP\""; then
    pm2 restart "$PM2_APP" --update-env >/dev/null
    ok "$PM2_APP riavviato"
  else
    warn "PM2 o app '$PM2_APP' non trovato — riavvialo a mano."
  fi

  warn "PgBouncer rimosso. Postgres resta raggiungibile su porta 5432."
  exit 0
fi

# ---------- verifica prerequisito pg-tune ----------
PG_CONF="$(sudo -u postgres psql -tAc "SHOW config_file;")"
PG_AUTO_CONF="$(dirname "$PG_CONF")/postgresql.auto.conf"

# Verifica che max_connections sia stato tunato (almeno 40)
MAX_CONN="$(sudo -u postgres psql -tAc "SHOW max_connections;" | tr -d '[:space:]')"
if [[ -z "$MAX_CONN" || "$MAX_CONN" -lt 40 ]]; then
  warn "max_connections=$MAX_CONN (< 40). Il pg-tune-4gb.sh imposta max_connections=50."
  warn "Senza pg-tune, il PgBouncer config potrebbe saturare Postgres."
  warn "Esegui:  sudo bash scripts/pg-tune-4gb.sh"
  echo ""
fi
ok "max_connections = $MAX_CONN"

# ---------- installa PgBouncer ----------
hdr "2. Installazione PgBouncer"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "  [dry-run] apt-get install -y pgbouncer"
else
  if ! command -v pgbouncer >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y pgbouncer
    ok "PgBouncer installato"
  else
    ok "PgBouncer già installato ($(pgbouncer --version 2>&1 | head -1))"
  fi
fi

# ---------- userlist ----------
hdr "3. Userlist ($PGB_USERLIST)"

# PgBouncer userlist: coppia "user password" in formato auth_file.
# La password può essere in chiaro (dev/VPS fidato) o md5 (produzione).
# NOTA: il formato è "nome_utente" "password" (con virgolette e spazio).
#
# Scrittura via tempfile + mv per evitare il bug bash "heredoc dentro $()"
# (apostrofi e quote shell rompono il parser quando l'heredoc è collettato
# in una variabile via command substitution).
PGB_USERLIST_TMP="$(mktemp)"
cat > "$PGB_USERLIST_TMP" <<EOUSERLIST
"$DB_USER" "$DB_PASSWORD"
EOUSERLIST

if [[ $DRY_RUN -eq 1 ]]; then
  echo "  [dry-run] Scriverei in $PGB_USERLIST:"
  sed 's/"[^"]*"$/***/' "$PGB_USERLIST_TMP"
  rm -f "$PGB_USERLIST_TMP"
else
  mv "$PGB_USERLIST_TMP" "$PGB_USERLIST"
  chmod 600 "$PGB_USERLIST"
  ok "Userlist scritta (permessi 600)"
fi

# ---------- configurazione pgbouncer.ini ----------
hdr "4. Configurazione ($PGB_CONFIG)"

# Legge il Postgres server port (default 5432)
PG_PORT="$(sudo -u postgres psql -tAc "SHOW port;" | tr -d '[:space:]')"
PG_PORT="${PG_PORT:-5432}"

# Calcola statement_timeout e idle_in_transaction_session_timeout dal .env
# per configurarli anche lato PgBouncer come fallback
STMT_TIMEOUT="$(grep -E '^DB_STATEMENT_TIMEOUT_MS=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
IDLE_TX_TIMEOUT="$(grep -E '^DB_IDLE_IN_TX_TIMEOUT_MS=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
STMT_TIMEOUT_STRING="${STMT_TIMEOUT:-30000}"
IDLE_TX_STRING="${IDLE_TX_TIMEOUT:-60000}"

# Scrittura via tempfile + mv (no command substitution) per evitare il bug
# noto di bash: gli apostrofi nei commenti italiani ("l'applicazione",
# "dell'app", ecc.) confondono il parser quando un heredoc è raccolto in
# `$(cat <<EOC ... EOC)`. Con redirect diretto su file il problema non si
# manifesta.
PGB_CONFIG_TMP="$(mktemp)"
cat > "$PGB_CONFIG_TMP" <<EOCONFIG
;; ===================================================================
;; PgBouncer — transaction pooling per Cadenza
;; Generato da scripts/setup-pgbouncer.sh
;; ===================================================================
[pgbouncer]

;; Modalita transaction pooling: la connessione Postgres torna alla pool
;; al termine di ogni transazione (COMMIT/ROLLBACK). Compatibile con:
;;   - Sequelize pool (prepared_statements deve essere disattivato)
;;   - FOR UPDATE SKIP LOCKED (mailOutboxScheduler)
;;   - SERIALIZABLE isolation (serializableTx.js)
pool_mode = transaction

;; Porta in ascolto per le app. Default PgBouncer: 6432.
listen_addr = 127.0.0.1
listen_port = 6432

;; Autenticazione: PgBouncer usa userlist.txt per confrontare le credenziali
;; con l utente Postgres. auth_type=plain va bene perche PgBouncer e in
;; ascolto solo su localhost (127.0.0.1) - nessun rischio di rete.
auth_type = plain
auth_file = /etc/pgbouncer/userlist.txt

;; Limiti di connessione
;;
;;   max_client_conn: connessioni massime DALLE app (Sequelize pool x N istanze PM2).
;;     200 e ampio: 4 istanze x pool 20 = 80, + margine per pg_dump/psql cron.
;;   default_pool_size: connessioni PgBouncer -> Postgres mantenute aperte.
;;     Allineato a sequelize pool.max + 5 per i burst (query di bootstrap,
;;     restore, manutenzione).
;;   reserve_pool_size: connessioni extra se tutte le default_pool_size sono occupate.
;;   reserve_pool_timeout: secondi prima di usare la reserve pool.
max_client_conn = 200
default_pool_size = ${DEFAULT_POOL_SIZE}
reserve_pool_size = 5
reserve_pool_timeout = 3

;; Timeout
;;
;;   server_idle_timeout: dopo quanto una connessione idle verso Postgres viene chiusa.
;;     600s (10 min) e il default PgBouncer, va bene per web app.
;;   client_idle_timeout: dopo quanto una connessione client idle viene chiusa.
;;     Il pool Sequelize le gestisce con idle timeout, qui solo safety net.
;;   query_wait_timeout: max attesa per una connessione server libera.
server_idle_timeout = 600
client_idle_timeout = 3600
query_wait_timeout = 120

;; Startup parameters ignorati: extra_float_digits viene inviato dal driver
;; pg ma non serve passarlo a Postgres. Non ignorare statement_timeout e
;; idle_in_transaction_session_timeout - li vogliamo applicare.
ignore_startup_parameters = extra_float_digits

;; DISCARD ALL al termine di ogni transazione: pulisce SET LOCAL, pg_temp,
;; prepared statement, listen/notify ecc. Garantisce che le connessioni
;; tornino pulite alla pool senza stato residuo.
;; NOTA: in pool_mode=transaction PgBouncer ignora server_reset_query;
;; lo lasciamo come safety net in caso di passaggio futuro a session pooling.
server_reset_query = DISCARD ALL

;; Logging: a file + syslog per compatibilita con gli script di
;; monitoraggio esistenti (journalctl, fail2ban, ecc.).
logfile = /var/log/pgbouncer/pgbouncer.log
pidfile = /var/run/pgbouncer/pgbouncer.pid
admin_users = postgres
stats_period = 60

;; ===================================================================
;; Sezione database: mappa il database verso Postgres.
;;
;;   host/port: il server Postgres reale (default 5432).
;;   dbname:    nome del database (letto dal .env).
;;   pool_size: overridable per-database (default: usa default_pool_size).
;;   connect_query: eseguita ad ogni connessione server (manteniamo vuoto
;;     perche server_reset_query=DISCARD ALL gestisce gia la pulizia).
;; ===================================================================
[databases]
${DB_NAME} = host=127.0.0.1 port=${PG_PORT} dbname=${DB_NAME}
EOCONFIG

if [[ $DRY_RUN -eq 1 ]]; then
  echo "  [dry-run] Scriverei in $PGB_CONFIG:"
  grep -v '^;;' "$PGB_CONFIG_TMP"
  rm -f "$PGB_CONFIG_TMP"
  warn "Dry-run: nessuna modifica applicata."
  exit 0
fi

mv "$PGB_CONFIG_TMP" "$PGB_CONFIG"
chmod 640 "$PGB_CONFIG"
ok "Configurazione scritta in $PGB_CONFIG"

# ---------- log directory ----------
if [[ ! -d "$(dirname "$PGB_LOG")" ]]; then
  mkdir -p "$(dirname "$PGB_LOG")"
  chown postgres:postgres "$(dirname "$PGB_LOG")"
fi

# ---------- pg_hba per accesso locale (se non già presente) ----------
hdr "5. Accesso Postgres (pg_hba.conf)"

PG_HBA="$(sudo -u postgres psql -tAc "SHOW hba_file;")"
if [[ -z "$PG_HBA" ]]; then
  PG_HBA="$(dirname "$PG_CONF")/pg_hba.conf"
fi

if [[ -f "$PG_HBA" ]]; then
  # Assicura che l'accesso locale via IPv4 (127.0.0.1) sia consentito
  # con metodo trust o md5/scram per il nostro utente.
  if ! grep -qE "^host\s+all\s+all\s+127\.0\.0\.1/32\s+(trust|md5|scram-sha-256)" "$PG_HBA"; then
    if [[ $DRY_RUN -eq 0 ]]; then
      echo "# PgBouncer — accesso locale Cadenza" >> "$PG_HBA"
      echo "host    all             all             127.0.0.1/32            md5" >> "$PG_HBA"
      ok "Aggiunta riga pg_hba: host all all 127.0.0.1/32 md5"
    fi
  else
    ok "pg_hba già configurato per 127.0.0.1/32"
  fi
else
  warn "pg_hba.conf non trovato ($PG_HBA). Assicurati che Postgres accetti connessioni locali."
fi

# ---------- avvia PgBouncer ----------
hdr "6. Avvio PgBouncer"

if [[ $NO_RESTART -eq 1 ]]; then
  warn "--no-restart: PgBouncer NON avviato. Per avviarlo:"
  warn "  systemctl start pgbouncer && systemctl enable pgbouncer"
  exit 0
fi

# Ricarica systemd, avvia e abilita
systemctl daemon-reload
if systemctl is-active --quiet pgbouncer 2>/dev/null; then
  systemctl restart pgbouncer
  ok "PgBouncer riavviato"
else
  systemctl start pgbouncer
  ok "PgBouncer avviato"
fi

if ! systemctl is-enabled --quiet pgbouncer 2>/dev/null; then
  systemctl enable pgbouncer
  ok "PgBouncer abilitato all'avvio (systemd)"
fi

# Attendi che PgBouncer sia pronto
sleep 1
if ! pg_isready -h 127.0.0.1 -p 6432 -d "$DB_NAME" -U "$DB_USER" >/dev/null 2>&1; then
  warn "PgBouncer non risponde sulla porta 6432. Controlla:"
  warn "  systemctl status pgbouncer"
  warn "  tail -50 $PGB_LOG"
else
  ok "PgBouncer risponde su 127.0.0.1:6432"
fi

# ---------- aggiorna .env per puntare a PgBouncer ----------
hdr "7. Aggiornamento .env backend"

if [[ $DRY_RUN -eq 0 ]]; then
  # Backuppa il .env originale
  cp "$ENV_FILE" "${ENV_FILE}.bak-pgbouncer"

  # Aggiorna DB_PORT a 6432 (PgBouncer) — solo se è 5432
  if grep -qE '^DB_PORT=5432' "$ENV_FILE"; then
    sed -i'' 's/^DB_PORT=5432/DB_PORT=6432/' "$ENV_FILE"
    ok "DB_PORT=5432 → 6432 in $ENV_FILE"
  fi

  # Aggiungi flag PgBouncer se non presente
  if ! grep -qE '^# PgBouncer' "$ENV_FILE" 2>/dev/null; then
    cat >> "$ENV_FILE" <<'EOENV'

# ===================================
# PgBouncer — transaction pooling
# Quando attivo, il backend si connette a PgBouncer (porta 6432) invece
# che direttamente a Postgres (5432). PgBouncer multiplexa N connessioni
# applicative su ~20 connessioni reali a Postgres.
# ===================================
# Imposta DB_PORT=6432 per attivare (lo script setup-pgbouncer.sh lo fa automaticamente).
#DB_PGBOUNCER=true                   # flag esplicito (opzionale se DB_PORT=6432)
EOENV
    ok "Annotazione PgBouncer aggiunta in fondo a $ENV_FILE"
  fi
fi

# ---------- verifica finale ----------
hdr "8. Verifica connessione"

if pg_isready -h 127.0.0.1 -p 6432 -d "$DB_NAME" -U "$DB_USER" >/dev/null 2>&1; then
  ok "PgBouncer operativo — l'app può connettersi su 127.0.0.1:6432"
else
  warn "Verifica connessione fallita. Controlla:"
  warn "  systemctl status pgbouncer"
  warn "  tail -50 $PGB_LOG"
  warn "  pg_isready -h 127.0.0.1 -p 6432 -d $DB_NAME -U $DB_USER"
fi

# ---------- riavvia PM2 ----------
if command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -q "\"name\":\"$PM2_APP\""; then
  echo ""
  warn "PgBouncer è attivo. Riavvia il backend per usare la nuova porta:"
  warn "  pm2 restart $PM2_APP --update-env"
  echo ""
  # Riavvio automatico se non in dry-run e non in no-restart
  if [[ $DRY_RUN -eq 0 && $NO_RESTART -eq 0 ]]; then
    pm2 restart "$PM2_APP" --update-env >/dev/null
    ok "$PM2_APP riavviato (ora punta a PgBouncer :6432)"
  fi
fi

hdr "Fatto"
echo ""
echo "  Riepilogo configurazione:"
echo "    Pool mode:      transaction"
echo "    App → PgBouncer: 127.0.0.1:6432 (max_client_conn=200)"
echo "    PgBouncer → PG:  127.0.0.1:${PG_PORT} (default_pool_size=${DEFAULT_POOL_SIZE})"
echo "    Postgres MAX:   ${MAX_CONN} connessioni"
echo ""
echo "  Config file:    $PGB_CONFIG"
echo "  Userlist:       $PGB_USERLIST"
echo "  Log:            $PGB_LOG"
echo "  Backup .env:    ${ENV_FILE}.bak-pgbouncer"
echo ""
echo "  Per rollback:   sudo bash $0 --rollback"
