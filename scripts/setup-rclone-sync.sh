#!/usr/bin/env bash
#
# setup-rclone-sync.sh — prepara la cartella di export Excel e installa il cron
# che la sincronizza verso un remote rclone (OneDrive/Dropbox/iCloud/…).
#
# Prerequisito (manuale, una volta sola):
#   1) Installa rclone:   curl https://rclone.org/install.sh | sudo bash
#   2) Configura il remote: rclone config
#      Segui la procedura guidata.
#      Annotati il NOME del remote (es. "cadenza-cloud"), ti serve sotto.
#
# Uso:
#   sudo bash scripts/setup-rclone-sync.sh <remote-name> [<remote-folder>]
#
# Esempio:
#   sudo bash scripts/setup-rclone-sync.sh cadenza-cloud CadenzaBackup
#
# Variabili opzionali:
#   SYNC_DIR=/var/cadenza/sync     # cartella locale di export
#   OWNER=cadenza                  # user/group che possiede la cartella
#   CRON_EVERY=10                  # ogni quanti minuti girare rclone
#
set -euo pipefail

REMOTE_NAME="${1:-}"
REMOTE_FOLDER="${2:-CadenzaBackup}"
SYNC_DIR="${SYNC_DIR:-/var/cadenza/sync}"
OWNER="${OWNER:-cadenza}"
CRON_EVERY="${CRON_EVERY:-10}"
CRON_FILE="/etc/cron.d/cadenza-rclone-sync"

if [[ -z "$REMOTE_NAME" ]]; then
  echo "Uso: sudo bash $0 <remote-name> [<remote-folder>]"
  echo "Esempio: sudo bash $0 cadenza-cloud CadenzaBackup"
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

# Verifica esistenza dell'utente OWNER (servirà per cron + rclone config)
if ! id -u "$OWNER" >/dev/null 2>&1; then
  echo "✗ Utente '$OWNER' non esiste."
  echo "  Cambia variabile OWNER o crea l'utente: sudo useradd -r -m $OWNER"
  exit 1
fi

# IMPORTANT: rclone va configurato SOTTO l'utente che girerà il cron (OWNER),
# non sotto root, perché il config sta in ~/.config/rclone/rclone.conf
# dell'utente. Per questo i controlli `rclone listremotes` e `rclone lsd`
# vengono eseguiti via `sudo -u $OWNER`.
RCLONE_AS_OWNER="sudo -u $OWNER rclone"

# Verifica che il remote esista nel config dell'utente OWNER
if ! $RCLONE_AS_OWNER listremotes 2>/dev/null | grep -q "^${REMOTE_NAME}:$"; then
  echo "✗ Remote '${REMOTE_NAME}' non trovato nel config dell'utente '$OWNER'."
  echo ""
  echo "  Configura il remote SOTTO l'utente che girerà il cron:"
  echo "      sudo -u $OWNER rclone config"
  echo ""
  echo "  Procedura: n (new remote) → nome=\"${REMOTE_NAME}\" → scegli storage"
  echo "  (onedrive/dropbox/...) → account personal → autorizza"
  echo " Modalità headless supportata via env."
  echo ""
  echo "  Remote attualmente configurati per '$OWNER':"
  $RCLONE_AS_OWNER listremotes 2>/dev/null | sed 's/^/    /' || echo "    (nessuno)"
  exit 1
fi

# Cartella locale di export
if [[ ! -d "$SYNC_DIR" ]]; then
  echo "→ Creo $SYNC_DIR"
  mkdir -p "$SYNC_DIR"
fi
chown -R "$OWNER":"$OWNER" "$SYNC_DIR"
chmod 750 "$SYNC_DIR"
echo "✓ Cartella locale: $SYNC_DIR (owner $OWNER, mode 750)"

# Test connessione al remote (come utente OWNER)
echo "→ Test connessione al remote '${REMOTE_NAME}:' (come utente $OWNER)..."
if ! $RCLONE_AS_OWNER lsd "${REMOTE_NAME}:" >/dev/null 2>&1; then
  echo "✗ Impossibile accedere a ${REMOTE_NAME}: — verifica:"
  echo "    sudo -u $OWNER rclone lsd ${REMOTE_NAME}:"
  exit 1
fi
echo "✓ Remote raggiungibile."

# Cron entry
RCLONE_BIN="$(command -v rclone)"
cat > "$CRON_FILE" <<EOF
# Cadenza · sync cartella export Excel verso ${REMOTE_NAME}:${REMOTE_FOLDER}
# Generato da setup-rclone-sync.sh — modifica a tuo rischio
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

*/${CRON_EVERY} * * * * ${OWNER} ${RCLONE_BIN} sync ${SYNC_DIR} ${REMOTE_NAME}:${REMOTE_FOLDER} --quiet --transfers 2 --checkers 4 --timeout 60s --log-file=/var/log/cadenza-rclone-sync.log
EOF
chmod 644 "$CRON_FILE"
touch /var/log/cadenza-rclone-sync.log
chown "$OWNER":"$OWNER" /var/log/cadenza-rclone-sync.log
echo "✓ Cron installato: $CRON_FILE (ogni ${CRON_EVERY} min)"

# Test iniziale: un sync immediato così l'admin vede qualcosa subito
echo "→ Eseguo un sync di prova..."
if sudo -u "$OWNER" "$RCLONE_BIN" sync "$SYNC_DIR" "${REMOTE_NAME}:${REMOTE_FOLDER}" --quiet --timeout 60s; then
  echo "✓ Sync di prova OK."
else
  echo "⚠ Sync di prova fallito — controlla /var/log/cadenza-rclone-sync.log"
fi

echo
echo "─────────────────────────────────────────────────────"
echo "Setup completato. Prossimi passi:"
echo "  1. In backend/.env imposta:"
echo "       EXCEL_EXPORT_ENABLED=true"
echo "       EXCEL_EXPORT_PATH=${SYNC_DIR}/cadenza-prenotazioni.xlsx"
echo "  2. Riavvia il backend:  pm2 restart cadenza-backend"
echo "  3. Apri /admin/server-settings → Servizi → Export Excel"
echo "  4. Clicca 'Rigenera ora' per generare il primo file"
echo "  5. Verifica che ${REMOTE_NAME}:${REMOTE_FOLDER}/cadenza-prenotazioni.xlsx"
echo "     compaia nel cloud entro ${CRON_EVERY} minuti"
echo "─────────────────────────────────────────────────────"
