#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Avvio dev combinato: backend (nodemon) + frontend (vite) in parallelo
# nello stesso terminale, con cleanup coordinato.
#
# Uso:
#   npm run dev                # da root
#   ./scripts/dev.sh           # equivalente
#
# Comportamento:
#   - Lancia entrambi i processi in background.
#   - I log dei due si mescolano nello stesso terminale, distinti dai
#     prefissi standard di nodemon ("[nodemon] ...") e vite ("VITE ...").
#   - Un Ctrl+C nel terminale chiude pulitamente entrambi (trap su INT/TERM/EXIT).
#   - Se uno dei due crasha, l'altro continua a girare; il trap finale
#     comunque libererà le porte.
#
# Per debugging mirato senza l'altro lato attivo:
#   npm run dev:backend         # solo backend
#   npm run dev:frontend        # solo frontend
# =============================================================================

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Sanity: presenza delle due cartelle. Se manca una è probabile un cd
# nella directory sbagliata o repo incompleto.
[[ -d backend && -d frontend ]] || {
  echo "[ERR] Lancialo dalla root del monorepo (manca backend/ o frontend/)" >&2
  exit 1
}

cleanup() {
  # `kill 0` invia il segnale a tutto il process group dello script,
  # garantendo che anche i nipoti (vite/nodemon → node child) vengano
  # terminati. Il `2>/dev/null` silenzia eventuali "no such process".
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

npm --prefix backend run dev &
PID_BACK=$!
npm --prefix frontend run dev &
PID_FRONT=$!

# wait su entrambi: lo script resta vivo finché almeno uno dei due gira.
# Se uno termina con errore (`set -e`), il trap si occupa di chiudere il
# survivor e di restituire un exit code non-zero al chiamante.
wait "$PID_BACK" "$PID_FRONT"
