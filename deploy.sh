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
#   0b. Snapshot pulito del ref (git archive HEAD, override --ref=<x>) in una
#      dir temporanea: il deploy parte da lì, MAI dal working tree → niente
#      file non committati/non tracciati spediti in prod
#   1. Build frontend DENTRO lo snapshot (typecheck + bundle da codice committato)
#   2. Mostra cosa cambierebbe sul VPS (dry-run) e chiede conferma
#   3. Verifica che il server NON abbia moduli più moderni del locale
#      (in tal caso annulla il deploy per non regredire il VPS)
#   4. Snapshot del codice ATTUALE sul VPS (backend + frontend/dist, senza
#      node_modules/uploads/data/backups/.env) in <releases>/<timestamp>-<sha>/
#      con hardlink (costo ~0), registro "LAST", ultimi 3 conservati. Poi:
#      dist nuova copiata in frontend/.dist-new (NON ancora live), poi rsync
#      del codice. Dist live e processo PM2 restano quelli vecchi.
#   5. Normalizza i permessi dei path serviti da nginx (dist in staging, public,
#      uploads): rsync preserva i mode del Mac → dir con 700 farebbero crashare
#      nginx (500 EACCES sui file statici, 404 sugli alias)
#   6. npm ci --omit=dev sul backend del VPS solo se package-lock.json è cambiato
#   7. PgBouncer: assicura che il transaction pooler sia attivo sul VPS.
#      Idempotente — la PRIMA volta installa+configura via
#      scripts/setup-pgbouncer.sh (appena trasferito col rsync); ai deploy
#      successivi, se pgbouncer è già attivo, non fa nulla. Richiede sudo
#      passwordless sul VPS (lo script gira come root): se manca, il deploy
#      prosegue e stampa il comando da lanciare a mano una volta.
#   7b. Chiave di cifratura + re-encrypt settings (prima del restart)
#   8. In UN SOLO comando remoto: swap atomico della dist (rename di
#      .dist-new → dist) + pm2 restart cadenza-backend. La finestra di stato
#      misto (frontend nuovo / backend vecchio) è ridotta a pochi ms.
#   9. Healthcheck robusto (/api/ready, 5 retry × 3s) — verifica anche DB
#      connesso, così intercetta migrazioni schema fallite invece di
#      dichiarare deploy OK mentre il backend è in restart loop.
#      Se fallisce: ROLLBACK AUTOMATICO allo snapshot del punto 4 (ripristina
#      backend+dist, npm ci col lock precedente se differiva, pm2 restart,
#      nuovo healthcheck). Disattivabile con --no-rollback.
#
# Resilienza di rete: ogni passo ssh/rsync è ritentato 3 volte con backoff
# (5s, 15s) sugli errori di connessione (ssh 255, rsync 10/12/30/35), con
# ConnectionAttempts e ServerAlive*. Se un passo fallisce comunque, lo script
# stampa in che stato è rimasto il VPS e i comandi per riprendere o tornare
# indietro.
#
# Uso:
#   ./deploy.sh                 # deploy interattivo con conferma
#   ./deploy.sh --yes           # senza conferma (per CI o uso rapido)
#   ./deploy.sh --no-build      # salta la build frontend (se l'hai già fatta)
#   ./deploy.sh --update-deps   # prima del deploy: npm outdated + scelta y/N per workspace
#   ./deploy.sh --skip-pgbouncer    # non toccare PgBouncer su questo deploy
#   ./deploy.sh --setup-pgbouncer   # forza la riesecuzione del setup PgBouncer (anche se già attivo)
#   ./deploy.sh --ref=<commit/tag>  # deploya un ref specifico invece di HEAD
#   ./deploy.sh --no-rollback       # healthcheck KO → NON fare il rollback automatico
#   ./deploy.sh --rollback          # torna all'ultimo snapshot (chiede conferma)
#   ./deploy.sh --rollback --yes    # idem, senza conferma
#   ./deploy.sh --rollback --snapshot=<nome>   # torna a uno snapshot specifico
# ============================================================

# Alias definito in ~/.ssh/config (HostName + User + IdentityFile lì).
# Cambiando server o utente si aggiorna solo ~/.ssh/config, non lo script.
VPS_HOST_ALIAS="cadenza-vps"
# Gli override CADENZA_DEPLOY_* esistono per il test di simulazione
# (scripts/test-deploy-simulation.sh); in produzione non vanno impostati.
VPS_PATH="${CADENZA_DEPLOY_VPS_PATH:-/home/cadenza/cadenza}"
VPS_RELEASES="${CADENZA_DEPLOY_RELEASES:-$(dirname "$VPS_PATH")/releases}"

LOCAL_ROOT="$(cd "$(dirname "$0")" && pwd)"
SSH_TARGET="$VPS_HOST_ALIAS"
# ConnectionAttempts: ritenta il connect TCP; ConnectTimeout: non restare appesi;
# ServerAlive*: una connessione morta a metà trasferimento fallisce in ~45s
# invece di restare appesa (e quindi il retry parte).
SSH_OPTS="-o ConnectionAttempts=3 -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3"
RETRY_MAX=3
RETRY_BASE_SLEEP="${CADENZA_DEPLOY_RETRY_SLEEP:-5}"   # backoff: base, base*3
HEALTH_SLEEP="${CADENZA_DEPLOY_HEALTH_SLEEP:-3}"

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
DEPLOY_REF="HEAD"
ROLLBACK_ENABLED=1
ROLLBACK_MANUAL=0
ROLLBACK_SNAPSHOT=""
for arg in "$@"; do
  case "$arg" in
    --yes|-y)          AUTO_YES=1 ;;
    --no-build)        SKIP_BUILD=1 ;;
    --update-deps)     UPDATE_DEPS=1 ;;
    --skip-pgbouncer)  SKIP_PGBOUNCER=1 ;;
    --setup-pgbouncer) SETUP_PGBOUNCER=1 ;;
    --ref=*)           DEPLOY_REF="${arg#--ref=}" ;;
    --no-rollback)     ROLLBACK_ENABLED=0 ;;
    --rollback)        ROLLBACK_MANUAL=1 ;;
    --snapshot=*)      ROLLBACK_SNAPSHOT="${arg#--snapshot=}" ;;
    --help|-h)         awk 'NR>1 && /^# =+$/ {c++; if (c==2) exit} NR>1 {print}' "$0"; exit 0 ;;
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
# Stato del VPS + report di uscita.
# STATE_MSG descrive ESATTAMENTE cosa è stato toccato sul VPS; viene aggiornato
# prima di ogni passo che modifica qualcosa. Se lo script esce con errore
# (rete persa dopo i retry, healthcheck KO, Ctrl+C…) l'EXIT trap lo stampa
# insieme ai comandi per riprendere o tornare indietro.
# ------------------------------------------------------------
STATE_MSG="VPS NON modificato (nessun file scritto, PM2 invariato)."
STATE_TOUCHED=0     # 1 = almeno un file sul VPS è stato scritto
SNAP_NAME=""        # snapshot creato da QUESTO deploy (vuoto = nessuno)
DEPLOY_SRC=""
DEPLOY_SHA=""

on_exit() {
  local rc=$?
  trap - EXIT
  if [[ -n "$DEPLOY_SRC" && -d "$DEPLOY_SRC" ]]; then rm -rf "$DEPLOY_SRC"; fi
  if [[ "$rc" -ne 0 ]]; then
    printf '\n'
    red "══ DEPLOY INTERROTTO (exit ${rc}) ══"
    red "Stato del VPS: ${STATE_MSG}"
    if [[ "$STATE_TOUCHED" -eq 0 ]]; then
      yellow "Puoi rilanciare tranquillamente: ./deploy.sh"
    else
      if [[ -n "$SNAP_NAME" ]]; then
        yellow "Snapshot disponibile: ${VPS_RELEASES}/${SNAP_NAME}"
      fi
      yellow "Per RIPRENDERE (tutti i passi sono idempotenti):"
      yellow "  ./deploy.sh --ref=${DEPLOY_SHA:-HEAD} --yes"
      yellow "Per TORNARE al codice precedente (ultimo snapshot):"
      yellow "  ./deploy.sh --rollback"
      yellow "Per controllare a mano lo stato:"
      yellow "  ssh ${SSH_TARGET} 'pm2 list; ls -la ${VPS_RELEASES}'"
    fi
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ------------------------------------------------------------
# net_retry <etichetta> <comando…>
# Esegue il comando fino a RETRY_MAX volte con backoff (base, base*3) SOLO se
# fallisce per un errore di rete/connessione: ssh 255, rsync 10 (socket),
# 12 (stream), 30/35 (timeout). Altri exit code (comando remoto fallito,
# rsync 23 ecc.) sono deterministici → nessun retry, ritorna subito.
# I messaggi vanno su stderr così $(…) cattura solo l'output del comando.
# Tutti i comandi passati devono essere idempotenti.
# ------------------------------------------------------------
net_retry() {
  local label="$1"; shift
  local i rc=0 wait
  for ((i = 1; i <= RETRY_MAX; i++)); do
    rc=0
    "$@" || rc=$?
    if [[ "$rc" -eq 0 ]]; then return 0; fi
    case "$rc" in
      255|10|12|30|35) ;;
      *) return "$rc" ;;
    esac
    if [[ "$i" -lt "$RETRY_MAX" ]]; then
      wait=$((RETRY_BASE_SLEEP * (i == 1 ? 1 : 3)))
      yellow "    ⚠ ${label}: errore di rete (exit ${rc}), tentativo ${i}/${RETRY_MAX} fallito, riprovo tra ${wait}s…" >&2
      sleep "$wait"
    else
      red "    ✗ ${label}: errore di rete (exit ${rc}) dopo ${RETRY_MAX} tentativi" >&2
    fi
  done
  return "$rc"
}

# ------------------------------------------------------------
# Script remoto: inviato via `ssh … bash -s -- <azione> <VPS_PATH> <RELEASES> …`
# (stdin), così non dipende da file preinstallati sul VPS e gira identico in
# deploy, rollback automatico e rollback manuale. Azioni:
#   snapshot <sha> [protetto]  snapshot hardlink del codice attuale, aggiorna LAST, pota
#   info [nome]                stampa nome+META dello snapshot (default: LAST)
#   restore <nome>             ripristina backend + dist (in .dist-new) dallo snapshot
#   perms <dist|.dist-new>     normalizza i permessi dei path serviti da nginx
#   npm_ci                     npm ci --omit=dev nel backend
#   swap_restart               rename .dist-new→dist + pm2 restart (un solo comando)
#   mark_deployed <sha>        registra lo sha ora in produzione
# ------------------------------------------------------------
read -r -d '' REMOTE_SCRIPT <<'REMOTE' || true
set -euo pipefail
ACTION="${1:?azione mancante}"; VPS="${2:?VPS_PATH mancante}"; REL="${3:?RELEASES mancante}"
shift 3
case "$VPS" in /?*) ;; *) echo "VPS_PATH non valido: '$VPS'" >&2; exit 64 ;; esac
case "$REL" in /?*) ;; *) echo "RELEASES non valido: '$REL'" >&2; exit 64 ;; esac
KEEP="${CADENZA_KEEP:-3}"
SNAP_RE='^[0-9]{8}-[0-9]{6}-[A-Za-z0-9._-]+$'
# Stato runtime del VPS: mai nello snapshot, mai toccato dal restore.
BK_EXCL=(--exclude 'node_modules/' --exclude '/uploads/' --exclude '/data/' --exclude '/backups/'
         --exclude '/secrets/' --exclude '/reports/' --exclude '/.claude/'
         --exclude '/.env' --exclude '/.env.*' --exclude '*.log' --exclude 'coverage/')
valid_name() { [[ "$1" =~ $SNAP_RE ]]; }

prune() {
  local protect="${1:-}" pend="" all=() d n i
  if [ -d "$REL" ]; then
    pend="$(cat "$REL/PENDING" 2>/dev/null || true)"
    while IFS= read -r d; do all+=("$d"); done < <( (cd "$REL" && ls -1 | grep -E '^[0-9]{8}-[0-9]{6}-' | sort) || true )
    n=${#all[@]}
    if [ "$n" -gt "$KEEP" ]; then
      for ((i = 0; i < n - KEEP; i++)); do
        d="${all[$i]}"
        if [ -n "$d" ] && [ "$d" != "$protect" ] && [ "$d" != "$pend" ] && valid_name "$d" && [ -d "$REL/$d" ]; then
          rm -rf -- "${REL:?}/$d"
          echo "potato snapshot vecchio: $d"
        fi
      done
    fi
    find "$REL" -maxdepth 1 -name '.partial-*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
  fi
}

case "$ACTION" in
  snapshot)
    sha="${1:-unknown}"; protect="${2:-}"; force="${3:-}"
    [[ "$sha" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "sha non valido" >&2; exit 64; }
    # PENDING = snapshot dell'ultimo stato SANO, scritto all'inizio di un deploy
    # e cancellato solo quando il deploy (o un rollback) si conclude bene. Se un
    # deploy precedente è rimasto a metà, NON si fa un nuovo snapshot (fotograferebbe
    # lo stato misto e diventerebbe il bersaglio del rollback): si riusa quello sano.
    if [ "$force" != "force" ] && [ -f "$REL/PENDING" ]; then
      pend="$(cat "$REL/PENDING" 2>/dev/null || true)"
      if [ -n "$pend" ] && valid_name "$pend" && [ -d "$REL/$pend/backend" ]; then
        echo "SNAPSHOT_REUSED=1"
        echo "SNAPSHOT_NAME=$pend"
        exit 0
      fi
    fi
    ts="${CADENZA_SNAP_TS:-$(date +%Y%m%d-%H%M%S)}"
    name="${ts}-${sha}"; n=0
    while [ -e "$REL/$name" ]; do n=$((n + 1)); name="${ts}-${sha}-${n}"; done
    mkdir -p "$REL"
    tmp="$REL/.partial-$name"
    rm -rf "$tmp"
    mkdir -p "$tmp/backend"
    # --link-dest=<sorgente>: i file identici diventano hardlink (costo ~0).
    # rsync scrive i file nuovi via temp+rename → lo snapshot NON viene mai
    # modificato dai deploy successivi.
    rsync -a --link-dest="$VPS/backend/" "${BK_EXCL[@]}" "$VPS/backend/" "$tmp/backend/"
    if [ -d "$VPS/frontend/dist" ]; then
      mkdir -p "$tmp/frontend/dist"
      rsync -a --link-dest="$VPS/frontend/dist/" "$VPS/frontend/dist/" "$tmp/frontend/dist/"
    fi
    {
      echo "created=$ts"
      echo "before_deploy=$sha"
      echo "contains_sha=$(cat "$REL/DEPLOYED_SHA" 2>/dev/null || echo unknown)"
    } > "$tmp/META"
    mv "$tmp" "$REL/$name"
    printf '%s\n' "$name" > "$REL/.LAST.tmp"
    mv "$REL/.LAST.tmp" "$REL/LAST"
    if [ "$force" != "force" ]; then printf '%s\n' "$name" > "$REL/PENDING"; fi
    prune "$protect"
    echo "SNAPSHOT_NAME=$name"
    ;;
  info)
    want="${1:-}"
    if [ -z "$want" ]; then want="$(cat "$REL/LAST" 2>/dev/null || true)"; fi
    if [ -z "$want" ] || ! valid_name "$want" || [ ! -d "$REL/$want/backend" ]; then
      echo "Nessuno snapshot utilizzabile (${want:-LAST vuoto}) in $REL" >&2; exit 3
    fi
    echo "NAME=$want"
    sed 's/^/META /' "$REL/$want/META" 2>/dev/null || true
    echo "ALL=$( (cd "$REL" && ls -1 | grep -E '^[0-9]{8}-[0-9]{6}-' | sort | tr '\n' ' ') || true )"
    ;;
  restore)
    name="${1:?nome snapshot mancante}"
    valid_name "$name" || { echo "nome snapshot non valido" >&2; exit 64; }
    S="$REL/$name"
    [ -d "$S/backend" ] || { echo "snapshot $name non trovato" >&2; exit 3; }
    lockchg=0
    if ! cmp -s "$S/backend/package-lock.json" "$VPS/backend/package-lock.json"; then lockchg=1; fi
    # 1) file dello snapshot sopra il backend live (stato runtime escluso).
    #    -c (checksum): il quick-check size+mtime potrebbe saltare un file diverso
    #    ma con stessa dimensione e stesso secondo di mtime; in un rollback no.
    rsync -ac "${BK_EXCL[@]}" "$S/backend/" "$VPS/backend/"
    # 2) rimuove i file aggiunti dal rilascio fallito, ma SOLO nelle cartelle di
    #    codice (mai --delete sulla root del backend: contiene stato runtime).
    for d in config lib middleware migrations models routes seeders seeders-cli services scripts; do
      if [ -d "$S/backend/$d" ]; then rsync -a --delete "$S/backend/$d/" "$VPS/backend/$d/"; fi
    done
    # 3) dist dello snapshot preparata in .dist-new (lo swap avviene in swap_restart)
    if [ -d "$S/frontend/dist" ]; then
      rm -rf "$VPS/frontend/.dist-new"
      rsync -a --link-dest="$S/frontend/dist/" "$S/frontend/dist/" "$VPS/frontend/.dist-new/"
    fi
    prev="$(sed -n 's/^contains_sha=//p' "$S/META" 2>/dev/null || true)"
    if [ -n "$prev" ] && [ "$prev" != "unknown" ]; then printf '%s\n' "$prev" > "$REL/DEPLOYED_SHA"; fi
    rm -f "$REL/PENDING"
    echo "LOCKCHG=$lockchg"
    ;;
  perms)
    which_dist="${1:-dist}"
    case "$which_dist" in dist|.dist-new) ;; *) echo "perms: argomento non valido" >&2; exit 64 ;; esac
    chmod 755 "$VPS" "$VPS/frontend" "$VPS/backend" 2>/dev/null || true
    for dir in "$VPS/frontend/$which_dist" "$VPS/frontend/public" "$VPS/backend/uploads"; do
      if [ -d "$dir" ]; then
        chmod 755 "$dir"
        find "$dir" -type d -exec chmod 755 {} +
        find "$dir" -type f -exec chmod 644 {} +
      fi
    done
    ;;
  npm_ci)
    cd "$VPS/backend" && npm ci --omit=dev
    ;;
  swap_restart)
    # HUP ignorato: se la connessione cade a metà, il comando remoto finisce lo stesso.
    trap '' HUP PIPE
    cd "$VPS/frontend"
    if [ -d .dist-new ]; then
      rm -rf .dist-old
      if [ -d dist ]; then mv dist .dist-old; fi
      mv .dist-new dist
      rm -rf .dist-old
    fi
    pm2 restart cadenza-backend --update-env >/dev/null && pm2 status cadenza-backend --no-color | tail -3
    ;;
  mark_deployed)
    sha="${1:?sha mancante}"
    [[ "$sha" =~ ^[A-Za-z0-9._-]+$ ]] || exit 64
    mkdir -p "$REL"; printf '%s\n' "$sha" > "$REL/DEPLOYED_SHA"; rm -f "$REL/PENDING"
    ;;
  *) echo "azione sconosciuta: $ACTION" >&2; exit 64 ;;
esac
REMOTE

# rcall <azione> [args…] — esegue l'azione sullo script remoto (un solo
# tentativo; i retry li gestisce il chiamante con net_retry).
rcall() {
  local cmd="bash -s -- '$1' '$VPS_PATH' '$VPS_RELEASES'" a
  shift
  for a in "$@"; do cmd+=" '$a'"; done
  ssh ${SSH_OPTS} "$SSH_TARGET" "$cmd" <<<"$REMOTE_SCRIPT"
}

# ------------------------------------------------------------
# Healthcheck: /api/ready, 5 tentativi × HEALTH_SLEEP. Accetta SOLO 200.
# Imposta HEALTH_HTTP / HEALTH_BODY. Ritorna 0 se pronto, 1 altrimenti.
# ------------------------------------------------------------
HEALTH_HTTP=""
HEALTH_BODY=""
run_healthcheck() {
  local attempt HEALTH_RESP
  HEALTH_HTTP=""; HEALTH_BODY=""
  for attempt in 1 2 3 4 5; do
    sleep "$HEALTH_SLEEP"
    # `|| true`: durante il restart PM2 il backend può non ascoltare ancora →
    # curl esce 7 (connection refused) e con `set -e` la command-substitution
    # abortirebbe l'intero script (falso fallimento, exit 7) vanificando i retry.
    # Con `|| true` HEALTH_RESP resta vuota e il loop riprova come previsto.
    HEALTH_RESP=$(ssh ${SSH_OPTS} "$SSH_TARGET" "curl --connect-timeout 3 --max-time 8 -s -o /tmp/cadenza-health.json -w '%{http_code}' http://127.0.0.1:3000/api/ready && cat /tmp/cadenza-health.json && rm -f /tmp/cadenza-health.json") || true
    # I primi 3 caratteri sono il codice HTTP, il resto è il body JSON.
    HEALTH_HTTP="${HEALTH_RESP:0:3}"
    HEALTH_BODY="${HEALTH_RESP:3}"
    if [[ "$HEALTH_HTTP" == "200" ]]; then
      green "    ✓ backend pronto al tentativo ${attempt} (HTTP 200, DB raggiungibile)"
      return 0
    fi
    yellow "    tentativo ${attempt}/5: HTTP ${HEALTH_HTTP:-?}, riprovo tra ${HEALTH_SLEEP}s…"
  done
  return 1
}

# restore_and_restart <snapshot> — ripristina backend+dist dallo snapshot,
# npm ci se il lock differiva, swap dist + pm2 restart. Non fa l'healthcheck.
restore_and_restart() {
  local snap="$1" out
  STATE_TOUCHED=1
  STATE_MSG="ripristino da snapshot ${snap} in corso: backend potenzialmente misto (file ripristinati solo in parte)."
  out="$(net_retry "ripristino file da snapshot" rcall restore "$snap")" || return 1
  printf '%s\n' "$out" | sed 's/^/      /'
  if printf '%s\n' "$out" | grep -q '^LOCKCHG=1'; then
    yellow "    package-lock differiva → npm ci --omit=dev col lock precedente…"
    STATE_MSG="file ripristinati dallo snapshot ${snap}; node_modules NON ancora riallineati al lock precedente (npm ci in corso o fallito); PM2 non riavviato."
    net_retry "npm ci (rollback)" rcall npm_ci || return 1
  fi
  STATE_MSG="file ripristinati dallo snapshot ${snap}; swap dist + restart PM2 non confermati (in corso o falliti)."
  net_retry "swap dist + pm2 restart (rollback)" rcall swap_restart || return 1
  return 0
}

# ------------------------------------------------------------
# --rollback: ritorno manuale all'ultimo snapshot (o a --snapshot=<nome>).
# Prima di ripristinare salva lo stato CORRENTE come nuovo snapshot, così il
# rollback è a sua volta reversibile (rilanciando --rollback si torna indietro).
# Non richiede git né build: parla solo col VPS.
# ------------------------------------------------------------
if [[ "$ROLLBACK_MANUAL" -eq 1 ]]; then
  blue "[rollback] Lettura snapshot sul VPS…"
  RB_INFO="$(net_retry "lettura snapshot" rcall info "$ROLLBACK_SNAPSHOT")" \
    || { red "[ERR] nessuno snapshot utilizzabile sul VPS (${VPS_RELEASES})."; exit 1; }
  RB_NAME="$(printf '%s\n' "$RB_INFO" | sed -n 's/^NAME=//p')"
  printf '%s\n' "$RB_INFO" | sed 's/^/    /'
  yellow "    Ripristino di backend/ + frontend/dist da: ${VPS_RELEASES}/${RB_NAME}"
  yellow "    (node_modules/uploads/data/.env NON vengono toccati; npm ci se il lock differisce)"
  if [[ "$AUTO_YES" -eq 0 ]]; then
    if [[ ! -t 0 ]]; then
      red "[ERR] Conferma interattiva impossibile (stdin non è un terminale). Usa --yes."
      exit 1
    fi
    read -r -p "Confermi il rollback su ${SSH_TARGET}? [y/N] " ans
    [[ "$ans" =~ ^[yY]$ ]] || { yellow "Rollback annullato."; exit 0; }
  fi
  DEPLOY_SHA="rollback"
  blue "[rollback] Snapshot di sicurezza dello stato corrente…"
  PRE_OUT="$(net_retry "snapshot di sicurezza" rcall snapshot "pre-rollback" "$RB_NAME" force)"
  PRE_NAME="$(printf '%s\n' "$PRE_OUT" | sed -n 's/^SNAPSHOT_NAME=//p')"
  [[ -n "$PRE_NAME" ]] || { red "[ERR] snapshot di sicurezza non creato, rollback annullato."; exit 1; }
  green "    ✓ stato corrente salvato in ${PRE_NAME} (per annullare il rollback: ./deploy.sh --rollback)"
  SNAP_NAME="$PRE_NAME"
  blue "[rollback] Ripristino da ${RB_NAME}…"
  restore_and_restart "$RB_NAME" \
    || { red "[ERR] rollback fallito (vedi sopra)."; exit 1; }
  blue "[rollback] Healthcheck…"
  if run_healthcheck; then
    STATE_MSG="rollback completato: VPS sul codice di ${RB_NAME}, backend healthy."
    green ""
    green "✓ Rollback completato a ${RB_NAME}: http://${VPS_HOST}"
    exit 0
  fi
  STATE_MSG="rollback applicato (codice di ${RB_NAME}) ma l'healthcheck NON passa (HTTP ${HEALTH_HTTP:-?}). Lo stato precedente al rollback è in ${PRE_NAME}."
  exit 1
fi


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
# 0b. Snapshot pulito del ref da deployare (git archive).
#     Il deploy parte da QUESTA copia, non dal working tree: così non
#     finiscono in produzione file non committati o non tracciati (bug visto
#     a maggio 2026: un index.css modificato e non committato spedito in prod).
#     Default: HEAD. Override con --ref=<commit/tag/branch>.
# ------------------------------------------------------------
git rev-parse --verify --quiet "${DEPLOY_REF}^{commit}" >/dev/null \
  || { red "[ERR] ref git non valido: $DEPLOY_REF"; exit 1; }
DEPLOY_SHA="$(git rev-parse --short "$DEPLOY_REF")"
DEPLOY_SRC="$(mktemp -d)"   # rimossa da on_exit
blue "[0/9] Snapshot pulito da ${DEPLOY_REF} (${DEPLOY_SHA})…"
git archive "$DEPLOY_REF" | tar -x -C "$DEPLOY_SRC"
# Avvisa se il working tree ha modifiche non committate (NON verranno deployate)
if ! git diff --quiet HEAD -- 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  yellow "    ⚠ Working tree con modifiche non committate: NON verranno deployate (deploy da ${DEPLOY_REF})."
fi
green "    ✓ snapshot pronto"


# ------------------------------------------------------------
# 1. Build frontend (DENTRO lo snapshot pulito, così la dist deriva solo
#    da codice committato).
# ------------------------------------------------------------
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  blue "[1/9] Build frontend (da snapshot ${DEPLOY_SHA})…"
  # Riusa node_modules del working tree via symlink: build veloce senza npm ci.
  # Rimosso prima del rsync per non spedire il symlink.
  ln -s "$LOCAL_ROOT/frontend/node_modules" "$DEPLOY_SRC/frontend/node_modules"
  ( cd "$DEPLOY_SRC/frontend" && npm run build )
  rm -f "$DEPLOY_SRC/frontend/node_modules"
  green "    ✓ build ok ($(du -sh "$DEPLOY_SRC/frontend/dist" | cut -f1))"
else
  yellow "[1/9] Build frontend SALTATA (--no-build) — dist del working tree copiata nello snapshot"
  [[ -d frontend/dist ]] || { red "[ERR] frontend/dist non esiste, non posso saltare la build"; exit 1; }
  # La build deve provenire dagli stessi sorgenti del ref archiviato.
  [[ -f "$DEPLOY_SRC/frontend/scripts/build-fingerprint.mjs" && -f "$LOCAL_ROOT/frontend/dist/.source-sha256" ]] || {
    red "[ERR] --no-build richiede una build con impronta dei sorgenti. Eseguire senza --no-build."
    exit 1
  }
  expected_source_hash=$(node "$DEPLOY_SRC/frontend/scripts/build-fingerprint.mjs")
  actual_source_hash=$(cat "$LOCAL_ROOT/frontend/dist/.source-sha256")
  if [[ "$actual_source_hash" != "$expected_source_hash" ]]; then
    red "[ERR] --no-build rifiutato: dist non corrisponde al ref selezionato."
    exit 1
  fi
  cp -R "$LOCAL_ROOT/frontend/dist" "$DEPLOY_SRC/frontend/dist"
  green "    ✓ dist verificata rispetto ai sorgenti del ref"
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
# 3. Dry-run: cosa cambierebbe? (sola lettura sul VPS)
#    Scrive su file (riscritto a ogni tentativo) e filtra DOPO: così un errore
#    di rete non viene scambiato per "niente da trasferire".
# ------------------------------------------------------------
blue "[2/9] Calcolo modifiche da inviare al VPS (dry-run)…"
DRY_RAW="$(mktemp)"
DRY_OUTPUT="$(mktemp)"
dry_run() {
  rsync -avzn --itemize-changes "${RSYNC_EXCLUDES[@]}" \
    -e "ssh ${SSH_OPTS}" \
    "$DEPLOY_SRC/" "${SSH_TARGET}:${VPS_PATH}/" > "$DRY_RAW"
}
net_retry "rsync dry-run" dry_run
grep -E '^[<>ch.*]' "$DRY_RAW" | grep -v '^cd' > "$DRY_OUTPUT" || true

CHANGE_COUNT=$(wc -l < "$DRY_OUTPUT" | tr -d ' ')

if [[ "$CHANGE_COUNT" -eq 0 ]]; then
  green "    ✓ niente da trasferire"
else
  yellow "    ${CHANGE_COUNT} file da aggiornare:"
  head -40 "$DRY_OUTPUT" | sed 's/^/      /'
  [[ "$CHANGE_COUNT" -gt 40 ]] && yellow "      … e altri $((CHANGE_COUNT-40))"
fi
rm -f "$DRY_OUTPUT" "$DRY_RAW"

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
  LOCAL_LOCK="$DEPLOY_SRC/${sub}/package-lock.json"
  if [[ ! -f "$LOCAL_LOCK" ]]; then
    yellow "    ${sub}/package-lock.json mancante in locale, salto controllo"
    continue
  fi
  REMOTE_LOCK="$(mktemp)"
  net_retry "lettura lockfile remoto" ssh ${SSH_OPTS} "$SSH_TARGET" "cat ${VPS_PATH}/${sub}/package-lock.json 2>/dev/null || true" > "$REMOTE_LOCK"
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
  if [[ ! -t 0 ]]; then
    red "[ERR] Conferma interattiva impossibile (stdin non è un terminale). Usa --yes per procedere senza conferma."
    exit 1
  fi
  read -r -p "Procedo con il deploy su ${SSH_TARGET}? [y/N] " ans
  [[ "$ans" =~ ^[yY]$ ]] || { yellow "Deploy annullato."; exit 0; }
fi

# ------------------------------------------------------------
# 5. Hash del lockfile remoto PRIMA di toccare il codice.
#    Serve per determinare a [6/9] se le dep sono cambiate. Se lo facessimo
#    DOPO il rsync, il lockfile remoto sarebbe già stato sovrascritto da
#    quello locale e gli hash matcherebbero sempre → npm ci mai eseguito.
# ------------------------------------------------------------
LOCAL_HASH="$(shasum -a 256 "$DEPLOY_SRC/backend/package-lock.json" | awk '{print $1}')"
PRE_RSYNC_REMOTE_HASH="$(net_retry "hash lockfile remoto" ssh ${SSH_OPTS} "$SSH_TARGET" "shasum -a 256 ${VPS_PATH}/backend/package-lock.json 2>/dev/null | awk '{print \$1}'; true")"

# ------------------------------------------------------------
# 6. Trasferimento. Ordine pensato per ridurre lo stato misto:
#      a) snapshot del codice attuale sul VPS (hardlink, rete non usata)
#      b) dist nuova in frontend/.dist-new (NON live)
#      c) rsync del codice (backend & co., SENZA dist)
#      ... permessi, npm ci, pgbouncer, chiave ...
#      d) swap dist + pm2 restart in un solo comando remoto (step 8)
#    Ciò che finisce in produzione è identico a prima (stessi esclusi, dist
#    mirrorata esatta con --delete); cambia solo QUANDO la dist diventa live.
# ------------------------------------------------------------
if [[ "$CHANGE_COUNT" -gt 0 ]]; then
  blue "[4/9] Snapshot del codice attuale sul VPS (hardlink, ultimi 3)…"
  STATE_MSG="VPS NON modificato (snapshot di sicurezza in corso: toccata solo la cartella ${VPS_RELEASES})."
  SNAP_OUT="$(net_retry "snapshot VPS" rcall snapshot "$DEPLOY_SHA")"
  SNAP_NAME="$(printf '%s\n' "$SNAP_OUT" | sed -n 's/^SNAPSHOT_NAME=//p')"
  printf '%s\n' "$SNAP_OUT" | grep '^potato' | sed 's/^/    /' || true
  [[ -n "$SNAP_NAME" ]] || { red "[ERR] snapshot di sicurezza non creato: deploy annullato (VPS non modificato)."; exit 1; }
  if printf '%s\n' "$SNAP_OUT" | grep -q '^SNAPSHOT_REUSED=1'; then
    yellow "    ↺ un deploy precedente non si era concluso: riuso lo snapshot sano ${SNAP_NAME} (non fotografo lo stato misto)"
  else
    green "    ✓ snapshot ${SNAP_NAME}"
  fi
  STATE_MSG="snapshot ${SNAP_NAME} creato; codice, dist LIVE e PM2 INVARIATI."

  # b) dist nuova in staging. --delete: .dist-new è un mirror esatto della dist
  #    locale (stessa semantica del vecchio prune); --link-dest=dist live: i file
  #    identici non vengono ritrasferiti né duplicati su disco.
  if [[ -f "$DEPLOY_SRC/frontend/dist/index.html" ]]; then
    blue "    Copia dist nuova in frontend/.dist-new (staging, non ancora live)…"
    STATE_MSG="copia della dist in frontend/.dist-new interrotta: dist LIVE, codice backend e PM2 INVARIATI (resta solo una .dist-new parziale, innocua). Snapshot ${SNAP_NAME} creato."
    stage_dist() {
      rsync -avz --delete --link-dest="${VPS_PATH}/frontend/dist/" \
        -e "ssh ${SSH_OPTS}" \
        "$DEPLOY_SRC/frontend/dist/" "${SSH_TARGET}:${VPS_PATH}/frontend/.dist-new/"
    }
    net_retry "rsync dist (staging)" stage_dist
    green "    ✓ dist in staging (chunk orfani esclusi per costruzione)"
    STATE_MSG="dist nuova pronta in frontend/.dist-new; dist LIVE, codice backend e PM2 INVARIATI. Snapshot ${SNAP_NAME} creato."
  else
    yellow "    ⚠ dist locale assente: nessuna dist in staging (frontend remoto intatto)."
  fi

  # c) codice. --exclude /frontend/dist/: la dist viaggia solo via staging.
  blue "    rsync codice verso VPS…"
  # --info=progress2 / --progress non supportati da openrsync (Apple). Senza
  # progress il deploy funziona lo stesso, lo stdout resta più pulito.
  STATE_TOUCHED=1
  STATE_MSG="copia del CODICE interrotta: backend/ e altri file sono in parte NUOVI e in parte VECCHI; PM2 NON riavviato (gira ancora il codice vecchio in memoria); dist LIVE vecchia (la nuova è in .dist-new). Snapshot ${SNAP_NAME} creato."
  sync_code() {
    rsync -avz "${RSYNC_EXCLUDES[@]}" --exclude '/frontend/dist/' \
      -e "ssh ${SSH_OPTS}" \
      "$DEPLOY_SRC/" "${SSH_TARGET}:${VPS_PATH}/"
  }
  net_retry "rsync codice" sync_code
  green "    ✓ codice trasferito (da snapshot ${DEPLOY_SHA})"
else
  blue "[4/9] rsync saltato (nessuna modifica) — nessuno snapshot creato, rollback automatico non applicabile"
fi
PRE_RESTART_STATE="codice nuovo sul disco, PM2 NON riavviato (gira ancora il codice vecchio in memoria), dist LIVE vecchia (la nuova è in .dist-new). Snapshot ${SNAP_NAME:-assente}."
[[ "$CHANGE_COUNT" -gt 0 ]] && STATE_MSG="$PRE_RESTART_STATE"

# ------------------------------------------------------------
# 6b. Normalizzazione permessi (idempotente) di tutti i path serviti da nginx.
#    rsync preserva i mode dal Mac (umask locale del filesystem). Se una
#    dir finisce a 700, l'utente www-data di nginx non può attraversarla
#    → 500 Internal Server Error sui file statici, 404 sugli alias.
#    Path coperti:
#      - frontend/.dist-new (la dist in staging, prima dello swap; se non c'è
#        staging si normalizza la dist live)
#      - frontend/public (alias /logo-app/* — logo custom dell'istituto)
#      - backend/uploads (alias /storage/* — upload utente, poster concerti)
#    Forziamo 755 sulle dir e 644 sui file. Sempre, anche se rsync non
#    ha toccato nulla, per recuperare da stati pregressi.
# ------------------------------------------------------------
blue "[5/9] Normalizzo permessi statici sul VPS (dist + public + uploads)…"
if [[ "$CHANGE_COUNT" -gt 0 && -f "$DEPLOY_SRC/frontend/dist/index.html" ]]; then
  PERMS_TARGET=".dist-new"
else
  PERMS_TARGET="dist"
fi
net_retry "permessi" rcall perms "$PERMS_TARGET" >/dev/null
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
  STATE_MSG="npm ci interrotto: node_modules del backend potrebbe essere incompleto (il processo PM2 in esecuzione ha già i moduli in memoria). Codice nuovo su disco, PM2 NON riavviato, dist LIVE vecchia. Snapshot ${SNAP_NAME:-assente}. Rilanciare il deploy rifà npm ci."
  net_retry "npm ci" rcall npm_ci
  green "    ✓ dipendenze backend aggiornate"
  STATE_MSG="$PRE_RESTART_STATE"
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
  PGB_ACTIVE="$(net_retry "stato pgbouncer" ssh ${SSH_OPTS} "$SSH_TARGET" "systemctl is-active pgbouncer 2>/dev/null || true")"
  if [[ "$PGB_ACTIVE" == "active" && "$SETUP_PGBOUNCER" -eq 0 ]]; then
    green "    ✓ PgBouncer già attivo sul VPS (nessuna azione · usa --setup-pgbouncer per riconfigurare)"
  else
    if [[ "$PGB_ACTIVE" == "active" ]]; then
      yellow "    PgBouncer attivo → riconfigurazione forzata (--setup-pgbouncer)…"
    else
      yellow "    PgBouncer non attivo → configurazione automatica via setup-pgbouncer.sh…"
    fi
    # Qui NON si usa net_retry: lo script può aver già riavviato PM2/modificato
    # il .env prima della caduta; il fallimento è non-bloccante come sempre.
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
# 7b. Chiave di cifratura dedicata + migrazione dati (PRIMA del restart).
#    Garantisce SETTINGS_ENCRYPTION_KEY nel .env del VPS (la genera la prima
#    volta) e ri-cifra i blob esistenti dalla vecchia chiave (JWT_SECRET) alla
#    nuova. Idempotente. Eseguito PRIMA del restart così il nuovo backend, che
#    fa fail-fast se la chiave manca (lib/secrets.js), trova sempre la chiave e
#    i dati già migrati → nessun downtime. Se fallisce, il deploy si ferma QUI
#    (set -e) prima del restart: la prod resta sul processo vecchio.
# ------------------------------------------------------------
blue "[7b/9] Chiave cifratura credenziali + re-encrypt (VPS)…"
STATE_MSG="ensure-encryption-key interrotto (idempotente, rilanciabile). ${PRE_RESTART_STATE}"
net_retry "ensure-encryption-key" ssh ${SSH_OPTS} "$SSH_TARGET" "cd ${VPS_PATH}/backend && bash scripts/ensure-encryption-key.sh"
green "    ✓ chiave garantita e dati migrati"
STATE_MSG="$PRE_RESTART_STATE"

# ------------------------------------------------------------
# 8. Swap dist + restart PM2, in UN SOLO comando remoto: il frontend nuovo
#    diventa live (rename) e subito dopo parte il restart del backend. Il
#    comando remoto ignora SIGHUP: se la connessione cade a metà, finisce
#    comunque; essendo idempotente, il retry è sicuro.
# ------------------------------------------------------------
blue "[8/9] Swap dist + restart backend (pm2)…"
STATE_MSG="swap dist + restart PM2 inviati ma esito NON confermato (connessione persa?): potrebbero essere già stati eseguiti (il comando remoto ignora SIGHUP) oppure no. Verifica: ssh ${SSH_TARGET} 'pm2 list'. Snapshot ${SNAP_NAME:-assente}. Rilanciare il deploy è sicuro."
net_retry "swap dist + pm2 restart" rcall swap_restart
STATE_MSG="dist nuova LIVE e PM2 riavviato con il codice nuovo; healthcheck non ancora superato. Snapshot ${SNAP_NAME:-assente}."

# ------------------------------------------------------------
# 9. Healthcheck robusto: /api/ready (testa anche connessione DB e
#    quindi indirettamente la riuscita delle preSyncMigrations).
#    5 tentativi con sleep 3s tra uno e l'altro = fino a ~15s di tolleranza
#    per gestire restart PM2 lenti + sync schema iniziale. Accetta SOLO 200.
#    Se PM2 boota e crasha per migration fallita (es. colonna mancante)
#    questo loop lo intercetta entro pochi secondi, invece di dichiarare
#    "deploy completo" mentre il backend è in restart loop infinito.
#    Se KO e c'è uno snapshot → rollback automatico (salvo --no-rollback).
# ------------------------------------------------------------
blue "[9/9] Healthcheck post-deploy (/api/ready · max 5 tentativi)…"
if ! run_healthcheck; then
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

  if [[ "$ROLLBACK_ENABLED" -eq 1 && -n "$SNAP_NAME" ]]; then
    yellow ""
    yellow "    ↩ ROLLBACK AUTOMATICO allo snapshot ${SNAP_NAME}…"
    if restore_and_restart "$SNAP_NAME"; then
      blue "    Healthcheck dopo il rollback…"
      if run_healthcheck; then
        STATE_MSG="deploy di ${DEPLOY_SHA} FALLITO (healthcheck KO) ma rollback automatico riuscito: il VPS è tornato al codice precedente (snapshot ${SNAP_NAME}) e il backend è healthy."
        STATE_TOUCHED=0   # VPS di nuovo sano sul codice vecchio: basta rilanciare dopo aver corretto
        red "    ✗ ${STATE_MSG}"
        exit 1
      fi
      STATE_MSG="deploy di ${DEPLOY_SHA} FALLITO e ROLLBACK APPLICATO ma anche dopo il rollback l'healthcheck NON passa (HTTP ${HEALTH_HTTP:-?}). Codice ripristinato da ${SNAP_NAME}: il problema potrebbe essere ambientale (DB, .env, PgBouncer)."
    else
      STATE_MSG="deploy di ${DEPLOY_SHA} FALLITO e ROLLBACK AUTOMATICO FALLITO a metà (vedi messaggi sopra). Stato dei file incerto: usa ./deploy.sh --rollback appena la rete è ok."
    fi
    exit 1
  fi
  if [[ -z "$SNAP_NAME" ]]; then
    STATE_MSG="healthcheck KO; nessuno snapshot da questo deploy (nessun file era cambiato), rollback automatico non applicabile."
  else
    STATE_MSG="healthcheck KO; rollback automatico DISATTIVATO (--no-rollback): il VPS esegue il codice nuovo (HTTP ${HEALTH_HTTP:-?}). Snapshot precedente: ${SNAP_NAME}."
  fi
  exit 1
fi

# Registra lo sha in produzione (serve a etichettare i futuri snapshot). Non bloccante.
net_retry "registro sha" rcall mark_deployed "$DEPLOY_SHA" || yellow "    ⚠ registro sha non aggiornato (non critico)"

STATE_MSG="deploy completato"
green ""
green "🎉 Deploy completo: http://${VPS_HOST}"
