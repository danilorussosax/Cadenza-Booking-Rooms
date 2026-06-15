#!/usr/bin/env bash
# =============================================================================
# ensure-encryption-key.sh — eseguito sul VPS dal deploy (cwd: backend/).
#
# 1. Se manca SETTINGS_ENCRYPTION_KEY nel .env, la genera (openssl rand -hex 64)
#    e la appende. La chiave NON è in rsync (.env escluso) → sopravvive ai deploy.
# 2. Lancia reencrypt-settings.js (idempotente) per migrare i blob cifrati dalla
#    vecchia chiave (JWT_SECRET, default OLD) alla nuova SETTINGS_ENCRYPTION_KEY.
#
# Eseguito PRIMA del restart PM2: così il nuovo backend (che fa fail-fast se la
# chiave manca — lib/secrets.js) trova sempre la chiave e i dati già migrati.
#
# Idempotente: ai deploy successivi salta la generazione e il reencrypt è no-op.
# =============================================================================
set -euo pipefail

ENV_FILE="${1:-.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ensure-key] ERRORE: $ENV_FILE non trovato (cwd $(pwd))." >&2
  exit 1
fi

if grep -qE '^SETTINGS_ENCRYPTION_KEY=.+' "$ENV_FILE"; then
  echo "[ensure-key] SETTINGS_ENCRYPTION_KEY già presente."
else
  KEY="$(openssl rand -hex 64)"
  printf '\n# Chiave dedicata per cifrare le credenziali (separata da JWT_SECRET).\n# Generata automaticamente dal deploy — NON modificare senza rieseguire reencrypt-settings.js.\nSETTINGS_ENCRYPTION_KEY=%s\n' "$KEY" >> "$ENV_FILE"
  echo "[ensure-key] SETTINGS_ENCRYPTION_KEY generata e aggiunta a $ENV_FILE."
fi

echo "[ensure-key] Re-encrypt settings (idempotente)…"
node scripts/reencrypt-settings.js
echo "[ensure-key] Fatto."
