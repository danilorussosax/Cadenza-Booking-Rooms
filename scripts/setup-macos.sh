#!/usr/bin/env bash
# =============================================================================
# Cadenza · Setup ambiente dev su macOS
#
# Installa (o aggiorna) tutto il necessario per sviluppare Cadenza in locale:
#
#   • Xcode Command Line Tools  → richiesto da Homebrew + node-gyp
#   • Homebrew                  → package manager
#   • Node.js (≥ 20)            → runtime
#   • PostgreSQL 16             → database (avviato come servizio brew)
#   • git                       → di solito già presente con Xcode CLT
#   • dipendenze npm            → root + backend + frontend (npm install)
#   • backend/.env              → generato se mancante con valori di dev
#   • database Cadenza          → utente + DB creati su Postgres locale
#   • schema iniziale           → sync via DB_SYNC_MODE=alter
#
# Idempotente:
#   - Se Homebrew/Node/Postgres già presenti → fa `brew upgrade`
#   - npm install è di natura idempotente
#   - .env esistente viene preservato (backup automatico)
#   - utente/DB Postgres creati solo se non esistono
#
# Uso:
#   bash scripts/setup-macos.sh                    # setup completo interattivo (via Homebrew)
#   bash scripts/setup-macos.sh --no-brew          # ⭐ niente Homebrew: usa curl + fnm + Postgres.app
#   bash scripts/setup-macos.sh --yes              # senza conferme
#   bash scripts/setup-macos.sh --minimal          # solo essenziale (no pm2, no nginx)
#   bash scripts/setup-macos.sh --skip-brew        # salta install/upgrade brew packages
#   bash scripts/setup-macos.sh --skip-db          # salta setup database
#   bash scripts/setup-macos.sh --reset-db         # DROP + ricrea il DB (distruttivo)
#   bash scripts/setup-macos.sh --db-name miodb    # override nome DB (default: cadenza_dev)
#   bash scripts/setup-macos.sh --pg-version 16    # override versione Postgres
#   bash scripts/setup-macos.sh --node-version 20  # override versione Node
#   bash scripts/setup-macos.sh --dry-run          # mostra cosa farebbe
#   bash scripts/setup-macos.sh --help
#
# Modalità "no-brew" (--no-brew):
#   • Node via fnm (Fast Node Manager): curl + ~/.local/share/fnm + shell init
#   • PostgreSQL via Postgres.app: download DMG ufficiale + cp in /Applications
#   • git via Xcode CLT (sempre presente, no-op)
#   Vantaggi: nessun sudo (tranne CLT), nessun gestore globale, install
#   user-local. Le versioni si aggiornano via fnm e via update-in-app di
#   Postgres.app.
#
# Compatibile con Apple Silicon (arm64) e Intel (x86_64).
# Testato su macOS 14 Sonoma e 15 Sequoia.
# =============================================================================

set -euo pipefail

# ─── Defaults & arg parse ────────────────────────────────────────────────────
DB_NAME="cadenza_dev"
DB_USER="cadenza"
DB_PASSWORD=""              # se vuoto, generato randomicamente al primo run
PG_VERSION="16"
NODE_VERSION="20"
ASSUME_YES=0
DRY_RUN=0
MINIMAL=0
SKIP_BREW=0
SKIP_DB=0
SKIP_NPM=0
SKIP_ENV=0
RESET_DB=0
NO_BREW=0
# URL DMG di Postgres.app (in modalità --no-brew). Aggiorna se vuoi una
# versione più recente. La pagina downloads canonica è https://postgresapp.com.
POSTGRESAPP_DMG_URL="${POSTGRESAPP_DMG_URL:-https://github.com/PostgresApp/PostgresApp/releases/download/v2.7.6/Postgres-2.7.6-16.dmg}"

usage() { sed -n '2,40p' "$0" | sed 's/^# \?//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)        ASSUME_YES=1; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --minimal)       MINIMAL=1; shift ;;
    --no-brew)       NO_BREW=1; shift ;;
    --skip-brew)     SKIP_BREW=1; shift ;;
    --skip-db)       SKIP_DB=1; shift ;;
    --skip-npm)      SKIP_NPM=1; shift ;;
    --skip-env)      SKIP_ENV=1; shift ;;
    --reset-db)      RESET_DB=1; shift ;;
    --db-name)       DB_NAME="$2"; shift 2 ;;
    --db-password)   DB_PASSWORD="$2"; shift 2 ;;
    --pg-version)    PG_VERSION="$2"; shift 2 ;;
    --node-version)  NODE_VERSION="$2"; shift 2 ;;
    --postgresapp-url) POSTGRESAPP_DMG_URL="$2"; shift 2 ;;
    --help|-h)       usage ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ─── Output helpers ──────────────────────────────────────────────────────────
TTY_OK=0
[[ -t 1 ]] && TTY_OK=1
red()    { [[ $TTY_OK -eq 1 ]] && printf '\033[31m%s\033[0m\n' "$*" || echo "$*"; }
green()  { [[ $TTY_OK -eq 1 ]] && printf '\033[32m%s\033[0m\n' "$*" || echo "$*"; }
yellow() { [[ $TTY_OK -eq 1 ]] && printf '\033[33m%s\033[0m\n' "$*" || echo "$*"; }
blue()   { [[ $TTY_OK -eq 1 ]] && printf '\033[34m%s\033[0m\n' "$*" || echo "$*"; }
bold()   { [[ $TTY_OK -eq 1 ]] && printf '\033[1m%s\033[0m\n' "$*" || echo "$*"; }
dim()    { [[ $TTY_OK -eq 1 ]] && printf '\033[2m%s\033[0m\n' "$*" || echo "$*"; }

step() { echo; bold "▶ $*"; }
ok()   { green "  ✓ $*"; }
warn() { yellow "  ⚠ $*"; }
err()  { red "  ✗ $*"; }
info() { blue "  ⓘ $*"; }
plan() { dim "  → $*"; }

confirm() {
  local prompt="$1"
  if [[ $ASSUME_YES -eq 1 ]]; then return 0; fi
  read -rp "  $prompt [y/N] " ans
  [[ "$ans" =~ ^[yYsS]$ ]]
}

run() {
  if [[ $DRY_RUN -eq 1 ]]; then plan "DRY-RUN: $*"; return 0; fi
  "$@"
}

run_eval() {
  if [[ $DRY_RUN -eq 1 ]]; then plan "DRY-RUN: $1"; return 0; fi
  eval "$1"
}

# ─── Pre-flight ──────────────────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
  err "Questo script è specifico per macOS. Per Linux/Ubuntu usa scripts/install.sh."
  exit 2
fi

# Identifica architettura per il path di Homebrew
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  BREW_PREFIX="/opt/homebrew"
else
  BREW_PREFIX="/usr/local"
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

[[ -d backend && -d frontend && -f package.json ]] || {
  err "Lancia lo script dalla root del repo Cadenza (mancano backend/, frontend/, package.json)"
  exit 1
}

echo
bold "🎼 Cadenza · setup ambiente dev su macOS"
echo "  Working dir:  $ROOT_DIR"
echo "  Architettura: $ARCH"
if [[ $NO_BREW -eq 1 ]]; then
  echo "  Modalità:     NO-BREW (curl + fnm + Postgres.app)"
else
  echo "  Modalità:     Homebrew ($BREW_PREFIX)"
fi
echo "  Database:     $DB_NAME (utente: $DB_USER)"
echo "  Postgres:     $PG_VERSION"
echo "  Node:         ≥ $NODE_VERSION"
[[ $DRY_RUN -eq 1 ]] && yellow "  ✱ DRY-RUN: nessuna modifica verrà applicata."
echo

# ─── Step 1: Xcode Command Line Tools ────────────────────────────────────────
step "1/8 — Xcode Command Line Tools"
if xcode-select -p >/dev/null 2>&1; then
  ok "CLT già installati: $(xcode-select -p)"
else
  info "CLT non trovati. Eseguo: xcode-select --install"
  if [[ $DRY_RUN -eq 0 ]]; then
    xcode-select --install || true
    info "Una finestra grafica chiederà l'installazione. Conferma e attendi 5-10 minuti."
    info "Quando il dialogo si chiude, rilancia questo script per continuare."
    exit 0
  fi
fi

# ─── Step 2: Package manager (Homebrew oppure curl + fnm) ───────────────────
step "2/8 — Package manager"
if [[ $SKIP_BREW -eq 1 ]]; then
  warn "Skip package manager (--skip-brew)"
elif [[ $NO_BREW -eq 1 ]]; then
  ok "Modalità --no-brew: niente Homebrew. Step 3 userà fnm + Postgres.app."
else
  if ! command -v brew >/dev/null 2>&1; then
    if [[ $DRY_RUN -eq 1 ]]; then
      plan "DRY-RUN: installerei Homebrew + eval shellenv"
    else
      info "Installo Homebrew (richiede password sudo, ~5 min)..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      # Aggiungi brew al PATH della sessione corrente — solo se davvero installato
      if [[ -x "$BREW_PREFIX/bin/brew" ]]; then
        eval "$($BREW_PREFIX/bin/brew shellenv)"
        ok "Homebrew installato"
      else
        err "Homebrew non installato correttamente. Riprova a mano."
        exit 1
      fi
    fi
  else
    ok "Homebrew presente: $(brew --version | head -n1)"
  fi
  info "Aggiorno il database delle formule..."
  run brew update
fi

# ensure_brew_pkg PKG → install se assente, upgrade se presente
ensure_brew_pkg() {
  local pkg="$1"
  if [[ $DRY_RUN -eq 1 ]]; then plan "DRY-RUN: brew install/upgrade $pkg"; return 0; fi
  if brew list "$pkg" >/dev/null 2>&1; then
    info "Aggiorno $pkg…"
    brew upgrade "$pkg" 2>/dev/null || ok "$pkg già aggiornato"
  else
    info "Installo $pkg…"
    brew install "$pkg"
  fi
}

# install_node_via_fnm → fnm + node@$NODE_VERSION user-local, no sudo
install_node_via_fnm() {
  if [[ $DRY_RUN -eq 1 ]]; then
    plan "DRY-RUN: curl fnm | bash + fnm install $NODE_VERSION"
    return 0
  fi
  if ! command -v fnm >/dev/null 2>&1; then
    info "Installo fnm (Fast Node Manager) via curl…"
    curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell --install-dir "${HOME}/.local/share/fnm"
    if ! grep -q 'fnm env' "${HOME}/.zshrc" 2>/dev/null; then
      cat >>"${HOME}/.zshrc" <<'ZSHRC'

# Cadenza setup-macos: inizializza fnm
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --use-on-cd)"
ZSHRC
      info "Aggiunto blocco fnm al tuo ~/.zshrc (init alla prossima shell)"
    fi
  else
    ok "fnm presente: $(fnm --version)"
  fi
  # Carica fnm nella sessione corrente
  export PATH="$HOME/.local/share/fnm:$PATH"
  eval "$(fnm env)"
  info "Installo Node.js via fnm…"
  fnm install "${NODE_VERSION}" 2>&1 | tail -3 || true
  fnm default "${NODE_VERSION}" || true
  fnm use "${NODE_VERSION}" || true
  ok "Node $(node -v) attivo via fnm"
}

# install_postgres_via_app → scarica DMG, monta, copia in /Applications, espelle
install_postgres_via_app() {
  if [[ $DRY_RUN -eq 1 ]]; then
    plan "DRY-RUN: curl $POSTGRESAPP_DMG_URL → mount → cp Postgres.app /Applications"
    return 0
  fi
  if [[ -d /Applications/Postgres.app ]]; then
    ok "Postgres.app già presente in /Applications"
  else
    info "Scarico Postgres.app DMG ($(basename "$POSTGRESAPP_DMG_URL"))…"
    local dmg="/tmp/postgresapp-$$.dmg"
    curl -fsSL -o "$dmg" "$POSTGRESAPP_DMG_URL"
    info "Monto il DMG…"
    local mountpoint
    mountpoint="$(hdiutil attach -nobrowse -quiet "$dmg" | tail -1 | awk -F'\t' '{print $NF}')"
    if [[ -z "$mountpoint" || ! -d "$mountpoint/Postgres.app" ]]; then
      err "Mount fallito o Postgres.app non trovato nel DMG."
      hdiutil detach "$mountpoint" -quiet 2>/dev/null || true
      rm -f "$dmg"
      exit 1
    fi
    info "Copio Postgres.app in /Applications…"
    cp -R "$mountpoint/Postgres.app" /Applications/
    hdiutil detach "$mountpoint" -quiet
    rm -f "$dmg"
    ok "Postgres.app installato"
  fi
  # Avvia Postgres.app (popola anche il menu-bar)
  info "Avvio Postgres.app…"
  open -ga Postgres.app
  sleep 2
}

# ─── Step 3: Pacchetti (Node, PostgreSQL, git) ──────────────────────────────
step "3/8 — Node + PostgreSQL + git"
if [[ $SKIP_BREW -eq 1 ]]; then
  warn "Skip install pacchetti (--skip-brew)"
elif [[ $NO_BREW -eq 1 ]]; then
  # NO-BREW: fnm per Node, Postgres.app per Postgres, git da Xcode CLT
  install_node_via_fnm
  install_postgres_via_app

  # PATH per le binarie di Postgres.app (psql, createdb, ecc.)
  PG_BIN="/Applications/Postgres.app/Contents/Versions/${PG_VERSION}/bin"
  if [[ ! -d "$PG_BIN" ]]; then
    # Fallback: alcune versioni hanno la cartella "latest" simbolica
    PG_BIN="/Applications/Postgres.app/Contents/Versions/latest/bin"
  fi
  if [[ -d "$PG_BIN" && ":$PATH:" != *":$PG_BIN:"* ]]; then
    info "Aggiungo $PG_BIN al PATH della sessione corrente"
    export PATH="$PG_BIN:$PATH"
    if ! grep -q "Postgres.app.*bin" "${HOME}/.zshrc" 2>/dev/null; then
      cat >>"${HOME}/.zshrc" <<ZSHRC

# Cadenza setup-macos: PATH per Postgres.app
export PATH="$PG_BIN:\$PATH"
ZSHRC
      info "Aggiunto PATH Postgres.app al tuo ~/.zshrc (alla prossima shell)"
    fi
  fi
  ok "git presente con Xcode CLT: $(git --version)"
else
  # MODALITÀ HOMEBREW (default)
  ensure_brew_pkg "node@${NODE_VERSION}"
  ensure_brew_pkg "postgresql@${PG_VERSION}"
  ensure_brew_pkg "git"

  if [[ $MINIMAL -eq 0 ]]; then
    ensure_brew_pkg "openssl@3"      # serve per generazione secret
    ensure_brew_pkg "jq"             # utility json (consigliata per debug)
  fi

  # Node@N non è linkato per default su brew (serve per evitare conflitti
  # con node "principale"). Lo linkiamo forzosamente nel PATH brew.
  if [[ $DRY_RUN -eq 0 ]]; then
    if ! brew list --formula | grep -q "^node\$"; then
      brew link --overwrite --force "node@${NODE_VERSION}" 2>/dev/null || true
    fi
  fi

  # Postgres@N non è "currently linked": il binario psql sta in
  # /opt/homebrew/opt/postgresql@N/bin che NON è nel PATH default.
  # Aggiungo un suggerimento per ~/.zshrc.
  PG_BIN="$BREW_PREFIX/opt/postgresql@${PG_VERSION}/bin"
  if [[ -d "$PG_BIN" && ":$PATH:" != *":$PG_BIN:"* ]]; then
    info "Aggiungo $PG_BIN al PATH della sessione corrente"
    export PATH="$PG_BIN:$PATH"
    if ! grep -q "postgresql@${PG_VERSION}/bin" "${HOME}/.zshrc" 2>/dev/null; then
      info "Suggerimento: aggiungi questa riga al tuo ~/.zshrc per le sessioni future:"
      echo "        export PATH=\"$PG_BIN:\$PATH\""
    fi
  fi
fi

# ─── Step 4: Avvio servizio PostgreSQL ───────────────────────────────────────
step "4/8 — Servizio PostgreSQL"
if [[ $SKIP_DB -eq 1 ]]; then
  warn "Skip avvio PostgreSQL (--skip-db)"
elif [[ $NO_BREW -eq 1 ]]; then
  # NO-BREW: Postgres.app gestisce l'avvio dal suo menu bar.
  # Verifico che stia rispondendo su :5432.
  if [[ $DRY_RUN -eq 0 ]]; then
    for _ in {1..15}; do
      if pg_isready -q 2>/dev/null; then break; fi
      sleep 1
    done
    if pg_isready -q 2>/dev/null; then
      ok "PostgreSQL in ascolto su :5432 (Postgres.app)"
    else
      warn "Postgres.app non risponde su :5432. Aprilo a mano: open -a Postgres"
      info "Suggerimento: nel menu-bar Postgres.app → 'Start' sull'istanza ${PG_VERSION}"
    fi
  else
    plan "DRY-RUN: open -a Postgres.app + pg_isready check"
  fi
else
  # MODALITÀ HOMEBREW
  if [[ $DRY_RUN -eq 0 ]]; then
    if brew services list 2>/dev/null | grep -qE "^postgresql@${PG_VERSION}\s+started"; then
      ok "PostgreSQL ${PG_VERSION} già in esecuzione"
    else
      info "Avvio postgresql@${PG_VERSION} come servizio brew…"
      brew services start "postgresql@${PG_VERSION}"
      sleep 3
      ok "Servizio avviato"
    fi
  else
    plan "DRY-RUN: brew services start postgresql@${PG_VERSION}"
  fi
fi

# ─── Step 5: Database e utente ───────────────────────────────────────────────
step "5/8 — Database \"$DB_NAME\" e utente \"$DB_USER\""
if [[ $SKIP_DB -eq 1 ]]; then
  warn "Skip setup database (--skip-db)"
else
  # Genera password se non passata
  if [[ -z "$DB_PASSWORD" ]]; then
    if [[ -f backend/.env ]] && grep -q "^DB_PASSWORD=" backend/.env; then
      DB_PASSWORD="$(grep "^DB_PASSWORD=" backend/.env | cut -d= -f2-)"
      info "DB_PASSWORD letto da backend/.env esistente"
    else
      DB_PASSWORD="$(openssl rand -hex 16)"
      info "DB_PASSWORD generata: $DB_PASSWORD (verrà salvata in backend/.env)"
    fi
  fi

  if [[ $RESET_DB -eq 1 ]]; then
    if confirm "DISTRUTTIVO: cancellare il database $DB_NAME e ricrearlo?"; then
      run_eval "psql -d postgres -c 'DROP DATABASE IF EXISTS \"$DB_NAME\";' >/dev/null"
      ok "Database $DB_NAME droppato"
    else
      warn "Reset annullato"
      RESET_DB=0
    fi
  fi

  if [[ $DRY_RUN -eq 0 ]]; then
    # Crea utente se non esiste
    if psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
      ok "Utente Postgres \"$DB_USER\" già presente"
      # Aggiorna la password (per sicurezza, in caso .env e DB siano disallineati)
      psql -d postgres -c "ALTER USER \"$DB_USER\" WITH PASSWORD '$DB_PASSWORD';" >/dev/null
    else
      info "Creo utente \"$DB_USER\"…"
      psql -d postgres -c "CREATE USER \"$DB_USER\" WITH PASSWORD '$DB_PASSWORD' CREATEDB;" >/dev/null
      ok "Utente creato"
    fi

    # Crea DB se non esiste
    if psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
      ok "Database \"$DB_NAME\" già presente"
    else
      info "Creo database \"$DB_NAME\" (owner: $DB_USER)…"
      createdb -O "$DB_USER" "$DB_NAME"
      ok "Database creato"
    fi
  else
    plan "DRY-RUN: psql … CREATE USER + CREATE DATABASE"
  fi
fi

# ─── Step 6: backend/.env ────────────────────────────────────────────────────
step "6/8 — Configurazione backend/.env"
if [[ $SKIP_ENV -eq 1 ]]; then
  warn "Skip setup .env (--skip-env)"
elif [[ -f backend/.env ]]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  if [[ $DRY_RUN -eq 0 ]]; then
    cp backend/.env "backend/.env.bak-$TS"
    ok "backend/.env esistente preservato (backup: backend/.env.bak-$TS)"
  else
    plan "DRY-RUN: backup backend/.env → backend/.env.bak-$TS"
  fi
  info "Verifica manualmente che DB_NAME, DB_USER, DB_PASSWORD siano coerenti"
else
  info "Genero backend/.env con valori di sviluppo…"
  if [[ $DRY_RUN -eq 0 ]]; then
    JWT_SECRET="$(openssl rand -hex 32)"
    SESSION_SECRET="$(openssl rand -hex 32)"
    ENCRYPTION_KEY="$(openssl rand -hex 32)"
    ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '=' | head -c 16)"

    cat > backend/.env <<ENV
# ===================================
# Server (dev)
# ===================================
PORT=3000
NODE_ENV=development
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

# ===================================
# Database
# ===================================
DB_DIALECT=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_SSL=false
DB_SYNC_MODE=safe

# ===================================
# Sicurezza
# ===================================
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=2h
SESSION_SECRET=$SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
BCRYPT_COST=10

# ===================================
# Admin di default (creato dal seeder al primo avvio)
# ===================================
DEFAULT_ADMIN_EMAIL=admin@cadenza.local
DEFAULT_ADMIN_PASSWORD=$ADMIN_PASSWORD
DEFAULT_ADMIN_FIRSTNAME=Admin
DEFAULT_ADMIN_LASTNAME=Locale

# ===================================
# 2FA email
# ===================================
TWO_FA_TTL_MIN=10
TWO_FA_MAX_ATTEMPTS=5
TWO_FA_GRACE_DAYS=7
TWO_FA_ISSUER=Cadenza · Dev locale

# ===================================
# SMTP (dev: lasciato disabilitato — log nel terminale)
# ===================================
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM=

# ===================================
# Check-in & ghost booking
# ===================================
CHECKIN_EARLY_MINUTES=5
GHOST_GRACE_MINUTES=15

# ===================================
# Backup automatico (disabilitato in dev)
# ===================================
BACKUP_AUTO_ENABLED=false
ENV
    chmod 600 backend/.env
    ok "backend/.env creato"
    info "Admin di default: admin@cadenza.local · password: $ADMIN_PASSWORD"
    info "Cambia la password al primo login."
  else
    plan "DRY-RUN: scriverei backend/.env con secret casuali"
  fi
fi

# ─── Step 7: npm install ─────────────────────────────────────────────────────
step "7/8 — Dipendenze npm (root + backend + frontend)"
if [[ $SKIP_NPM -eq 1 ]]; then
  warn "Skip npm install (--skip-npm)"
else
  if ! command -v node >/dev/null 2>&1; then
    err "Node non disponibile nel PATH. Riavvia il terminale o esegui:"
    err "  eval \"\$(${BREW_PREFIX}/bin/brew shellenv)\""
    exit 1
  fi
  NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  if [[ "$NODE_MAJOR" -lt "$NODE_VERSION" ]]; then
    warn "Node $(node -v) installato, ma il progetto richiede ≥ $NODE_VERSION"
  else
    ok "Node $(node -v) compatibile"
  fi

  for dir in . backend frontend; do
    info "npm install in $dir/…"
    if [[ $DRY_RUN -eq 0 ]]; then
      ( cd "$dir" && npm install --silent --no-audit --no-fund )
    else
      plan "DRY-RUN: cd $dir && npm install"
    fi
  done
  ok "Dipendenze installate"
fi

# ─── Step 8: Schema DB iniziale + seed ───────────────────────────────────────
step "8/8 — Sync schema DB iniziale + seed"
if [[ $SKIP_DB -eq 1 || $SKIP_NPM -eq 1 ]]; then
  warn "Skip seed (richiede --skip-db e --skip-npm entrambi falsi)"
else
  if [[ $DRY_RUN -eq 0 ]]; then
    info "Sincronizzo lo schema (DB_SYNC_MODE=alter, una tantum)…"
    # Avvia il server in background, attende sync, poi lo killa.
    # Il seeder si esegue automaticamente al boot.
    rm -f /tmp/cadenza-sync.log
    (
      cd backend
      DB_SYNC_MODE=alter node server.js >/tmp/cadenza-sync.log 2>&1
    ) &
    SYNC_PID=$!
    # Wait up to 30s for "In ascolto" che indica sync completato
    for _ in {1..30}; do
      if grep -q "In ascolto" /tmp/cadenza-sync.log 2>/dev/null; then
        break
      fi
      sleep 1
    done
    kill "$SYNC_PID" 2>/dev/null || true
    wait "$SYNC_PID" 2>/dev/null || true
    if grep -q "In ascolto" /tmp/cadenza-sync.log 2>/dev/null; then
      ok "Schema sincronizzato e admin di default seedato"
    else
      warn "Sync schema potrebbe essere incompleto. Controlla: tail /tmp/cadenza-sync.log"
    fi
  else
    plan "DRY-RUN: DB_SYNC_MODE=alter node backend/server.js (sync schema + seed)"
  fi
fi

# ─── Riepilogo finale ────────────────────────────────────────────────────────
echo
bold "✅ Setup completato!"
echo
green "Per avviare l'app in dev:"
echo "    npm run dev"
echo
green "Per il solo backend o solo frontend:"
echo "    npm run dev:backend"
echo "    npm run dev:frontend"
echo
green "Cadenza sarà disponibile su:"
echo "    http://localhost:5173    (frontend dev con HMR)"
echo "    http://localhost:3000    (backend API + frontend buildato)"
echo
if [[ -f backend/.env ]] && grep -q "^DEFAULT_ADMIN_PASSWORD=" backend/.env; then
  ADMIN_PASSWORD="$(grep "^DEFAULT_ADMIN_PASSWORD=" backend/.env | cut -d= -f2-)"
  green "Login admin di default:"
  echo "    email:    admin@cadenza.local"
  echo "    password: $ADMIN_PASSWORD"
  echo
  yellow "  ⚠ Cambia la password al primo login."
fi
echo
green "Comandi utili:"
echo "    npm test                            # full test suite"
echo "    npm --prefix backend run seed       # re-seed admin + livelli + regole"
if [[ $NO_BREW -eq 1 ]]; then
  echo "    open -a Postgres                    # apri Postgres.app (gestisci start/stop dal menu bar)"
  echo "    fnm list                            # versioni Node installate via fnm"
  echo "    fnm use ${NODE_VERSION}                         # cambia versione Node corrente"
else
  echo "    brew services list                  # stato servizi (postgres ecc.)"
  echo "    brew services stop postgresql@${PG_VERSION}  # ferma postgres"
fi
echo
[[ $DRY_RUN -eq 1 ]] && yellow "  ✱ DRY-RUN: nessuna modifica è stata davvero applicata. Rilancia senza --dry-run."
