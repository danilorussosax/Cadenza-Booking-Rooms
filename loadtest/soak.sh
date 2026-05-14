#!/usr/bin/env bash
# =============================================================================
# Soak test driver.
#
# Esegue:
#   1. k6 con scenario soak (loadtest/soak.js)   — traffico costante per N ore
#   2. sampler Node (loadtest/sampler.js)        — campiona memoria/FD ogni 30s
#   3. tail filtrato di `pm2 logs` su file       — opzionale, solo se pm2 c'è
#
# Alla fine (timeout naturale o SIGINT) aggrega il report Markdown via
# `loadtest/soak-report.js`.
#
# Uso:
#   ./soak.sh [hours] [target-url]
#     hours       durata in ore (default 4, accetta decimali per smoke: 0.01)
#     target-url  default http://localhost:3001
#
# Esempi:
#   ./soak.sh                                    # 4h vs localhost:3001
#   ./soak.sh 1 http://staging.example.com       # 1h vs staging
#   ./soak.sh 0.01                               # ~36s smoke (verifica harness)
#
# Requisiti:
#   - k6 installato (brew install k6)            obbligatorio
#   - Node >= 16                                 obbligatorio (sampler/report)
#   - pm2 + processo cadenza-backend             OPZIONALE (memoria/CPU)
#
# POSIX-friendly. Testato bash 3.2 (macOS) e bash 5+ (Linux).
# Non committare i file *-metrics-*.jsonl / *-report-*.md / *-errors-*.log.
# =============================================================================

set -euo pipefail

HOURS="${1:-4}"
TARGET="${2:-http://localhost:3001}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# RPS basso: il soak deve provocare carico realistico, non stress.
RPS="${RPS:-5}"
SAMPLE_INTERVAL="${SAMPLE_INTERVAL:-30}"
PM2_NAME="${PM2_NAME:-cadenza-backend}"

TS="$(date +%Y%m%d-%H%M%S)"
METRICS_FILE="$SCRIPT_DIR/soak-metrics-${TS}.jsonl"
ERRORS_FILE="$SCRIPT_DIR/soak-errors-${TS}.log"
K6_SUMMARY_FILE="$SCRIPT_DIR/soak-k6-${TS}.json"
REPORT_FILE="$SCRIPT_DIR/soak-report-${TS}.md"

# Colori (no-op se non TTY).
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'; C_OFF=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_OFF=''
fi
say()  { printf '%s\n' "$*"; }
red()  { printf '%s%s%s\n' "$C_RED" "$*" "$C_OFF"; }
grn()  { printf '%s%s%s\n' "$C_GRN" "$*" "$C_OFF"; }
ylw()  { printf '%s%s%s\n' "$C_YLW" "$*" "$C_OFF"; }
blu()  { printf '%s%s%s\n' "$C_BLU" "$*" "$C_OFF"; }

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
blu "[soak] preflight"
say  "  hours=$HOURS  target=$TARGET  rps=$RPS  interval=${SAMPLE_INTERVAL}s"

if ! command -v node >/dev/null 2>&1; then
  red "  node non trovato — installa Node.js >= 16"
  exit 1
fi

if ! command -v k6 >/dev/null 2>&1; then
  red "  k6 non trovato — installa con: brew install k6 (mac) o https://k6.io/docs/get-started/installation/"
  exit 1
fi

# /api/ready check (non bloccante: warn se 503/down ma lascia partire).
READY_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${TARGET}/api/ready" || echo 000)"
if [ "$READY_CODE" = "200" ]; then
  grn "  ✓ backend /api/ready 200 ($TARGET)"
else
  ylw "  ⚠ backend /api/ready non OK (code=$READY_CODE) — il soak partirà comunque ma verifica il target"
fi

# pm2 è opzionale: se non c'è, niente memoria/CPU/log nel report.
HAS_PM2=0
if command -v pm2 >/dev/null 2>&1; then
  if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$PM2_NAME\""; then
    HAS_PM2=1
    grn "  ✓ pm2 attivo, processo $PM2_NAME trovato"
  else
    ylw "  ⚠ pm2 installato ma processo $PM2_NAME non trovato — niente memory/log"
  fi
else
  ylw "  ⚠ pm2 non installato — niente memory/CPU/log nel report"
fi

# -----------------------------------------------------------------------------
# Avvio processi in parallelo
# -----------------------------------------------------------------------------
PIDS=""
cleanup() {
  blu "[soak] shutdown — fermo i processi figli"
  # Manda SIGTERM a tutti i PID raccolti (ignora errori se già morti).
  for pid in $PIDS; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  # Aspetta breve per chiusura pulita.
  sleep 1
  for pid in $PIDS; do
    kill -KILL "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

# 1. sampler in background
blu "[soak] start sampler → $METRICS_FILE"
node "$SCRIPT_DIR/sampler.js" \
  --interval="$SAMPLE_INTERVAL" \
  --out="$METRICS_FILE" \
  --url="$TARGET" \
  --pm2-name="$PM2_NAME" \
  --quiet \
  > "$SCRIPT_DIR/.soak-sampler-${TS}.log" 2>&1 &
SAMPLER_PID=$!
PIDS="$PIDS $SAMPLER_PID"

# 2. pm2 logs filtrato (solo se pm2 c'è)
if [ "$HAS_PM2" = "1" ]; then
  blu "[soak] start pm2 logs tail → $ERRORS_FILE"
  # grep -E con pattern "error|warn|exception|denied|timeout" — case-insensitive.
  # Usiamo `pm2 logs ... --raw` per evitare il prefisso colorato.
  ( pm2 logs "$PM2_NAME" --raw --lines 0 2>&1 \
      | grep -iE 'error|warn|exception|denied|timeout|ECONN|EADDR' \
      >> "$ERRORS_FILE" ) &
  LOGS_PID=$!
  PIDS="$PIDS $LOGS_PID"
fi

# 3. k6
blu "[soak] start k6 (HOURS=$HOURS RPS=$RPS)"
say  "  k6 summary JSON → $K6_SUMMARY_FILE"

# k6 viene eseguito in foreground: termina naturalmente alla fine della durata,
# o riceve SIGINT dal trap se l'utente preme Ctrl-C.
set +e
HOURS="$HOURS" RPS="$RPS" BASE_URL="$TARGET" \
  k6 run \
    --env "HOURS=$HOURS" \
    --env "RPS=$RPS" \
    --env "BASE_URL=$TARGET" \
    --summary-export "$K6_SUMMARY_FILE" \
    "$SCRIPT_DIR/soak.js"
K6_EXIT=$?
set -e

# -----------------------------------------------------------------------------
# Stop sampler + tail; aggrega report
# -----------------------------------------------------------------------------
blu "[soak] stop background jobs"
for pid in $PIDS; do
  kill -TERM "$pid" 2>/dev/null || true
done
# Aspetta che il sampler flushi l'ultima riga.
sleep 1

if [ ! -s "$METRICS_FILE" ]; then
  red "  ✗ nessuna metrica raccolta in $METRICS_FILE"
  exit 1
fi

LINES="$(wc -l < "$METRICS_FILE" | tr -d ' ')"
grn "  ✓ $LINES sample raccolti in $METRICS_FILE"

blu "[soak] genero report → $REPORT_FILE"
node "$SCRIPT_DIR/soak-report.js" --in="$METRICS_FILE" --out="$REPORT_FILE"

# Sintesi richieste k6 dal summary-export.
if [ -s "$K6_SUMMARY_FILE" ] && command -v node >/dev/null 2>&1; then
  K6_DIGEST="$(node -e "
    try {
      const s = JSON.parse(require('fs').readFileSync('$K6_SUMMARY_FILE','utf8'));
      const reqs = s.metrics?.http_reqs?.count ?? 0;
      const fail = s.metrics?.http_req_failed?.value ?? 0;
      const p95  = s.metrics?.http_req_duration?.['p(95)'] ?? 0;
      const p99  = s.metrics?.http_req_duration?.['p(99)'] ?? 0;
      console.log(\`k6: \${reqs} req, fail \${(fail*100).toFixed(2)}%, p95=\${p95.toFixed(0)}ms p99=\${p99.toFixed(0)}ms\`);
    } catch { console.log('k6: (summary non parsabile)'); }
  ")"
  say "  $K6_DIGEST"
fi

if [ "$K6_EXIT" -ne 0 ]; then
  ylw "  ⚠ k6 exit code $K6_EXIT (threshold fallito o errore) — controlla report"
fi

grn "[soak] done. Report: $REPORT_FILE"
