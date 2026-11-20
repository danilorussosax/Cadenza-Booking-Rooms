#!/usr/bin/env bash
# ============================================================
# Simulazione LOCALE di deploy.sh (retry, snapshot, rollback).
#
# NON tocca mai il VPS reale: in una cartella temporanea crea un finto
# monorepo git + un finto "VPS" (directory locali) e mette nel PATH degli
# shim di ssh, rsync, curl, pm2, npm, systemctl, sudo. `ssh` esegue il comando
# remoto in locale (sulle directory finte), `rsync` toglie il prefisso
# "cadenza-vps:" e chiama il vero rsync, `curl` simula /api/ready, `pm2`
# registra i restart. sudo NON esegue nulla.
#
# Uso:  scripts/test-deploy-simulation.sh        (exit 0 = tutti i check ok)
#
# Cosa NON simula: sshd/rete reali, permessi/owner reali del VPS, GNU userland
# del VPS (qui gira il bash/rsync del Mac), pm2 cluster, nginx, Postgres,
# PgBouncer, il vero setup-pgbouncer.sh / ensure-encryption-key.sh (stub).
# ============================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_SH="$HERE/../deploy.sh"
REAL_RSYNC="$(command -v rsync)"
[[ -x "$DEPLOY_SH" && -n "$REAL_RSYNC" ]] || { echo "deploy.sh o rsync mancanti"; exit 2; }

SIM="$(mktemp -d)"
trap '[[ -n "${SIM_KEEP:-}" ]] && echo "SIM dir: $SIM" || rm -rf "$SIM"' EXIT
REPO="$SIM/repo"
VPS="$SIM/vps/cadenza"
REL="$SIM/vps/releases"
BIN="$SIM/bin"
mkdir -p "$BIN" "$REPO" "$VPS" "$REL"

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"
         [[ -n "${SIM_VERBOSE:-}" ]] && { echo "----- output ultimo deploy -----"; tail -40 "$OUT"; echo "-----"; }; return 0; }
check() { # check "descrizione" comando…
  local d="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi
}
has()   { grep -q -- "$2" "$1"; }          # file contiene stringa
hasnt() { ! grep -q -- "$2" "$1"; }
section() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

# ---------------------------------------------------------------- shim ----
cat > "$BIN/ssh" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == "-G" ]]; then echo "hostname 192.0.2.10"; exit 0; fi
while [[ $# -gt 0 ]]; do
  case "$1" in -o|-i|-p|-l) shift 2 ;; -*) shift ;; *) break ;; esac
done
shift                       # host alias
cmd="$*"
printf '%s\n' "${cmd:0:160}" >> "$SIM/ssh.log"
if [[ -n "${SIM_SSH_FAIL_MATCH:-}" && "$cmd" == *"$SIM_SSH_FAIL_MATCH"* ]]; then
  n=$(cat "$SIM/ssh_budget" 2>/dev/null || echo 0)
  if [[ "$n" -gt 0 ]]; then
    echo $((n - 1)) > "$SIM/ssh_budget"
    echo "client_loop: send disconnect: Connection reset by 192.0.2.10 port 22" >&2
    exit 255
  fi
fi
if [[ -n "${SIM_SSH_HANG_MATCH:-}" && "$cmd" == *"$SIM_SSH_HANG_MATCH"* ]]; then
  n=$(cat "$SIM/ssh_hang_budget" 2>/dev/null || echo 0)
  if [[ "$n" -gt 0 ]]; then
    echo $((n - 1)) > "$SIM/ssh_hang_budget"
    echo "hang" >> "$SIM/ssh_hangs.log"
    bash -c 'sleep 7311; true'      # si blocca (albero: shim → bash → sleep)
    exit 0
  fi
fi
if [[ -n "${SIM_SSH_SLOW_MATCH:-}" && "$cmd" == *"$SIM_SSH_SLOW_MATCH"* ]]; then sleep "${SIM_SSH_SLOW_SECS:-1}"; fi
exec bash -c "$cmd"
SH
cat > "$BIN/rsync" <<'SH'
#!/usr/bin/env bash
net=0; dry=0; skip=0; args=()
for a in "$@"; do
  if [[ $skip -eq 1 ]]; then skip=0; continue; fi
  if [[ "$a" == "-e" ]]; then skip=1; continue; fi
  case "$a" in cadenza-vps:*) net=1; a="${a#cadenza-vps:}" ;; esac
  case "$a" in --*) ;; -*n*) dry=1 ;; esac
  args+=("$a")
done
if [[ $net -eq 1 && $dry -eq 0 ]]; then
  n=$(cat "$SIM/rsync_budget" 2>/dev/null || echo 0)
  if [[ "$n" -gt 0 ]]; then
    echo $((n - 1)) > "$SIM/rsync_budget"
    echo "rsync: connection unexpectedly closed (0 bytes received so far) [sender]" >&2
    echo "FAILED" >> "$SIM/rsync_attempts.log"
    exit 12
  fi
  echo "OK" >> "$SIM/rsync_attempts.log"
fi
exec "$REAL_RSYNC" "${args[@]}"
SH
cat > "$BIN/curl" <<'SH'
#!/usr/bin/env bash
out=""
while [[ $# -gt 0 ]]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done
code=200
if grep -q BROKEN "$SIM/running_version" 2>/dev/null; then code=500; fi
[[ -n "$out" ]] && echo '{"status":"sim"}' > "$out"
printf '%s' "$code"
SH
cat > "$BIN/pm2" <<'SH'
#!/usr/bin/env bash
case "$1" in
  restart) cp "$VPS/backend/routes/api.js" "$SIM/running_version"
           echo "restart | api=$(cat "$VPS/backend/routes/api.js") dist=$(cat "$VPS/frontend/dist/index.html")" >> "$SIM/pm2.log" ;;
  status)  echo "│ cadenza-backend │ online │" ;;
  logs)    echo "[sim] log riga 1" ;;
  *)       echo "[sim] pm2 $*" ;;
esac
SH
cat > "$BIN/npm" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "run" && "$2" == "build" ]]; then
  mkdir -p dist/assets
  echo "app-$(cat VERSION)" > dist/index.html
  echo "chunk" > "dist/assets/chunk-$(cat VERSION).js"
  echo "build $(cat VERSION)" >> "$SIM/npm.log"
  # mtime crescente a ogni build (una build vera ha mtime diversi): evita falsi
  # "file identico" nel quick-check di rsync quando due build cadono nello stesso secondo
  n=$(( $(cat "$SIM/build_n" 2>/dev/null || echo 0) + 1 )); echo $n > "$SIM/build_n"
  perl -e 'my $t = 1800000000 + $ARGV[0] * 10; utime $t, $t, @ARGV[1..$#ARGV]' "$n" dist/index.html dist/assets/*
elif [[ "$1" == "ci" ]]; then
  mkdir -p node_modules
  shasum -a 256 package-lock.json | cut -d' ' -f1 > node_modules/.lockstamp
  echo "npm ci in $(basename "$PWD")" >> "$SIM/npm.log"
else
  echo "npm $*" >> "$SIM/npm.log"
fi
SH
cat > "$BIN/systemctl" <<'SH'
#!/usr/bin/env bash
echo active
SH
cat > "$BIN/sudo" <<'SH'
#!/usr/bin/env bash
echo "sudo $*" >> "$SIM/sudo.log"   # MAI eseguito davvero
SH
chmod +x "$BIN"/*

export SIM VPS REAL_RSYNC
export PATH="$BIN:$PATH"
export CADENZA_DEPLOY_VPS_PATH="$VPS"
export CADENZA_DEPLOY_RELEASES="$REL"
export CADENZA_DEPLOY_RETRY_SLEEP=0
export CADENZA_DEPLOY_HEALTH_SLEEP=0
TSN=0
next_ts() { TSN=$((TSN + 1)); export CADENZA_SNAP_TS="$(printf '20261120-1200%02d' "$TSN")"; }

# ------------------------------------------------- finto monorepo (git) ----
cp "$DEPLOY_SH" "$REPO/deploy.sh"
mkdir -p "$REPO/backend/scripts" "$REPO/backend/routes" "$REPO/frontend/scripts" "$REPO/frontend/node_modules"
echo '{"name":"x"}' > "$REPO/package.json"
echo '{"name":"b"}' > "$REPO/backend/package.json"
echo '{"name":"f"}' > "$REPO/frontend/package.json"
echo '#!/bin/sh' > "$REPO/backend/scripts/ensure-encryption-key.sh"
echo 'echo key-ok' >> "$REPO/backend/scripts/ensure-encryption-key.sh"
echo 'unchanged' > "$REPO/backend/routes/stable.js"
lockjson() { printf '{"lockfileVersion":3,"packages":{"":{},"node_modules/foo":{"version":"%s"}}}\n' "$1"; }
lockjson 1.0.0 > "$REPO/backend/package-lock.json"
lockjson 1.0.0 > "$REPO/frontend/package-lock.json"
(
  cd "$REPO" || exit 1
  git init -q . && git config user.email t@t && git config user.name t
  git config commit.gpgsign false
)
CN=0
# commit_version <tag> [lock-version] [extra-file]
commit_version() {
  CN=$((CN + 1))   # date di commit crescenti: gli mtime dei file archiviati differiscono sempre
  ( cd "$REPO" || exit 1
    echo "$1" > backend/routes/api.js
    echo "$1" > frontend/VERSION
    [[ -n "${2:-}" ]] && lockjson "$2" > backend/package-lock.json
    [[ -n "${3:-}" ]] && echo "extra" > "backend/routes/$3"
    export GIT_AUTHOR_DATE="@$((1700000000 + CN * 100)) +0000" GIT_COMMITTER_DATE="@$((1700000000 + CN * 100)) +0000"
    git add -A >/dev/null && git commit -q -m "v $1" )
}
# --- stato iniziale del finto VPS: "v0" già in produzione ---
mkdir -p "$VPS/backend/routes" "$VPS/backend/scripts" "$VPS/backend/uploads" "$VPS/backend/node_modules" \
         "$VPS/frontend/dist/assets" "$VPS/frontend/public"
echo v0 > "$VPS/backend/routes/api.js"
echo unchanged > "$VPS/backend/routes/stable.js"
echo SECRET_ENV > "$VPS/backend/.env"
echo upload-data > "$VPS/backend/uploads/u.txt"
echo mod > "$VPS/backend/node_modules/m.js"
lockjson 1.0.0 > "$VPS/backend/package-lock.json"
lockjson 1.0.0 > "$VPS/frontend/package-lock.json"
echo app-v0 > "$VPS/frontend/dist/index.html"
echo old-chunk > "$VPS/frontend/dist/assets/chunk-v0.js"
echo v0 > "$SIM/running_version"
# mtime dei file "già in produzione": vecchi, tranne quelli identici al repo (mtime = data commit v0)
find "$VPS" -type f -exec touch -t 202001010000 {} +
python3 -c 'import os,sys; [os.utime(p,(1700000100,1700000100)) for p in sys.argv[1:]]' "$VPS/backend/routes/stable.js" "$VPS/backend/scripts/ensure-encryption-key.sh" 2>/dev/null || true
lockstamp() { shasum -a 256 "$1" | cut -d' ' -f1; }
lockstamp "$VPS/backend/package-lock.json" > "$VPS/backend/node_modules/.lockstamp"
commit_version v0   # commit base uguale al VPS (non deployato: serve solo come storia)

OUT="$SIM/out.txt"
# run_deploy [args…] — esegue il deploy nel finto repo, output in $OUT, rc in $RC
run_deploy() {
  next_ts
  ( cd "$REPO" && ./deploy.sh "$@" ) > "$OUT" 2>&1 < /dev/null
  RC=$?
}
nsnap() { ls -1 "$REL" | grep -cE '^[0-9]{8}-[0-9]{6}-'; }
lastsnap() { cat "$REL/LAST"; }
sha_of() { ( cd "$REPO" && git rev-parse --short HEAD ); }
reset_budgets() { echo 0 > "$SIM/rsync_budget"; echo 0 > "$SIM/ssh_budget"; echo 0 > "$SIM/ssh_hang_budget"; export SIM_SSH_FAIL_MATCH="" SIM_SSH_HANG_MATCH="" SIM_SSH_SLOW_MATCH=""; unset NET_TIMEOUT NET_TIMEOUT_LONG; : > "$SIM/ssh_hangs.log"; : > "$SIM/rsync_attempts.log"; }
reset_budgets

# =============================================================== (a) ====
section "(a) deploy riuscito: snapshot creato, vecchi potati"
commit_version v1
run_deploy --yes
check "exit 0"                                   test "$RC" -eq 0
check "codice nuovo sul VPS (api.js = v1)"       test "$(cat "$VPS/backend/routes/api.js")" = v1
check "dist nuova live (index = app-v1)"         test "$(cat "$VPS/frontend/dist/index.html")" = app-v1
check "chunk orfano v0 rimosso dalla dist"       test ! -e "$VPS/frontend/dist/assets/chunk-v0.js"
check ".dist-new non rimasta"                    test ! -e "$VPS/frontend/.dist-new"
check "un solo snapshot creato"                  test "$(nsnap)" -eq 1
S1="$(lastsnap)"
check "LAST punta allo snapshot"                 test -d "$REL/$S1/backend"
check "snapshot contiene il codice PRECEDENTE (v0)" test "$(cat "$REL/$S1/backend/routes/api.js")" = v0
check "snapshot contiene la dist PRECEDENTE"     test "$(cat "$REL/$S1/frontend/dist/index.html")" = app-v0
check "snapshot senza .env"                      test ! -e "$REL/$S1/backend/.env"
check "snapshot senza node_modules"              test ! -e "$REL/$S1/backend/node_modules"
check "snapshot senza uploads"                   test ! -e "$REL/$S1/backend/uploads"
check ".env del VPS intatto"                     test "$(cat "$VPS/backend/.env")" = SECRET_ENV
check "uploads del VPS intatti"                  test "$(cat "$VPS/backend/uploads/u.txt")" = upload-data
check "PM2 riavviato con processo sul codice v1" test "$(cat "$SIM/running_version")" = v1
check "sha registrato in DEPLOYED_SHA"           test "$(cat "$REL/DEPLOYED_SHA")" = "$(sha_of)"
check "PENDING cancellato a deploy riuscito"     test ! -e "$REL/PENDING"
check "sudo non eseguito davvero (nessun pgbouncer reale)" test ! -s "$SIM/sudo.log"
# finestra di stato misto: al restart dist e codice sono già coerenti
check "al momento del restart dist+codice coerenti (v1/app-v1)" has "$SIM/pm2.log" "api=v1 dist=app-v1"

for v in v2 v3 v4; do commit_version "$v"; run_deploy --yes; done
check "dopo 4 deploy restano solo 3 snapshot"    test "$(nsnap)" -eq 3
check "il più vecchio (…-v1/…01) è stato potato" test ! -e "$REL/$S1"
check "output dichiara la potatura"              has "$OUT" "potato snapshot vecchio"
check "ultimo snapshot contiene v3"              test "$(cat "$REL/$(lastsnap)/backend/routes/api.js")" = v3

# =============================================================== (b) ====
section "(b) healthcheck fallito: rollback automatico"
SNAP_BEFORE="$(lastsnap)"
commit_version v5-BROKEN 2.0.0 extra.js     # cambia anche il lock e aggiunge un file
NPM_BEFORE=$(grep -c "npm ci" "$SIM/npm.log")
run_deploy --yes
check "exit 1 (deploy fallito)"                  test "$RC" -eq 1
check "rollback automatico annunciato"           has "$OUT" "ROLLBACK AUTOMATICO"
check "esito: rollback riuscito, backend healthy" has "$OUT" "rollback automatico riuscito"
check "api.js ripristinato (v4)"                 test "$(cat "$VPS/backend/routes/api.js")" = v4
check "file aggiunto dal deploy fallito rimosso" test ! -e "$VPS/backend/routes/extra.js"
check "dist ripristinata (app-v4)"               test "$(cat "$VPS/frontend/dist/index.html")" = app-v4
check "processo PM2 di nuovo sul codice v4"      test "$(cat "$SIM/running_version")" = v4
check "npm ci eseguito 2 volte (avanti + rollback)" test "$(( $(grep -c 'npm ci' "$SIM/npm.log") - NPM_BEFORE ))" -eq 2
check "node_modules riallineati al lock precedente" test "$(cat "$VPS/backend/node_modules/.lockstamp")" = "$(lockstamp "$VPS/backend/package-lock.json")"
check "lock precedente = versione 1.0.0"         has "$VPS/backend/package-lock.json" '1.0.0'
check ".env e uploads intatti dopo il rollback"  test "$(cat "$VPS/backend/.env")$(cat "$VPS/backend/uploads/u.txt")" = "SECRET_ENVupload-data"
check "PENDING cancellato dopo rollback riuscito" test ! -e "$REL/PENDING"
check "nessun nuovo snapshot oltre ai 3 (potatura)" test "$(nsnap)" -eq 3

section "(b2) --no-rollback: healthcheck KO, il VPS resta sul codice nuovo"
commit_version v6-BROKEN
run_deploy --yes --no-rollback
check "exit 1"                                   test "$RC" -eq 1
check "messaggio rollback DISATTIVATO"           has "$OUT" "DISATTIVATO"
check "il VPS resta sul codice rotto"            test "$(cat "$VPS/backend/routes/api.js")" = v6-BROKEN
check "PENDING presente (c'è uno stato da riparare)" test -f "$REL/PENDING"
check "l'output suggerisce --rollback"           has "$OUT" "./deploy.sh --rollback"

# =============================================================== (e) ====
section "(e) rollback manuale (--rollback)"
NS_BEFORE="$(nsnap)"
( cd "$REPO" && PATH="$PATH" ./deploy.sh --rollback ) > "$OUT" 2>&1 < /dev/null; RC=$?
check "senza --yes e senza tty: rifiuta"         test "$RC" -eq 1
check "VPS non toccato dal rifiuto"              test "$(cat "$VPS/backend/routes/api.js")" = v6-BROKEN
GOOD_SNAP="$(cat "$REL/PENDING")"
next_ts
( cd "$REPO" && ./deploy.sh --rollback --yes ) > "$OUT" 2>&1 < /dev/null; RC=$?
check "--rollback --yes: exit 0"                 test "$RC" -eq 0
check "ritorno al codice dello snapshot (v4)"    test "$(cat "$VPS/backend/routes/api.js")" = v4
check "dist ripristinata (app-v4)"               test "$(cat "$VPS/frontend/dist/index.html")" = app-v4
check "PM2 riavviato sul codice v4"              test "$(cat "$SIM/running_version")" = v4
check "snapshot di sicurezza dello stato rotto creato" has "$OUT" "stato corrente salvato"
check "PENDING cancellato"                       test ! -e "$REL/PENDING"
check "LAST ora = snapshot pre-rollback (reversibile)" has "$REL/LAST" "pre-rollback"
check "snapshot pre-rollback contiene v6-BROKEN" test "$(cat "$REL/$(lastsnap)/backend/routes/api.js")" = v6-BROKEN
check "snapshot di partenza non potato"          test -d "$REL/$GOOD_SNAP"
check "rollback completato annunciato"           has "$OUT" "Rollback completato"

# =============================================================== (c) ====
section "(c) rsync fallisce 2 volte poi riesce: retry"
commit_version v7
reset_budgets; echo 2 > "$SIM/rsync_budget"
run_deploy --yes
check "exit 0 (il deploy si completa)"           test "$RC" -eq 0
check "retry annunciato: tentativo 1/3 fallito"  has "$OUT" "tentativo 1/3 fallito"
check "retry annunciato: tentativo 2/3 fallito"  has "$OUT" "tentativo 2/3 fallito"
check "due fallimenti + un successo registrati"  test "$(grep -c FAILED "$SIM/rsync_attempts.log")" -eq 2
check "codice nuovo sul VPS (v7)"                test "$(cat "$VPS/backend/routes/api.js")" = v7
check "dist nuova live (app-v7)"                 test "$(cat "$VPS/frontend/dist/index.html")" = app-v7

# =============================================================== (d) ====
section "(d) fallimento definitivo di rete: messaggio di stato corretto"
commit_version v8
reset_budgets; echo 99 > "$SIM/rsync_budget"
run_deploy --yes
check "exit != 0"                                test "$RC" -ne 0
check "3 tentativi falliti poi resa"             has "$OUT" "dopo 3 tentativi"
check "report 'DEPLOY INTERROTTO'"               has "$OUT" "DEPLOY INTERROTTO"
check "stato: dist in staging interrotta, live invariato" has "$OUT" "dist LIVE, codice backend e PM2 INVARIATI"
check "stato cita lo snapshot creato"            has "$OUT" "Snapshot"
check "VPS davvero invariato (api.js = v7)"      test "$(cat "$VPS/backend/routes/api.js")" = v7
check "PM2 non riavviato (running = v7)"         test "$(cat "$SIM/running_version")" = v7
check "VPS live non toccato: invita a rilanciare" has "$OUT" "Puoi rilanciare tranquillamente"
check "PENDING presente"                         test -f "$REL/PENDING"

section "(d2) caduta ssh dopo la copia del codice, prima del restart (il caso reale)"
reset_budgets; export SIM_SSH_FAIL_MATCH="swap_restart"; echo 99 > "$SIM/ssh_budget"
SNAP_D="$(cat "$REL/PENDING")"
run_deploy --yes
check "exit != 0"                                test "$RC" -ne 0
check "codice nuovo già sul disco (v8)"          test "$(cat "$VPS/backend/routes/api.js")" = v8
check "dist LIVE ancora quella vecchia (app-v7)" test "$(cat "$VPS/frontend/dist/index.html")" = app-v7
check "dist nuova pronta in .dist-new"           test "$(cat "$VPS/frontend/.dist-new/index.html")" = app-v8
check "PM2 NON riavviato (running = v7)"         test "$(cat "$SIM/running_version")" = v7
check "stato: esito swap/restart NON confermato" has "$OUT" "esito NON confermato"
check "riusato lo snapshot sano, nessun nuovo snapshot dello stato misto" has "$OUT" "riuso lo snapshot sano"
check "PENDING invariato (snapshot sano)"        test "$(cat "$REL/PENDING")" = "$SNAP_D"

section "(d3) ripresa: rilancio del deploy dopo il fallimento"
reset_budgets
run_deploy --yes
check "exit 0"                                   test "$RC" -eq 0
check "dist v8 live"                             test "$(cat "$VPS/frontend/dist/index.html")" = app-v8
check "PM2 sul codice v8"                        test "$(cat "$SIM/running_version")" = v8
check "PENDING cancellato"                       test ! -e "$REL/PENDING"

section "(g) snapshot a costo ~0: i file non riscritti sono hardlink"
next_ts
awk "/^read -r -d/{f=1;next} /^REMOTE\$/{f=0} f" "$DEPLOY_SH" > "$SIM/remote_script.sh"
bash "$SIM/remote_script.sh" snapshot "$VPS" "$REL" hardlink-test force > "$OUT" 2>&1; RC=$?
HL="$(lastsnap)"
check "azione snapshot diretta: exit 0"          test "$RC" -eq 0
check "stable.js dello snapshot è hardlink del live" test -n "$(find "$REL/$HL/backend/routes" -name stable.js -links +1)"
check "chunk dist dello snapshot sono hardlink"  test -n "$(find "$REL/$HL/frontend/dist" -type f -links +1)"
check "snapshot diretto senza .env/secrets"      test ! -e "$REL/$HL/backend/.env"

section "(f) --help e argomenti"
( cd "$REPO" && ./deploy.sh --help ) > "$OUT" 2>&1; RC=$?
check "--help exit 0 e cita --rollback"          test "$RC" -eq 0 -a -n "$(grep -- '--rollback' "$OUT")"
( cd "$REPO" && ./deploy.sh --bogus ) > "$OUT" 2>&1; RC=$?
check "argomento sconosciuto: exit 2"            test "$RC" -eq 2

section "(g2) ssh si BLOCCA al 1o tentativo: il tetto di tempo lo uccide, il 2o riesce"
commit_version v9
reset_budgets; export SIM_SSH_HANG_MATCH="cat "; echo 1 > "$SIM/ssh_hang_budget"; export NET_TIMEOUT=3
run_deploy --yes
check "exit 0 (il deploy si completa)"           test "$RC" -eq 0
check "compare 'tempo scaduto dopo 3s'"          has "$OUT" "tempo scaduto dopo 3s"
check "retry annunciato dopo il timeout"         has "$OUT" "tentativo 1/3 fallito"
check "un solo blocco simulato"                  test "$(grep -c hang "$SIM/ssh_hangs.log")" -eq 1
check "codice nuovo sul VPS (v9)"                test "$(cat "$VPS/backend/routes/api.js")" = v9
check "PM2 sul codice v9"                        test "$(cat "$SIM/running_version")" = v9
check "nessun processo residuo"                  bash -c "! pgrep -f 'sleep 7311'"

section "(h) ssh si blocca SEMPRE: dopo i tentativi massimi il deploy fallisce, VPS invariato"
commit_version v10
reset_budgets; export SIM_SSH_HANG_MATCH="cat "; echo 99 > "$SIM/ssh_hang_budget"; export NET_TIMEOUT=2
run_deploy --yes
check "exit != 0"                                test "$RC" -ne 0
check "3 blocchi (3 tentativi)"                  test "$(grep -c hang "$SIM/ssh_hangs.log")" -eq 3
check "3 messaggi 'tempo scaduto'"               test "$(grep -c 'tempo scaduto dopo 2s' "$OUT")" -eq 3
check "resa dopo 3 tentativi"                    has "$OUT" "dopo 3 tentativi"
check "report 'DEPLOY INTERROTTO'"               has "$OUT" "DEPLOY INTERROTTO"
check "stato VPS: NON modificato"                has "$OUT" "VPS NON modificato"
check "invita a rilanciare"                      has "$OUT" "Puoi rilanciare tranquillamente"
check "VPS davvero invariato (api.js = v9)"      test "$(cat "$VPS/backend/routes/api.js")" = v9
check "nessun processo residuo (sleep/shim ssh)" bash -c "! pgrep -f 'sleep 7311' && ! pgrep -f '$BIN/ssh'"

section "(i) comando lento ma entro il limite: NON ucciso"
reset_budgets; export SIM_SSH_SLOW_MATCH="cat "; export SIM_SSH_SLOW_SECS=1; export NET_TIMEOUT=6
run_deploy --yes
check "exit 0"                                   test "$RC" -eq 0
check "nessun 'tempo scaduto'"                   hasnt "$OUT" "tempo scaduto"
check "nessun retry"                             hasnt "$OUT" "riprovo tra"
check "codice nuovo sul VPS (v10)"               test "$(cat "$VPS/backend/routes/api.js")" = v10

section "(j) net_retry: output, exit code, stdin e timeout su funzioni (unit)"
awk '/^NET_ATTEMPT_PID=/{f=1} /^# Script remoto/{f=0} f' "$DEPLOY_SH" > "$SIM/netretry.sh"
cat > "$SIM/unit.sh" <<'UNIT'
set -euo pipefail
yellow() { printf '%s\n' "$*"; }; red() { printf '%s\n' "$*"; }
RETRY_MAX=3; RETRY_BASE_SLEEP=0
source "$1"
f_out() { printf 'riga1\nriga2 con $x e "virgolette"\n'; printf 'senza-newline'; }
f_rc7() { echo out7; return 7; }
f_stdin() { cat; }
f_slow() { sleep 1; echo slow-ok; }
f_hang() { bash -c 'sleep 7311; true'; }
o1="$(net_retry etichetta f_out)"
[[ "$o1" == "$(f_out)" ]] && echo "OUT_IDENTICO"
rc=0; o2="$(net_retry etichetta f_rc7)" || rc=$?
[[ "$rc" -eq 7 && "$o2" == out7 ]] && echo "RC_REALE_7"
o3="$(printf 'dallo stdin' | net_retry etichetta f_stdin)"
[[ "$o3" == "dallo stdin" ]] && echo "STDIN_OK"
o4="$(NET_TIMEOUT=5 net_retry etichetta f_slow)"
[[ "$o4" == slow-ok ]] && echo "LENTO_NON_UCCISO"
rc=0; NET_TIMEOUT=1 net_retry etichetta f_hang 2>/dev/null >&2 || rc=$?
[[ "$rc" -eq 124 ]] && echo "TIMEOUT_RC_124"
rc=0; NET_TIMEOUT=1 NET_TIMEOUT_LONG=100 net_retry "x rsync" f_slow >/dev/null || rc=$?
[[ "$rc" -eq 0 ]] && echo "ETICHETTA_RSYNC_USA_LONG"
UNIT
bash "$SIM/unit.sh" "$SIM/netretry.sh" > "$OUT" 2>&1; RC=$?
check "unit: exit 0"                             test "$RC" -eq 0
check "stdout catturato identico (anche senza newline finale)" has "$OUT" OUT_IDENTICO
check "exit code reale del comando (7) e output" has "$OUT" RC_REALE_7
check "stdin passa al comando"                   has "$OUT" STDIN_OK
check "comando lento entro limite non ucciso"    has "$OUT" LENTO_NON_UCCISO
check "funzione bloccata: exit 124 dopo i tentativi" has "$OUT" TIMEOUT_RC_124
check "etichetta con 'rsync' usa NET_TIMEOUT_LONG" has "$OUT" ETICHETTA_RSYNC_USA_LONG
check "nessun processo residuo dopo i test"      bash -c "! pgrep -f 'sleep 7311'"

section "(k) SIGTERM durante un tentativo: albero ucciso, EXIT trap con stato VPS"
commit_version v11
reset_budgets; export SIM_SSH_HANG_MATCH="cat "; echo 99 > "$SIM/ssh_hang_budget"; export NET_TIMEOUT=60
next_ts
cd "$REPO" || exit 2
./deploy.sh --yes > "$OUT" 2>&1 < /dev/null &
DPID=$!
cd "$HERE" || exit 2
for _ in $(seq 1 40); do [[ -s "$SIM/ssh_hangs.log" ]] && break; sleep 0.5; done
sleep 1
check "il tentativo è davvero bloccato"          pgrep -f 'sleep 7311'
kill -TERM "$DPID"; wait "$DPID"; RC=$?
check "exit 143 (SIGTERM)"                       test "$RC" -eq 143
check "EXIT trap: 'Stato del VPS: ... VPS NON modificato'" has "$OUT" "VPS NON modificato"
check "nessun processo residuo"                  bash -c "! pgrep -f 'sleep 7311' && ! pgrep -f '$BIN/ssh'"
reset_budgets

# ======================================= (l)(m) confronto versioni moduli ====
# Il passo 3 blocca il deploy se il lock locale risolve un modulo a una versione
# PIÙ VECCHIA di quella già sul server. Le dipendenze incorporate (inBundle) in un
# altro pacchetto non sono "risolte" da npm: non devono dare falsi allarmi.
commit_with_frontend_lock() {   # <tag> <json del package-lock del frontend>
  CN=$((CN + 1))
  ( cd "$REPO" || exit 1
    echo "$1" > backend/routes/api.js
    echo "$1" > frontend/VERSION
    printf '%s\n' "$2" > frontend/package-lock.json
    export GIT_AUTHOR_DATE="@$((1700000000 + CN * 100)) +0000" GIT_COMMITTER_DATE="@$((1700000000 + CN * 100)) +0000"
    git add -A >/dev/null && git commit -q -m "v $1" )
}
LOCK_REG_OLD='{"lockfileVersion":3,"packages":{"":{},"node_modules/bar":{"version":"1.0.0"},"node_modules/bar/node_modules/foo":{"version":"0.9.0"}}}'
LOCK_BUNDLED_OLD='{"lockfileVersion":3,"packages":{"":{},"node_modules/bar":{"version":"1.0.0"},"node_modules/bar/node_modules/foo":{"version":"0.9.0","inBundle":true}}}'

section "(m) modulo normale più vecchio del server (frontend): il deploy è BLOCCATO, VPS invariato"
BEFORE_API="$(cat "$VPS/backend/routes/api.js")"
commit_with_frontend_lock v12 "$LOCK_REG_OLD"
reset_budgets; run_deploy --yes
check "exit != 0"                                test "$RC" -ne 0
check "segnala 'moduli risolti più moderni'"     has "$OUT" "moduli risolti più moderni"
check "nomina il modulo (foo) del frontend"      has "$OUT" "frontend: foo"
check "VPS NON modificato"                       has "$OUT" "VPS NON modificato"
check "codice sul VPS invariato"                 test "$(cat "$VPS/backend/routes/api.js")" = "$BEFORE_API"

section "(l) modulo solo incorporato (inBundle) più vecchio del server: NON blocca"
commit_with_frontend_lock v13 "$LOCK_BUNDLED_OLD"
reset_budgets; run_deploy --yes
check "exit 0"                                   test "$RC" -eq 0
check "nessun 'moduli risolti più moderni'"      hasnt "$OUT" "moduli risolti più moderni"
check "deploy completato (api.js = v13)"         test "$(cat "$VPS/backend/routes/api.js")" = v13
reset_budgets

printf '\n\033[1mRisultato: %d PASS, %d FAIL\033[0m\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
