#!/usr/bin/env bash
#
# setup-wal-archiving.sh — abilita WAL archiving su Postgres per PITR
# (point-in-time recovery), permettendo restore a qualsiasi secondo degli
# ultimi N giorni invece dei soli timestamp dei backup full.
#
# Cosa fa:
#   1. Crea la directory di archive (default /var/lib/postgresql/wal-archive)
#   2. Imposta tramite ALTER SYSTEM:
#        wal_level = replica         (default su PG 13+, idempotente)
#        archive_mode = on
#        archive_command = 'rclone copyto %p <remote>:<folder>/%f --quiet'
#        archive_timeout = 60s       (flush WAL anche su traffico basso)
#   3. Reload Postgres
#
# Per il restore PITR:
#   - Procedura "manuale-guidata" (raccomandata): vedi docs/PITR_RESTORE.md
#   - Tool: pgBackRest, Barman, oppure il classico
#       a) restore di un backup full come base
#       b) ripristino dei WAL fino al timestamp desiderato via recovery.conf
#          (PG 12+: postgresql.conf con restore_command + recovery_target_time)
#
# Prerequisiti:
#   - Postgres 13+ (su VPS Cadenza Hetzner: 17 da pg-tune-4gb.sh)
#   - rclone configurato per l'utente postgres (NON cadenza) — perché
#     l'archive_command gira come postgres
#       sudo -u postgres rclone config
#   - Privilegi superuser su Postgres
#
# Uso:
#   sudo bash scripts/setup-wal-archiving.sh <remote-name> [<remote-folder>]
#
# Esempio:
#   sudo bash scripts/setup-wal-archiving.sh cadenza-cloud Cadenza/wal
#
# Variabili:
#   ARCHIVE_DIR=/var/lib/postgresql/wal-archive  # buffer locale temporaneo
#   PG_USER=postgres
#   ARCHIVE_TIMEOUT_SEC=60

set -euo pipefail

REMOTE_NAME="${1:-}"
REMOTE_FOLDER="${2:-Cadenza/wal}"
ARCHIVE_DIR="${ARCHIVE_DIR:-/var/lib/postgresql/wal-archive}"
PG_USER="${PG_USER:-postgres}"
ARCHIVE_TIMEOUT_SEC="${ARCHIVE_TIMEOUT_SEC:-60}"

if [[ -z "$REMOTE_NAME" ]]; then
  echo "Uso: sudo bash $0 <remote-name> [<remote-folder>]"
  echo "Esempio: sudo bash $0 cadenza-cloud Cadenza/wal"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "✗ Servono privilegi root (usa sudo)."
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "✗ rclone non installato."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "✗ psql non in PATH."
  exit 1
fi

# Verifica rclone configurato per postgres (NON per cadenza — l'archive_command
# gira sotto l'utente postgres del sistema operativo).
if ! sudo -u "$PG_USER" rclone listremotes 2>/dev/null | grep -q "^${REMOTE_NAME}:$"; then
  echo "✗ Remote '${REMOTE_NAME}' non configurato per l'utente '$PG_USER'."
  echo "  Configura:"
  echo "      sudo -u $PG_USER rclone config"
  echo "  (Nota: questa e' una config separata da quella di cadenza-cloud per l'utente cadenza)"
  exit 1
fi

# Crea directory di archive locale (buffer temporaneo prima del push remoto).
# Anche se archive_command pusha direttamente al remote, rclone usa
# temporanei in /tmp e i WAL pendenti restano in pg_wal/ → utile avere
# uno staging come fallback se il remote e' irraggiungibile.
if [[ ! -d "$ARCHIVE_DIR" ]]; then
  mkdir -p "$ARCHIVE_DIR"
  chown "$PG_USER":"$PG_USER" "$ARCHIVE_DIR"
  chmod 700 "$ARCHIVE_DIR"
  echo "✓ Archive dir creata: $ARCHIVE_DIR (owner $PG_USER, mode 700)"
fi

RCLONE_BIN="$(command -v rclone)"

# archive_command: pusha %p (path del WAL) come %f (filename) nel remote.
# IMPORTANTE: deve ritornare 0 SOLO se l'upload e' avvenuto. Se rclone
# fallisce, Postgres ritenta il WAL al prossimo check (~archive_timeout).
ARCHIVE_CMD="${RCLONE_BIN} copyto %p ${REMOTE_NAME}:${REMOTE_FOLDER}/%f --quiet --timeout 30s"

echo "→ Applico ALTER SYSTEM (richiede superuser Postgres)..."
sudo -u "$PG_USER" psql -d postgres <<SQL
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET archive_mode = 'on';
ALTER SYSTEM SET archive_command = '${ARCHIVE_CMD}';
ALTER SYSTEM SET archive_timeout = '${ARCHIVE_TIMEOUT_SEC}';
SELECT pg_reload_conf();
SQL

echo "✓ archive_mode + archive_command configurati"
echo ""
echo "─────────────────────────────────────────────────────"
echo "RIAVVIO Postgres richiesto per attivare archive_mode (wal_level e'"
echo "gia' 'replica' su PG 13+, ma archive_mode richiede restart):"
echo ""
echo "    sudo systemctl restart postgresql"
echo ""
echo "Dopo il restart verifica con:"
echo "    sudo -u $PG_USER psql -c \"SHOW archive_mode;\""
echo "    sudo -u $PG_USER psql -c \"SELECT * FROM pg_stat_archiver;\""
echo ""
echo "Se 'failed_count' > 0 nel pg_stat_archiver, controlla i log:"
echo "    sudo tail -f /var/log/postgresql/*.log"
echo ""
echo "Disattivare:"
echo "    sudo -u $PG_USER psql -c \"ALTER SYSTEM SET archive_mode = 'off'; SELECT pg_reload_conf();\""
echo "    sudo systemctl restart postgresql"
echo "─────────────────────────────────────────────────────"
