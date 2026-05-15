#!/usr/bin/env bash
#
# setup-rclone-backups.sh — installa il cron che sincronizza la cartella
# dei backup Postgres verso un remote rclone (OneDrive/Dropbox/iCloud/S3/…).
#
# Coppia naturale con setup-rclone-sync.sh: stesso pattern, ma orientato
# ai backup tar.gz invece che al file Excel.
#
# Prerequisito (manuale, una volta sola):
#   1) Installa rclone:   curl https://rclone.org/install.sh | sudo bash
#   2) Configura il remote SOTTO l'utente che fa girare il backend:
#        sudo -u cadenza rclone config
#      (Per OneDrive Business: scegli "Microsoft OneDrive" → Business)
#      Annotati il NOME del remote (es. "cadenza-cloud").
#
# Uso:
#   sudo bash scripts/setup-rclone-backups.sh <remote-name> [<remote-folder>]
#
# Esempio:
#   sudo bash scripts/setup-rclone-backups.sh cadenza-cloud Cadenza/backups
#
# Variabili opzionali:
#   BACKUP_DIR=/home/cadenza/backups   # cartella locale dei tar.gz
#   OWNER=cadenza                      # user/group che possiede la cartella
#   CRON_HOUR=4                        # ora locale del sync (default 04:00,
#                                      # 30 min dopo verify weekly delle 03:30)
#   MAX_AGE_DAYS=90                    # retention off-site (default 90gg)
#
# Schedule: SYNC giornaliero alle 04:00 locali (dopo backup notturno + verify).
# `--max-age 90d` cancella dal cloud i file più vecchi di 90gg in modo che lo
# spazio non cresca all'infinito. Per OneDrive Business (1TB) e' irrilevante,
# per OneDrive Personal (5GB) e' essenziale.

set -euo pipefail

REMOTE_NAME="${1:-}"
REMOTE_FOLDER="${2:-Cadenza/backups}"
BACKUP_DIR="${BACKUP_DIR:-/home/cadenza/backups}"
OWNER="${OWNER:-cadenza}"
CRON_HOUR="${CRON_HOUR:-4}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-90}"
CRON_FILE="/etc/cron.d/cadenza-rclone-backups"
LOG_FILE="/var/log/cadenza-rclone-backups.log"

if [[ -z "$REMOTE_NAME" ]]; then
  echo "Uso: sudo bash $0 <remote-name> [<remote-folder>]"
  echo "Esempio: sudo bash $0 cadenza-cloud Cadenza/backups"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "✗ Servono privilegi root (usa sudo)."
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "✗ rclone non installato. Esegui prima:"
  echo "    curl https://rclone.org/install.sh | sudo bash"
  exit 1
fi

# Verifica esistenza dell'utente OWNER
if ! id -u "$OWNER" >/dev/null 2>&1; then
  echo "✗ Utente '$OWNER' non esiste."
  echo "  Crea l'utente o cambia OWNER: sudo useradd -r -m $OWNER"
  exit 1
fi

# IMPORTANT: il config rclone vive in ~/.config/rclone/rclone.conf
# dell'utente che fa girare il cron. Verifichiamo come $OWNER.
RCLONE_AS_OWNER="sudo -u $OWNER rclone"

if ! $RCLONE_AS_OWNER listremotes 2>/dev/null | grep -q "^${REMOTE_NAME}:$"; then
  echo "✗ Remote '${REMOTE_NAME}' non trovato per l'utente '$OWNER'."
  echo ""
  echo "  Configura il remote SOTTO l'utente:"
  echo "      sudo -u $OWNER rclone config"
  echo ""
  echo "  Procedura: n (new remote) → nome=\"${REMOTE_NAME}\" → scegli storage"
  echo "  (onedrive/dropbox/s3/…) → autenticazione → salva."
  echo ""
  echo "  Remote attualmente configurati per '$OWNER':"
  $RCLONE_AS_OWNER listremotes 2>/dev/null | sed 's/^/    /' || echo "    (nessuno)"
  exit 1
fi

# Verifica cartella backup locale
if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "✗ Cartella backup '$BACKUP_DIR' non esiste."
  echo "  Crea la cartella o cambia BACKUP_DIR:"
  echo "      sudo -u $OWNER mkdir -p $BACKUP_DIR"
  exit 1
fi
echo "✓ Cartella backup locale: $BACKUP_DIR"

# Test connessione al remote
echo "→ Test connessione a '${REMOTE_NAME}:' (come utente $OWNER)..."
if ! $RCLONE_AS_OWNER lsd "${REMOTE_NAME}:" >/dev/null 2>&1; then
  echo "✗ Impossibile accedere a ${REMOTE_NAME}: — verifica:"
  echo "    sudo -u $OWNER rclone lsd ${REMOTE_NAME}:"
  exit 1
fi
echo "✓ Remote raggiungibile."

# Cron entry: sync giornaliero alle CRON_HOUR:00 locali.
# Usiamo `copy` invece di `sync` per non cancellare file dal remote se
# vengono manualmente messi lì. Per la rotazione usiamo `--max-age` con
# `rclone delete` separato (lifecycle on remote, non sync delete).
RCLONE_BIN="$(command -v rclone)"
cat > "$CRON_FILE" <<EOF
# Cadenza · backup off-site verso ${REMOTE_NAME}:${REMOTE_FOLDER}
# Generato da setup-rclone-backups.sh — modifica a tuo rischio
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Sync ogni notte alle ${CRON_HOUR}:00 locali (dopo backup nightly + verify)
0 ${CRON_HOUR} * * * ${OWNER} ${RCLONE_BIN} copy ${BACKUP_DIR} ${REMOTE_NAME}:${REMOTE_FOLDER} --quiet --transfers 2 --checkers 4 --timeout 300s --log-file=${LOG_FILE}

# Cleanup mensile: cancella dal remote i file più vecchi di ${MAX_AGE_DAYS} giorni
0 5 1 * * ${OWNER} ${RCLONE_BIN} delete ${REMOTE_NAME}:${REMOTE_FOLDER} --min-age ${MAX_AGE_DAYS}d --quiet --log-file=${LOG_FILE}
EOF
chmod 644 "$CRON_FILE"
touch "$LOG_FILE"
chown "$OWNER":"$OWNER" "$LOG_FILE"
echo "✓ Cron installato: $CRON_FILE"
echo "    - sync: ogni giorno alle ${CRON_HOUR}:00"
echo "    - cleanup: 1° del mese alle 05:00 (retention ${MAX_AGE_DAYS}gg)"

# Test iniziale: un copy immediato dei backup esistenti
echo "→ Eseguo un copy di prova..."
if sudo -u "$OWNER" "$RCLONE_BIN" copy "$BACKUP_DIR" "${REMOTE_NAME}:${REMOTE_FOLDER}" --quiet --timeout 300s; then
  echo "✓ Copy di prova OK."
  COUNT=$(sudo -u "$OWNER" "$RCLONE_BIN" lsf "${REMOTE_NAME}:${REMOTE_FOLDER}" 2>/dev/null | wc -l | tr -d ' ')
  echo "✓ File presenti nel remote: $COUNT"
else
  echo "⚠ Copy di prova fallito — controlla $LOG_FILE"
fi

echo
echo "─────────────────────────────────────────────────────"
echo "Setup completato. Cosa controllare:"
echo "  1. Il primo sync automatico parte stanotte alle ${CRON_HOUR}:00"
echo "  2. Log:   tail -f $LOG_FILE"
echo "  3. Manuale: sudo -u $OWNER $RCLONE_BIN copy $BACKUP_DIR ${REMOTE_NAME}:${REMOTE_FOLDER}"
echo "  4. Lista cloud: sudo -u $OWNER $RCLONE_BIN lsf ${REMOTE_NAME}:${REMOTE_FOLDER}"
echo "  5. Disabilita: sudo rm $CRON_FILE"
echo "─────────────────────────────────────────────────────"
