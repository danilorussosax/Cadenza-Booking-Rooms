#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Deploy script Cadenza — Mac → VPS IONOS
#
# Cosa fa:
#   1. Build frontend in locale (typecheck + bundle)
#   2. Mostra cosa cambierebbe sul VPS (dry-run) e chiede conferma
#   3. Verifica che il server NON abbia moduli più moderni del locale
#      (in tal caso annulla il deploy per non regredire il VPS)
#   4. rsync incrementale del codice + dist
#   5. npm ci --omit=dev sul backend del VPS solo se package-lock.json è cambiato
#   6. pm2 restart cadenza-backend
#   7. Healthcheck post-deploy
#
# Uso:
#   ./deploy.sh              # deploy interattivo con conferma
#   ./deploy.sh --yes        # senza conferma (per CI o uso rapido)
#   ./deploy.sh --no-build   # salta la build frontend (se l'hai già fatta)
# ============================================================

VPS_USER="cadenza"
VPS_HOST="82.165.110.193"
VPS_PATH="/home/cadenza/cadenza"

LOCAL_ROOT="$(cd "$(dirname "$0")" && pwd)"
SSH_TARGET="${VPS_USER}@${VPS_HOST}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new"

AUTO_YES=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)        AUTO_YES=1 ;;
    --no-build)      SKIP_BUILD=1 ;;
    --help|-h)       sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $arg"; exit 2 ;;
  esac
done

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
blue()   { printf '\033[34m%s\033[0m\n' "$*"; }

cd "$LOCAL_ROOT"

# Sanity: siamo nella root del repo?
[[ -d backend && -d frontend && -f package.json ]] \
  || { red "[ERR] Lancialo dalla root del monorepo (manca backend/, frontend/, package.json)"; exit 1; }

# ------------------------------------------------------------
# 1. Build frontend
# ------------------------------------------------------------
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  blue "[1/7] Build frontend in locale…"
  ( cd frontend && npm run build )
  green "    ✓ build ok ($(du -sh frontend/dist | cut -f1))"
else
  yellow "[1/7] Build frontend SALTATA (--no-build)"
  [[ -d frontend/dist ]] || { red "[ERR] frontend/dist non esiste, non posso saltare la build"; exit 1; }
fi

# ------------------------------------------------------------
# 2. Esclusioni rsync (mai sovrascrivere stato runtime del VPS)
# ------------------------------------------------------------
RSYNC_EXCLUDES=(
  --exclude 'node_modules/'
  --exclude '.git/'
  --exclude 'coverage/'
  --exclude '*.log'
  --exclude '*.tsbuildinfo'
  --exclude '.DS_Store'
  --exclude '_legacy/'
  --exclude 'backups/'
  # File runtime del VPS — NON sovrascrivere mai
  --exclude 'backend/.env'
  --exclude 'backend/uploads/'
  --exclude 'backend/data/'
  --exclude 'frontend/public/logo-app/'
  # Dev-only
  --exclude 'frontend/coverage/'
  --exclude 'e2e/'
)

# ------------------------------------------------------------
# 3. Dry-run: cosa cambierebbe?
# ------------------------------------------------------------
blue "[2/7] Calcolo modifiche da inviare al VPS (dry-run)…"
DRY_OUTPUT="$(mktemp)"
rsync -avzn --itemize-changes "${RSYNC_EXCLUDES[@]}" \
  -e "ssh ${SSH_OPTS}" \
  "$LOCAL_ROOT/" "${SSH_TARGET}:${VPS_PATH}/" \
  | grep -E '^[<>ch.*]' | grep -v '^cd' > "$DRY_OUTPUT" || true

CHANGE_COUNT=$(wc -l < "$DRY_OUTPUT" | tr -d ' ')

if [[ "$CHANGE_COUNT" -eq 0 ]]; then
  green "    ✓ niente da trasferire"
else
  yellow "    ${CHANGE_COUNT} file da aggiornare:"
  head -40 "$DRY_OUTPUT" | sed 's/^/      /'
  [[ "$CHANGE_COUNT" -gt 40 ]] && yellow "      … e altri $((CHANGE_COUNT-40))"
fi
rm -f "$DRY_OUTPUT"

# ------------------------------------------------------------
# 3. Verifica versioni moduli (lock-based, stretto): confronta le versioni
#    risolte in package-lock.json di backend/ e frontend/ — incluse le sub-
#    dipendenze annidate. Per ogni package name si confronta la versione MAX
#    risolta sul server con quella MAX risolta in locale; se anche una sola è
#    più alta sul server → STOP, nessun file viene toccato sul VPS.
# ------------------------------------------------------------
blue "[3/7] Verifica versioni moduli (lock-based, locale vs server)…"

NEWER_REPORT="$(mktemp)"
for sub in backend frontend; do
  LOCAL_LOCK="$LOCAL_ROOT/${sub}/package-lock.json"
  if [[ ! -f "$LOCAL_LOCK" ]]; then
    yellow "    ${sub}/package-lock.json mancante in locale, salto controllo"
    continue
  fi
  REMOTE_LOCK="$(mktemp)"
  ssh ${SSH_OPTS} "$SSH_TARGET" "cat ${VPS_PATH}/${sub}/package-lock.json 2>/dev/null" > "$REMOTE_LOCK" || true
  if [[ ! -s "$REMOTE_LOCK" ]]; then
    yellow "    ${sub}/package-lock.json non presente sul server, salto controllo"
    rm -f "$REMOTE_LOCK"
    continue
  fi
  node -e '
    const fs = require("fs");
    const sub = process.argv[3];
    const local  = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const remote = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

    // Parser semver-light: estrae [major, minor, patch] e prerelease.
    // Una versione SENZA prerelease è > stessa versione CON prerelease (regola semver).
    const parse = v => {
      const m = String(v||"").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
      return m ? { mmp: [+m[1], +m[2], +m[3]], pre: m[4] || null } : null;
    };
    const cmpPre = (a, b) => {
      if (a === b) return 0;
      if (!a && b) return 1;       // niente prerelease > prerelease
      if (a && !b) return -1;
      const pa = a.split("."), pb = b.split(".");
      const len = Math.max(pa.length, pb.length);
      for (let i = 0; i < len; i++) {
        const x = pa[i], y = pb[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
        if (xn && yn) { const d = (+x) - (+y); if (d) return d > 0 ? 1 : -1; }
        else if (xn !== yn) return xn ? -1 : 1; // numerici < alfanumerici
        else if (x !== y)   return x > y ? 1 : -1;
      }
      return 0;
    };
    const cmp = (a, b) => {
      const pa = parse(a), pb = parse(b);
      if (!pa || !pb) return 0;                // versioni non standard → non confrontabile
      for (let i = 0; i < 3; i++) {
        if (pa.mmp[i] > pb.mmp[i]) return  1;
        if (pa.mmp[i] < pb.mmp[i]) return -1;
      }
      return cmpPre(pa.pre, pb.pre);
    };

    // Estrae la mappa { packageName -> versione MAX risolta } dal lockfile.
    // Supporta lockfile v2/v3 (campo "packages") e v1 (campo "dependencies").
    const maxByName = lock => {
      const out = {};
      const bump = (name, version) => {
        if (!name || !version) return;
        if (!out[name] || cmp(version, out[name]) > 0) out[name] = version;
      };
      if (lock.packages) {
        for (const [path, info] of Object.entries(lock.packages)) {
          if (!path || !info || !info.version) continue;          // root del workspace ha path ""
          const idx = path.lastIndexOf("node_modules/");
          if (idx < 0) continue;
          const name = path.slice(idx + "node_modules/".length);
          bump(name, info.version);
        }
      } else if (lock.dependencies) {
        const walk = deps => {
          for (const [name, info] of Object.entries(deps)) {
            if (info && info.version) bump(name, info.version);
            if (info && info.dependencies) walk(info.dependencies);
          }
        };
        walk(lock.dependencies);
      }
      return out;
    };

    const lmax = maxByName(local);
    const rmax = maxByName(remote);
    for (const name of Object.keys(rmax).sort()) {
      const lv = lmax[name];
      const rv = rmax[name];
      if (!lv) continue;                          // pacchetto presente solo sul server: non è una regressione del locale
      if (cmp(rv, lv) > 0) {
        console.log(`${sub}: ${name}  server=${rv}  locale=${lv}`);
      }
    }
  ' "$LOCAL_LOCK" "$REMOTE_LOCK" "$sub" >> "$NEWER_REPORT"
  rm -f "$REMOTE_LOCK"
done

if [[ -s "$NEWER_REPORT" ]]; then
  red "    ✗ Il server ha moduli risolti più moderni del locale:"
  sed 's/^/      /' "$NEWER_REPORT"
  rm -f "$NEWER_REPORT"
  red "    Deploy ANNULLATO: i file sul server NON sono stati toccati."
  red "    Allinea le dipendenze locali (npm install) e riprova."
  exit 1
fi
rm -f "$NEWER_REPORT"
green "    ✓ moduli locali ≥ server (lock-based, nessuna regressione)"

# ------------------------------------------------------------
# 4. Conferma
# ------------------------------------------------------------
if [[ "$CHANGE_COUNT" -gt 0 && "$AUTO_YES" -eq 0 ]]; then
  echo
  read -r -p "Procedo con il deploy su ${SSH_TARGET}? [y/N] " ans
  [[ "$ans" =~ ^[yY]$ ]] || { yellow "Deploy annullato."; exit 0; }
fi

# ------------------------------------------------------------
# 5. rsync vero
# ------------------------------------------------------------
if [[ "$CHANGE_COUNT" -gt 0 ]]; then
  blue "[4/7] rsync verso VPS…"
  rsync -avz --info=progress2 "${RSYNC_EXCLUDES[@]}" \
    -e "ssh ${SSH_OPTS}" \
    "$LOCAL_ROOT/" "${SSH_TARGET}:${VPS_PATH}/"
  green "    ✓ codice trasferito"
else
  blue "[4/7] rsync saltato (nessuna modifica)"
fi

# ------------------------------------------------------------
# 6. npm ci --omit=dev se package-lock.json del backend è cambiato
# ------------------------------------------------------------
blue "[5/7] Verifico se le dipendenze backend sono cambiate…"
LOCAL_HASH="$(shasum -a 256 backend/package-lock.json | awk '{print $1}')"
REMOTE_HASH="$(ssh ${SSH_OPTS} "$SSH_TARGET" "shasum -a 256 ${VPS_PATH}/backend/package-lock.json 2>/dev/null | awk '{print \$1}'" || echo "")"

if [[ "$LOCAL_HASH" == "$REMOTE_HASH" ]]; then
  green "    ✓ package-lock invariato, niente npm ci"
else
  yellow "    package-lock cambiato → npm ci --omit=dev sul VPS…"
  ssh ${SSH_OPTS} "$SSH_TARGET" "cd ${VPS_PATH}/backend && npm ci --omit=dev"
  green "    ✓ dipendenze backend aggiornate"
fi

# ------------------------------------------------------------
# 7. Restart PM2
# ------------------------------------------------------------
blue "[6/7] Restart backend (pm2)…"
ssh ${SSH_OPTS} "$SSH_TARGET" "pm2 restart cadenza-backend --update-env >/dev/null && pm2 status cadenza-backend --no-color | tail -3"

# ------------------------------------------------------------
# 8. Healthcheck
# ------------------------------------------------------------
blue "[7/7] Healthcheck post-deploy…"
sleep 2
HEALTH_HTTP=$(ssh ${SSH_OPTS} "$SSH_TARGET" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")
if [[ "$HEALTH_HTTP" =~ ^(200|301|302|404)$ ]]; then
  green "    ✓ backend risponde (HTTP $HEALTH_HTTP)"
else
  red "    ✗ backend non risponde (HTTP $HEALTH_HTTP)"
  red "      Controlla i log: ssh ${SSH_TARGET} 'pm2 logs cadenza-backend --lines 50 --nostream'"
  exit 1
fi

green ""
green "🎉 Deploy completo: http://${VPS_HOST}"
