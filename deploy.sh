#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Deploy script Cadenza — Mac → VPS IONOS
#
# Prerequisito SSH:
#   Lo script si appoggia a un alias definito in ~/.ssh/config — di default
#   "cadenza-vps". Esempio di blocco da aggiungere:
#
#     Host cadenza-vps
#         HostName 82.165.110.193
#         User cadenza
#         IdentityFile ~/.ssh/cadenza_deploy
#         IdentitiesOnly yes
#
#   Per cambiare server, utente o chiave si modifica solo quel blocco —
#   lo script resta invariato.
#
# Cosa fa:
#   0. (opzionale, --update-deps) npm outdated su backend/ e frontend/, chiede
#      se applicare gli aggiornamenti semver-safe (npm update) prima del deploy
#   1. Build frontend in locale (typecheck + bundle)
#   2. Mostra cosa cambierebbe sul VPS (dry-run) e chiede conferma
#   3. Verifica che il server NON abbia moduli più moderni del locale
#      (in tal caso annulla il deploy per non regredire il VPS)
#   4. rsync incrementale del codice + dist
#   5. Normalizza i permessi dei path serviti da nginx (dist, public, uploads):
#      rsync preserva i mode del Mac → dir con 700 farebbero crashare nginx
#      (500 EACCES sui file statici, 404 sugli alias)
#   6. npm ci --omit=dev sul backend del VPS solo se package-lock.json è cambiato
#   7. PgBouncer: assicura che il transaction pooler sia attivo sul VPS.
#      Idempotente — la PRIMA volta installa+configura via
#      scripts/setup-pgbouncer.sh (appena trasferito col rsync); ai deploy
#      successivi, se pgbouncer è già attivo, non fa nulla. Richiede sudo
#      passwordless sul VPS (lo script gira come root): se manca, il deploy
#      prosegue e stampa il comando da lanciare a mano una volta.
#   8. pm2 restart cadenza-backend
#   9. Healthcheck robusto (/api/ready, 5 retry × 3s) — verifica anche DB
#      connesso, così intercetta migrazioni schema fallite invece di
#      dichiarare deploy OK mentre il backend è in restart loop.
#
# Uso:
#   ./deploy.sh                 # deploy interattivo con conferma
#   ./deploy.sh --yes           # senza conferma (per CI o uso rapido)
#   ./deploy.sh --no-build      # salta la build frontend (se l'hai già fatta)
#   ./deploy.sh --update-deps   # prima del deploy: npm outdated + scelta y/N per workspace
#   ./deploy.sh --skip-pgbouncer    # non toccare PgBouncer su questo deploy
#   ./deploy.sh --setup-pgbouncer   # forza la riesecuzione del setup PgBouncer (anche se già attivo)
# ============================================================

# Alias definito in ~/.ssh/config (HostName + User + IdentityFile lì).
# Cambiando server o utente si aggiorna solo ~/.ssh/config, non lo script.
VPS_HOST_ALIAS="cadenza-vps"
VPS_PATH="/home/cadenza/cadenza"

LOCAL_ROOT="$(cd "$(dirname "$0")" && pwd)"
SSH_TARGET="$VPS_HOST_ALIAS"
SSH_OPTS=""

# Risolve l'IP/hostname reale dall'alias (per il messaggio finale).
# Fallisce fast se l'alias non è configurato in ~/.ssh/config.
VPS_HOST="$(ssh -G "$VPS_HOST_ALIAS" 2>/dev/null | awk '/^hostname /{print $2; exit}')"
if [[ -z "$VPS_HOST" || "$VPS_HOST" == "$VPS_HOST_ALIAS" ]]; then
  printf '\033[31m[ERR] alias SSH "%s" non trovato in ~/.ssh/config.\033[0m\n' "$VPS_HOST_ALIAS"
  printf '       Aggiungi un blocco tipo:\n'
  printf '         Host %s\n           HostName <ip>\n           User <utente>\n           IdentityFile ~/.ssh/cadenza_deploy\n' "$VPS_HOST_ALIAS"
  exit 1
fi

AUTO_YES=0
SKIP_BUILD=0
UPDATE_DEPS=0
SKIP_PGBOUNCER=0
SETUP_PGBOUNCER=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)          AUTO_YES=1 ;;
    --no-build)        SKIP_BUILD=1 ;;
    --update-deps)     UPDATE_DEPS=1 ;;
    --skip-pgbouncer)  SKIP_PGBOUNCER=1 ;;
    --setup-pgbouncer) SETUP_PGBOUNCER=1 ;;
    --help|-h)         sed -n '2,49p' "$0"; exit 0 ;;
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
# 0. Aggiornamento dipendenze npm (--update-deps)
#    Per ciascun workspace mostra `npm outdated` e chiede se applicare
#    aggiornamenti semver-safe via `npm update` (rispetta i range ^/~ in
#    package.json, niente major bump). Le modifiche al package-lock.json
#    vengono poi raccolte dal normale flusso di deploy (rsync + npm ci).
# ------------------------------------------------------------
if [[ "$UPDATE_DEPS" -eq 1 ]]; then
  blue "[opt] Aggiornamento dipendenze npm (locale)…"
  for sub in backend frontend; do
    [[ -f "$sub/package.json" ]] || continue
    echo
    yellow "  ── ${sub}/ ──"
    # npm outdated → exit 0 se nulla è obsoleto, exit 1 se ci sono aggiornamenti
    if ( cd "$sub" && npm outdated ); then
      green "    ✓ ${sub}: già allineato"
      continue
    fi
    if [[ "$AUTO_YES" -eq 1 ]]; then
      ans=y
    else
      read -r -p "  Aggiorno ${sub}/ con npm update (semver-safe)? [y/N] " ans
    fi
    if [[ "$ans" =~ ^[yY]$ ]]; then
      ( cd "$sub" && npm update )
      green "    ✓ ${sub}: package-lock.json aggiornato (ricordati di committare)"
    else
      yellow "    ${sub}: aggiornamento saltato"
    fi
  done
  echo
fi

# ------------------------------------------------------------
# 1. Build frontend
# ------------------------------------------------------------
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  blue "[1/9] Build frontend in locale…"
  ( cd frontend && npm run build )
  green "    ✓ build ok ($(du -sh frontend/dist | cut -f1))"
else
  yellow "[1/9] Build frontend SALTATA (--no-build)"
  [[ -d frontend/dist ]] || { red "[ERR] frontend/dist non esiste, non posso saltare la build"; exit 1; }
  # Stale-check: se almeno un sorgente in frontend/src e' piu' recente del
  # bundle in dist, --no-build pubblicherebbe codice obsoleto. Tailwind in
  # particolare purga al build le classi non viste nel sorgente — un dist
  # vecchio significa CSS senza le classi nuove. (Maggio 2026: bug zebra
  # striping del WeeklyRoomTimetable invisibile in prod proprio per questo.)
  newest_src=$(find frontend/src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.json' \) -print0 2>/dev/null | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1)
  newest_dist=$(find frontend/dist -type f \( -name '*.js' -o -name '*.css' -o -name 'index.html' \) -print0 2>/dev/null | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1)
  if [[ -n "$newest_src" && -n "$newest_dist" && "$newest_src" -gt "$newest_dist" ]]; then
    red "[ERR] --no-build rifiutato: frontend/src ha file modificati DOPO l'ultima build."
    red "      Il dist pubblicato sarebbe obsoleto (es. classi Tailwind purgate fuori)."
    yellow "      Lancia ./deploy.sh senza --no-build, oppure 'npm --prefix frontend run build' a mano."
    exit 1
  fi
  green "    ✓ dist attuale (build presunta valida — niente file src piu' recenti)"
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
blue "[2/9] Calcolo modifiche da inviare al VPS (dry-run)…"
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
blue "[3/9] Verifica versioni moduli (lock-based, locale vs server)…"

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
# 5. Snapshot hash del lockfile remoto PRIMA del rsync.
#    Serve per determinare a [6/8] se le dep sono cambiate. Se lo facessimo
#    DOPO il rsync, il lockfile remoto sarebbe già stato sovrascritto da
#    quello locale e gli hash matcherebbero sempre → npm ci mai eseguito.
# ------------------------------------------------------------
LOCAL_HASH="$(shasum -a 256 backend/package-lock.json | awk '{print $1}')"
PRE_RSYNC_REMOTE_HASH="$(ssh ${SSH_OPTS} "$SSH_TARGET" "shasum -a 256 ${VPS_PATH}/backend/package-lock.json 2>/dev/null | awk '{print \$1}'" || echo "")"

# ------------------------------------------------------------
# 6. rsync vero
# ------------------------------------------------------------
if [[ "$CHANGE_COUNT" -gt 0 ]]; then
  blue "[4/9] rsync verso VPS…"
  # --info=progress2 / --progress non supportati da openrsync (Apple). Senza
  # progress il deploy funziona lo stesso, lo stdout resta più pulito.
  rsync -avz "${RSYNC_EXCLUDES[@]}" \
    -e "ssh ${SSH_OPTS}" \
    "$LOCAL_ROOT/" "${SSH_TARGET}:${VPS_PATH}/"
  green "    ✓ codice trasferito"
else
  blue "[4/9] rsync saltato (nessuna modifica)"
fi

# ------------------------------------------------------------
# 6b. Normalizzazione permessi (idempotente) di tutti i path serviti da nginx.
#    rsync preserva i mode dal Mac (umask locale del filesystem). Se una
#    dir finisce a 700, l'utente www-data di nginx non può attraversarla
#    → 500 Internal Server Error sui file statici, 404 sugli alias.
#    Path coperti:
#      - frontend/dist   (SPA + /assets/*, /sw.js, /manifest.webmanifest)
#      - frontend/public (alias /logo-app/* — logo custom dell'istituto)
#      - backend/uploads (alias /storage/* — upload utente, poster concerti)
#    Forziamo 755 sulle dir e 644 sui file. Sempre, anche se rsync non
#    ha toccato nulla, per recuperare da stati pregressi.
# ------------------------------------------------------------
blue "[5/9] Normalizzo permessi statici sul VPS (dist + public + uploads)…"
ssh ${SSH_OPTS} "$SSH_TARGET" "
  # Path padre — nginx deve poterli attraversare
  chmod 755 '${VPS_PATH}' '${VPS_PATH}/frontend' '${VPS_PATH}/backend' 2>/dev/null || true
  # frontend/dist
  if [ -d '${VPS_PATH}/frontend/dist' ]; then
    chmod 755 '${VPS_PATH}/frontend/dist'
    find '${VPS_PATH}/frontend/dist' -type d -exec chmod 755 {} +
    find '${VPS_PATH}/frontend/dist' -type f -exec chmod 644 {} +
  fi
  # frontend/public (esposto da nginx come /logo-app/, /assets-public/, ecc.)
  if [ -d '${VPS_PATH}/frontend/public' ]; then
    chmod 755 '${VPS_PATH}/frontend/public'
    find '${VPS_PATH}/frontend/public' -type d -exec chmod 755 {} +
    find '${VPS_PATH}/frontend/public' -type f -exec chmod 644 {} +
  fi
  # backend/uploads (esposto come /storage/ — escluso dal rsync ma il parent backend/
  # può comunque essere chiuso a 700 dopo un deploy passato)
  if [ -d '${VPS_PATH}/backend/uploads' ]; then
    chmod 755 '${VPS_PATH}/backend/uploads'
    find '${VPS_PATH}/backend/uploads' -type d -exec chmod 755 {} +
    find '${VPS_PATH}/backend/uploads' -type f -exec chmod 644 {} +
  fi
" >/dev/null
green "    ✓ permessi normalizzati (755 dir · 644 file)"

# ------------------------------------------------------------
# 7. npm ci --omit=dev se package-lock.json del backend è cambiato.
#    Confronto basato sull'hash remoto SNAPSHOTTED prima del rsync (vedi 5).
# ------------------------------------------------------------
blue "[6/9] Verifico se le dipendenze backend sono cambiate…"
if [[ "$LOCAL_HASH" == "$PRE_RSYNC_REMOTE_HASH" ]]; then
  green "    ✓ package-lock invariato, niente npm ci"
else
  yellow "    package-lock cambiato → npm ci --omit=dev sul VPS…"
  ssh ${SSH_OPTS} "$SSH_TARGET" "cd ${VPS_PATH}/backend && npm ci --omit=dev"
  green "    ✓ dipendenze backend aggiornate"
fi

# ------------------------------------------------------------
# 7. PgBouncer: assicura il transaction pooler attivo sul VPS (idempotente).
#    Lo script di setup è già stato trasferito dal rsync. Strategia:
#      - --skip-pgbouncer       → non fare nulla
#      - default                → configura SOLO se pgbouncer non è già attivo
#      - --setup-pgbouncer      → riesegui il setup anche se già attivo
#    setup-pgbouncer.sh gira come root: usiamo `sudo -n` (no prompt). Se manca
#    il sudo passwordless non blocchiamo il deploy, stampiamo il comando manuale.
#    Lo script stesso flippa DB_PORT→6432 nel .env del VPS e riavvia PM2; il
#    restart [8/9] qui sotto è quindi un secondo restart (innocuo) solo la prima
#    volta. L'healthcheck [9/9] valida l'intero percorso app→PgBouncer→Postgres.
# ------------------------------------------------------------
blue "[7/9] PgBouncer su VPS (transaction pooling)…"
if [[ "$SKIP_PGBOUNCER" -eq 1 ]]; then
  yellow "    saltato (--skip-pgbouncer)"
else
  PGB_ACTIVE="$(ssh ${SSH_OPTS} "$SSH_TARGET" "systemctl is-active pgbouncer 2>/dev/null || true")"
  if [[ "$PGB_ACTIVE" == "active" && "$SETUP_PGBOUNCER" -eq 0 ]]; then
    green "    ✓ PgBouncer già attivo sul VPS (nessuna azione · usa --setup-pgbouncer per riconfigurare)"
  else
    if [[ "$PGB_ACTIVE" == "active" ]]; then
      yellow "    PgBouncer attivo → riconfigurazione forzata (--setup-pgbouncer)…"
    else
      yellow "    PgBouncer non attivo → configurazione automatica via setup-pgbouncer.sh…"
    fi
    if ssh ${SSH_OPTS} "$SSH_TARGET" "sudo -n bash ${VPS_PATH}/scripts/setup-pgbouncer.sh"; then
      green "    ✓ PgBouncer configurato e attivo"
    else
      red    "    ✗ Setup PgBouncer non riuscito (probabile: sudo richiede password sul VPS)."
      yellow "      Lancialo a mano UNA volta, poi i deploy successivi lo troveranno già attivo:"
      yellow "        ssh ${SSH_TARGET} 'sudo bash ${VPS_PATH}/scripts/setup-pgbouncer.sh'"
      yellow "      Il deploy prosegue: l'app resta su Postgres diretto (:5432) finché non lo esegui."
    fi
  fi
fi

# ------------------------------------------------------------
# 8. Restart PM2
# ------------------------------------------------------------
blue "[8/9] Restart backend (pm2)…"
ssh ${SSH_OPTS} "$SSH_TARGET" "pm2 restart cadenza-backend --update-env >/dev/null && pm2 status cadenza-backend --no-color | tail -3"

# ------------------------------------------------------------
# 9. Healthcheck robusto: /api/ready (testa anche connessione DB e
#    quindi indirettamente la riuscita delle preSyncMigrations).
#    5 tentativi con sleep 3s tra uno e l'altro = fino a ~15s di tolleranza
#    per gestire restart PM2 lenti + sync schema iniziale. Accetta SOLO 200.
#    Se PM2 boota e crasha per migration fallita (es. colonna mancante)
#    questo loop lo intercetta entro pochi secondi, invece di dichiarare
#    "deploy completo" mentre il backend è in restart loop infinito.
# ------------------------------------------------------------
blue "[9/9] Healthcheck post-deploy (/api/ready · max 5 tentativi)…"
HEALTH_OK=0
HEALTH_HTTP=""
HEALTH_BODY=""
for attempt in 1 2 3 4 5; do
  sleep 3
  # `|| true`: durante il restart PM2 il backend può non ascoltare ancora →
  # curl esce 7 (connection refused) e con `set -e` la command-substitution
  # abortirebbe l'intero script (falso fallimento, exit 7) vanificando i retry.
  # Con `|| true` HEALTH_RESP resta "000" e il loop riprova come previsto.
  HEALTH_RESP=$(ssh ${SSH_OPTS} "$SSH_TARGET" "curl -s -o /tmp/cadenza-health.json -w '%{http_code}' http://127.0.0.1:3000/api/ready && cat /tmp/cadenza-health.json && rm -f /tmp/cadenza-health.json") || true
  # La prima riga è il codice HTTP (3 cifre), il resto è il body JSON.
  HEALTH_HTTP="${HEALTH_RESP:0:3}"
  HEALTH_BODY="${HEALTH_RESP:3}"
  if [[ "$HEALTH_HTTP" == "200" ]]; then
    HEALTH_OK=1
    green "    ✓ backend pronto al tentativo ${attempt} (HTTP 200, DB raggiungibile)"
    break
  fi
  yellow "    tentativo ${attempt}/5: HTTP ${HEALTH_HTTP:-?}, riprovo tra 3s…"
done

if [[ "$HEALTH_OK" -eq 0 ]]; then
  red "    ✗ backend non pronto dopo 5 tentativi (ultimo HTTP $HEALTH_HTTP)"
  if [[ -n "$HEALTH_BODY" ]]; then
    red "      Body risposta: $HEALTH_BODY"
  fi
  red ""
  red "      Ultime 30 righe dei log:"
  ssh ${SSH_OPTS} "$SSH_TARGET" "pm2 logs cadenza-backend --lines 30 --nostream 2>/dev/null" \
    | sed 's/^/        /' || true
  red ""
  red "      Diagnosi rapida lato VPS:"
  red "        ssh ${SSH_TARGET} 'pm2 list'"
  red "        ssh ${SSH_TARGET} 'pm2 logs cadenza-backend --lines 100 --nostream'"
  exit 1
fi

green ""
green "🎉 Deploy completo: http://${VPS_HOST}"
