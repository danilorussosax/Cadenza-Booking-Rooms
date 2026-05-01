#!/usr/bin/env bash
# dev-restart.sh — kill atomico del backend Aula Book + restart pulito.
#
# Risolve il classico EADDRINUSE quando un processo `node server.js`
# precedente è rimasto vivo e tiene la porta 3000 in LISTEN.
#
# USAGE:
#   ./scripts/dev-restart.sh                # default: porta 3000, foreground
#   ./scripts/dev-restart.sh --port 3001    # porta custom
#   ./scripts/dev-restart.sh --bg           # detach in background, log su /tmp
#   ./scripts/dev-restart.sh --bg --quiet   # background + niente output
#   ./scripts/dev-restart.sh --dry          # mostra cosa farebbe, niente azioni
#
# Comportamento:
#   1. Trova chi tiene la porta in LISTEN (lsof -ti :PORT)
#   2. Stop graceful con SIGTERM (5s di grazia per chiudere connessioni)
#   3. Se ancora vivo dopo 5s → SIGKILL
#   4. Verifica che la porta sia libera (max 5 retry × 0.5s)
#   5. Restart `node server.js` dalla cartella backend/
#   6. Tail del primo log fino al messaggio "In ascolto" (max 15s)
#   7. Exit 0 se up, 1 se start fallito

set -u

# ───── Defaults
PORT=3000
BG=0
QUIET=0
DRY=0

# ───── Arg parsing
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --bg) BG=1; shift ;;
    --quiet) QUIET=1; shift ;;
    --dry) DRY=1; shift ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ Argomento sconosciuto: $1" >&2; exit 2 ;;
  esac
done

log() { [[ $QUIET -eq 0 ]] && echo "$@"; }

# ───── Path: lo script deve girare dalla cartella backend/, indipendentemente
# dal cwd di chi lo invoca. SCRIPT_DIR è la cartella scripts/, BACKEND_DIR
# è la sua cartella padre.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/tmp/aulabook-backend-$(whoami).log"

if [[ ! -f "$BACKEND_DIR/server.js" ]]; then
  echo "❌ server.js non trovato in $BACKEND_DIR" >&2
  exit 1
fi

log "🔍 Backend dir: $BACKEND_DIR"
log "🔍 Porta target: $PORT"

# ───── 1) Cerca PID che tengono la porta in LISTEN (TCP IPv4 + IPv6 dual-stack)
PIDS=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | sort -u)

if [[ -n "$PIDS" ]]; then
  log "🛑 Processi su :$PORT in LISTEN: $(echo $PIDS | tr '\n' ' ')"
  if [[ $DRY -eq 1 ]]; then
    log "[dry-run] avrei fatto: kill -TERM $PIDS"
  else
    # Stop graceful: SIGTERM (consente shutdown handler Express + Sequelize close)
    kill -TERM $PIDS 2>/dev/null || true
    # Aspetta fino a 5s (10 × 0.5s) che i processi scompaiano
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 0.5
      ALIVE=$(ps -p $PIDS -o pid= 2>/dev/null | wc -l | tr -d ' ')
      [[ "$ALIVE" == "0" ]] && break
    done
    # Force se ancora vivi
    if [[ "$ALIVE" != "0" ]]; then
      log "⚠ Processi non terminati con SIGTERM, force kill (-9)..."
      kill -KILL $PIDS 2>/dev/null || true
      sleep 0.5
    fi
  fi
else
  log "✅ Nessun processo precedente sulla porta $PORT"
fi

# ───── 2) Verifica porta libera (max 5 retry × 0.5s = 2.5s totale).
# In dry-run salta — non abbiamo davvero killato.
if [[ $DRY -eq 0 ]]; then
  for _ in 1 2 3 4 5; do
    STILL=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
    [[ -z "$STILL" ]] && break
    sleep 0.5
  done
  if [[ -n "${STILL:-}" ]]; then
    echo "❌ Porta $PORT ancora occupata da PID $STILL dopo cleanup. Abort." >&2
    exit 1
  fi
fi

if [[ $DRY -eq 1 ]]; then
  log "[dry-run] avrei eseguito: cd $BACKEND_DIR && node server.js"
  exit 0
fi

# ───── 3) Restart
cd "$BACKEND_DIR" || exit 1

# ───── 3a) Migration sequelize-cli (transizione)
# Applica le migration pending PRIMA di avviare il server. La baseline è
# already-up, quindi su DB allineati è no-op rapido (~50ms). Se una
# migration nuova fallisce, abortiamo lo start: meglio non servire un
# backend con schema disallineato.
if [[ -f "$BACKEND_DIR/.sequelizerc" ]]; then
  log "🗃️  Applico migration sequelize-cli pending..."
  if ! npx --no-install sequelize-cli db:migrate >> "${LOG_FILE:-/dev/null}" 2>&1; then
    echo "❌ db:migrate fallito. Vedi log: ${LOG_FILE:-stderr}" >&2
    exit 1
  fi
fi

if [[ $BG -eq 1 ]]; then
  log "🚀 Avvio backend in background → log: $LOG_FILE"
  nohup node server.js > "$LOG_FILE" 2>&1 &
  NEW_PID=$!
  disown 2>/dev/null || true

  # Aspetta che il messaggio "In ascolto" compaia nel log (max 15s)
  for _ in $(seq 1 30); do
    if grep -q "In ascolto su" "$LOG_FILE" 2>/dev/null; then
      log "✅ Backend up (PID $NEW_PID) — porta $PORT"
      log "   Tail log: tail -f $LOG_FILE"
      exit 0
    fi
    if ! kill -0 "$NEW_PID" 2>/dev/null; then
      echo "❌ Backend è terminato durante l'avvio. Ultimi log:" >&2
      tail -30 "$LOG_FILE" >&2 || true
      exit 1
    fi
    sleep 0.5
  done
  echo "⚠ Timeout 15s: il backend non ha stampato 'In ascolto'. Verifica $LOG_FILE" >&2
  exit 1
else
  log "🚀 Avvio backend in foreground (Ctrl-C per fermare)"
  exec node server.js
fi
