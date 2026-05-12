#!/usr/bin/env bash
# =============================================================================
# apply-nginx-security-headers.sh
#
# Inietta nei server block nginx di Cadenza i security header allineati a
# Express helmet (HSTS, CSP, X-Frame-Options, COOP, Permissions-Policy, ecc.).
#
# Target: tutti i server block che soddisfano TUTTE queste condizioni:
#   - listen 443 ssl (HTTPS, non HTTP redirect)
#   - server_name che include "prenotazioneaule.it" (con o senza www/rota)
#
# Caratteristiche:
#   - Idempotente: skip se il marker `=== CADENZA SECURITY HEADERS` è presente
#   - Backup automatico con timestamp prima di toccare il file
#   - nginx -t dopo l'edit; rollback automatico se la sintassi fallisce
#   - reload nginx solo a verifica passata
#   - verifica curl finale dei header presenti
#   - --dry-run per stampare il diff senza scrivere
#
# Uso (sul VPS):
#   sudo bash scripts/apply-nginx-security-headers.sh
#   sudo bash scripts/apply-nginx-security-headers.sh /etc/nginx/sites-enabled/<altro>
#   sudo bash scripts/apply-nginx-security-headers.sh --dry-run
#
# Rollback manuale: usa il file .bak-<TS> creato a fianco del vhost.
# =============================================================================

set -euo pipefail

# ===== Parametri =============================================================
DRY_RUN=0
VHOST="/etc/nginx/sites-enabled/cadenza"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,/^# ===/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) VHOST="$1"; shift ;;
  esac
done

MARKER="# === CADENZA SECURITY HEADERS"
TS=$(date +%Y%m%d-%H%M%S)
BACKUP="${VHOST}.bak-${TS}"

# Colori (no-op se non TTY)
if [[ -t 1 ]]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_BOLD=$'\033[1m'; C_END=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_BOLD=""; C_END=""
fi
say()  { printf "%s\n" "$*"; }
ok()   { say "${C_OK}✓${C_END} $*"; }
warn() { say "${C_WARN}⚠${C_END} $*"; }
err()  { say "${C_ERR}✗${C_END} $*" >&2; }

# ===== Pre-check =============================================================
if [[ $EUID -ne 0 && $DRY_RUN -eq 0 ]]; then
  err "Questo script richiede sudo (o esegui come root)."
  say "  Esempio: ${C_BOLD}sudo bash $0${C_END}"
  exit 1
fi

if [[ ! -f "$VHOST" ]]; then
  err "File non trovato: $VHOST"
  say "  Usa: sudo bash $0 [path-al-vhost-nginx]"
  exit 1
fi

if grep -q "$MARKER" "$VHOST"; then
  count=$(grep -c "$MARKER" "$VHOST")
  warn "Security header già presenti ($count marker trovati in $VHOST)."
  say "  Niente da fare. Per riapplicare: rimuovi manualmente i blocchi marker o usa un backup pulito."
  exit 0
fi

# ===== Prepara header block in file temp =====================================
TMP_HEADER=$(mktemp)
TMP_OUT=$(mktemp)
cleanup() { rm -f "$TMP_HEADER" "$TMP_OUT" 2>/dev/null || true; }
trap cleanup EXIT

cat > "$TMP_HEADER" <<'EOF'

    # ═══════════════════════════════════════════════════════════════════════
    # === CADENZA SECURITY HEADERS (auto-inserted) ===
    # Allineati a Express helmet (backend/app.js). `always` garantisce
    # emissione anche su response 4xx/5xx servite da nginx (file statici).
    # Per location proxy_pass al backend, Express emette gli stessi header:
    # potresti vedere duplicati (innocuo — browser usa il primo valore).
    # ═══════════════════════════════════════════════════════════════════════
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.googleusercontent.com https://*.microsoftonline.com; connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; worker-src 'self' blob:; manifest-src 'self'; report-uri /api/csp-report; report-to cadenza-csp; upgrade-insecure-requests" always;
    add_header Reporting-Endpoints 'cadenza-csp="/api/csp-report"' always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;
    add_header Permissions-Policy "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), screen-wake-lock=(), usb=(), xr-spatial-tracking=()" always;
    # === END CADENZA SECURITY HEADERS ===

EOF

# ===== Processing awk: identifica server block target e inserisce ============
# Logica:
#   - Buffer le righe di ogni server { ... } in memoria.
#   - A fine blocco, se vediamo SIA `listen 443 ssl` SIA `server_name *prenotazioneaule.it*`,
#     re-emettiamo il buffer inserendo l'header subito DOPO la riga server_name.
#   - Altrimenti emettiamo il buffer invariato.
awk -v HEADER_FILE="$TMP_HEADER" '
function emit_header(   line) {
  while ((getline line < HEADER_FILE) > 0) print line
  close(HEADER_FILE)
}

/^[[:space:]]*server[[:space:]]*\{/ {
  in_block = 1
  has_443 = 0
  has_domain = 0
  n = 0
  delete lines
  lines[++n] = $0
  next
}

in_block && /^[[:space:]]*\}[[:space:]]*$/ {
  lines[++n] = $0
  do_insert = (has_443 && has_domain)
  inserted = 0
  for (i = 1; i <= n; i++) {
    print lines[i]
    if (do_insert && !inserted && lines[i] ~ /server_name[[:space:]].*prenotazioneaule\.it/) {
      emit_header()
      inserted = 1
      modified++
    }
  }
  in_block = 0
  next
}

in_block {
  lines[++n] = $0
  if ($0 ~ /listen[[:space:]]+(\[::\]:)?443[[:space:]]+ssl/) has_443 = 1
  if ($0 ~ /server_name[[:space:]].*prenotazioneaule\.it/) has_domain = 1
  next
}

{ print }

END {
  if (modified == 0) {
    print "ERROR: nessun server block con listen 443 ssl + server_name prenotazioneaule.it trovato." > "/dev/stderr"
    exit 2
  }
  printf "Server block modificati: %d\n", modified > "/dev/stderr"
}
' "$VHOST" > "$TMP_OUT"

# ===== Dry-run: stampa diff e stop ===========================================
if [[ $DRY_RUN -eq 1 ]]; then
  say ""
  say "${C_BOLD}DRY-RUN — diff fra l'attuale e il futuro:${C_END}"
  say ""
  if command -v diff >/dev/null 2>&1; then
    diff -u "$VHOST" "$TMP_OUT" || true
  else
    say "(diff non disponibile, scarto silenzioso)"
  fi
  say ""
  ok "Dry-run terminato. Nessun file modificato."
  exit 0
fi

# ===== Backup =================================================================
cp "$VHOST" "$BACKUP"
ok "Backup creato: $BACKUP"

# ===== Sostituisce il file ====================================================
cp "$TMP_OUT" "$VHOST"
ok "File aggiornato: $VHOST"

# ===== nginx -t ===============================================================
say ""
say "→ Test sintassi nginx..."
if nginx -t 2>&1; then
  say ""
  say "→ Reload nginx..."
  systemctl reload nginx
  ok "Reload completato"
else
  err "nginx -t FALLITO. Eseguo rollback automatico..."
  cp "$BACKUP" "$VHOST"
  if nginx -t >/dev/null 2>&1; then
    ok "Rollback completato (config originale ripristinata)"
  else
    err "ROLLBACK ANCHE FALLITO. Recupero manuale necessario:"
    say "  sudo cp '$BACKUP' '$VHOST' && sudo nginx -t && sudo systemctl reload nginx"
  fi
  exit 1
fi

# ===== Verifica via curl ======================================================
say ""
say "${C_BOLD}═══════════════════════════════════════════════════════════════${C_END}"
say "${C_BOLD} VERIFICA HEADER (curl https://prenotazioneaule.it/)${C_END}"
say "${C_BOLD}═══════════════════════════════════════════════════════════════${C_END}"
if command -v curl >/dev/null 2>&1; then
  curl -sI "https://prenotazioneaule.it/" 2>/dev/null | \
    grep -iE "^(strict-transport|content-security|x-frame|x-content|referrer|permissions|cross-origin|reporting)" || \
    warn "(curl ha funzionato ma nessun header matcha — controlla manualmente)"
else
  warn "curl non disponibile, verifica manuale necessaria."
fi

say ""
ok "Fatto. Backup disponibile in: $BACKUP"
say "  Rilancia gli scanner online per i nuovi voti:"
say "    https://securityheaders.com/?q=prenotazioneaule.it"
say "    https://observatory.mozilla.org/analyze/prenotazioneaule.it"
say "    https://www.ssllabs.com/ssltest/analyze.html?d=prenotazioneaule.it"
say "    https://hstspreload.org/?domain=prenotazioneaule.it"
