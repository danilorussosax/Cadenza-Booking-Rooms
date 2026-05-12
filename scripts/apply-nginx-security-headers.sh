#!/usr/bin/env bash
# =============================================================================
# apply-nginx-security-headers.sh  (v2 — snippet + include strategy)
#
# Inietta in modo robusto i security header (HSTS/CSP/X-Frame/COOP/etc) nei
# server block Cadenza, AGGIRANDO il bug di nginx add_header inheritance:
# se un location { ... } ha già `add_header ...`, NON eredita gli add_header
# del server { ... }. Soluzione: un file snippet condiviso, incluso in OGNI
# location che ha già add_header.
#
# Cosa fa:
#   1. Crea/sovrascrive /etc/nginx/snippets/cadenza-security-headers.conf
#      (single source of truth: per cambiare gli header, modifica solo
#      questo file e fai reload).
#   2. Pulisce eventuali blocchi marker `=== CADENZA SECURITY HEADERS … === END`
#      lasciati da run precedenti (cleanup idempotente).
#   3. Patcha il vhost: inserisce `include snippets/cadenza-security-headers.conf;`
#      SOPRA ogni `add_header Cache-Control` nei server block che:
#         (a) hanno `listen 443 ssl`, e
#         (b) hanno `server_name` contenente `prenotazioneaule.it`.
#      Idempotente: skip se l'include è già presente sopra.
#   4. nginx -t + reload + curl di verifica.
#   5. Rollback automatico se nginx -t fallisce.
#
# Uso:
#   sudo bash scripts/apply-nginx-security-headers.sh
#   sudo bash scripts/apply-nginx-security-headers.sh --dry-run
#   sudo bash scripts/apply-nginx-security-headers.sh /etc/nginx/sites-enabled/<altro>
# =============================================================================

set -euo pipefail

DRY_RUN=0
VHOST="/etc/nginx/sites-enabled/cadenza"
SNIPPET_DIR="/etc/nginx/snippets"
SNIPPET="${SNIPPET_DIR}/cadenza-security-headers.conf"
INCLUDE_DIRECTIVE='include snippets/cadenza-security-headers.conf;'

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

TS=$(date +%Y%m%d-%H%M%S)
BACKUP="${VHOST}.bak-${TS}"

if [[ -t 1 ]]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_BOLD=$'\033[1m'; C_END=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_BOLD=""; C_END=""
fi
say()  { printf "%s\n" "$*"; }
ok()   { say "${C_OK}✓${C_END} $*"; }
warn() { say "${C_WARN}⚠${C_END} $*"; }
err()  { say "${C_ERR}✗${C_END} $*" >&2; }

if [[ $EUID -ne 0 && $DRY_RUN -eq 0 ]]; then
  err "Questo script richiede sudo. Esempio: sudo bash $0"
  exit 1
fi

if [[ ! -f "$VHOST" ]]; then
  err "File non trovato: $VHOST"
  exit 1
fi

# ===== Step 1: scrive lo snippet =============================================
SNIPPET_CONTENT=$(cat <<'EOF'
# /etc/nginx/snippets/cadenza-security-headers.conf
# Generato da scripts/apply-nginx-security-headers.sh.
# Include questo file in OGNI location che ha già `add_header ...` (nginx
# non eredita gli add_header del server al location se questo ne ha già uno).
#
# Per modificare la policy: edit qui + `sudo nginx -t && sudo systemctl reload nginx`.
# Tutti i siti che includono questo snippet otterranno la nuova policy.

add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.googleusercontent.com https://*.microsoftonline.com; connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; worker-src 'self' blob:; manifest-src 'self'; report-uri /api/csp-report; report-to cadenza-csp; upgrade-insecure-requests" always;
add_header Reporting-Endpoints 'cadenza-csp="/api/csp-report"' always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;
add_header Permissions-Policy "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), screen-wake-lock=(), usb=(), xr-spatial-tracking=()" always;
EOF
)

if [[ $DRY_RUN -eq 0 ]]; then
  mkdir -p "$SNIPPET_DIR"
  printf '%s\n' "$SNIPPET_CONTENT" > "$SNIPPET"
  ok "Snippet scritto: $SNIPPET"
else
  say "DRY-RUN: scriverei $SNIPPET ($(printf '%s' "$SNIPPET_CONTENT" | wc -l) righe)"
fi

# ===== Step 2 + 3: pulizia marker + patch include via awk ====================
TMP_OUT=$(mktemp)
cleanup() { rm -f "$TMP_OUT" 2>/dev/null || true; }
trap cleanup EXIT

awk -v INC="$INCLUDE_DIRECTIVE" '
function get_indent(line) {
  match(line, /^[[:space:]]*/)
  return substr(line, 1, RLENGTH)
}
function brace_balance(s,    tmp_open, tmp_close, line_copy) {
  # Conta { e } in $0 considerando line state per gestire nesting
  line_copy = s
  tmp_open = gsub(/\{/, "{", line_copy)
  line_copy = s
  tmp_close = gsub(/\}/, "}", line_copy)
  return tmp_open - tmp_close
}

# Inizio server block (al livello top)
!in_block && /^[[:space:]]*server[[:space:]]*\{/ {
  in_block = 1
  brace_depth = brace_balance($0)
  has_443 = 0
  has_domain = 0
  n = 0
  delete lines
  lines[++n] = $0
  next
}

# Riga dentro al server block. Aggiorno brace_depth riga per riga.
# Quando brace_depth ritorna a 0, è la chiusura del server block top-level.
in_block {
  lines[++n] = $0
  brace_depth += brace_balance($0)
  if ($0 ~ /listen[[:space:]]+(\[::\]:)?443[[:space:]]+ssl/) has_443 = 1
  if ($0 ~ /server_name[[:space:]].*prenotazioneaule\.it/) has_domain = 1

  if (brace_depth > 0) { next }

  # brace_depth == 0 → fine del server block top-level
  is_target = (has_443 && has_domain)

  # Re-emit del blocco. Se è target:
  #  - skip righe che fanno parte di un blocco "=== CADENZA SECURITY HEADERS … === END"
  #  - prima di ogni "add_header Cache-Control", inserisci INCLUDE (se non già lì)
  skip = 0
  for (i = 1; i <= n; i++) {
    line = lines[i]

    if (is_target) {
      # Cleanup: salta blocco marker (inclusi commenti ═════ adiacenti)
      if (line ~ /=== CADENZA SECURITY HEADERS/) {
        skip = 1
      }
      if (skip) {
        if (line ~ /=== END CADENZA SECURITY HEADERS/) {
          skip = 0
        }
        continue
      }
      # Salta commenti ═════ orfani (header decorativo del vecchio blocco)
      if (line ~ /^[[:space:]]*#[[:space:]]*═+[[:space:]]*$/) continue
      # Salta linee orfane di header lasciate dal vecchio fix (add_header senza
      # marker, riconoscibili perché replicano i nostri header)
      if (line ~ /add_header[[:space:]]+Strict-Transport-Security/) continue
      if (line ~ /add_header[[:space:]]+Content-Security-Policy/) continue
      if (line ~ /add_header[[:space:]]+Reporting-Endpoints/) continue
      if (line ~ /add_header[[:space:]]+X-Frame-Options/) continue
      if (line ~ /add_header[[:space:]]+X-Content-Type-Options/) continue
      if (line ~ /add_header[[:space:]]+Referrer-Policy/) continue
      if (line ~ /add_header[[:space:]]+Cross-Origin-Opener-Policy/) continue
      if (line ~ /add_header[[:space:]]+Cross-Origin-Resource-Policy/) continue
      if (line ~ /add_header[[:space:]]+Permissions-Policy/) continue
      # Commenti relativi al blocco vecchio
      if (line ~ /Allineati a Express helmet/) continue
      if (line ~ /always.*garantisce.*4xx\/5xx/) continue
      if (line ~ /Per location proxy_pass al backend, Express/) continue
      if (line ~ /potresti vedere duplicati/) continue
      if (line ~ /usa.*proxy_hide_header.*o sposta gli/) continue

      # Caso A: location one-liner del tipo `location ... { add_header ...; }`
      # → rewrite della riga inserendo include subito dopo la `{`
      if (line ~ /^[[:space:]]*location.*\{[^}]*add_header[^}]*Cache-Control[^}]*\}[[:space:]]*$/) {
        if (line !~ /include[[:space:]]+snippets\/cadenza-security-headers\.conf/) {
          sub(/\{[[:space:]]*/, "{ " INC " ", line)
          patched++
        }
        print line
        continue
      }

      # Caso B: add_header Cache-Control su riga propria (location multi-line)
      # → insert include sulla riga sopra
      if (line ~ /^[[:space:]]*add_header[[:space:]]+Cache-Control/) {
        already = 0
        for (j = i - 1; j >= 1; j--) {
          if (lines[j] ~ /^[[:space:]]*$/ || lines[j] ~ /^[[:space:]]*#/) continue
          if (lines[j] ~ /include[[:space:]]+snippets\/cadenza-security-headers\.conf/) {
            already = 1
          }
          break
        }
        if (!already) {
          indent = get_indent(line)
          print indent INC
          patched++
        }
      }
    }
    print line
  }

  in_block = 0
  next
}

# Fuori da server block
{ print }

END {
  printf "Patched: %d add_header Cache-Control con include\n", (patched ? patched : 0) > "/dev/stderr"
}
' "$VHOST" > "$TMP_OUT"

# ===== Dry-run: stampa diff ==================================================
if [[ $DRY_RUN -eq 1 ]]; then
  say ""
  say "${C_BOLD}DRY-RUN — diff:${C_END}"
  diff -u "$VHOST" "$TMP_OUT" || true
  say ""
  ok "Dry-run terminato. Nessun file modificato. Snippet non scritto."
  exit 0
fi

# ===== Backup + sostituzione =================================================
cp "$VHOST" "$BACKUP"
ok "Backup vhost: $BACKUP"

if cmp -s "$VHOST" "$TMP_OUT"; then
  warn "Nessuna modifica al vhost necessaria (già patchato)."
else
  cp "$TMP_OUT" "$VHOST"
  ok "Vhost aggiornato: $VHOST"
fi

# ===== Step 4: nginx -t + reload ============================================
say ""
say "→ Test sintassi nginx..."
if nginx -t 2>&1; then
  say ""
  say "→ Reload nginx..."
  systemctl reload nginx
  ok "Reload OK"
else
  err "nginx -t FALLITO. Rollback automatico..."
  cp "$BACKUP" "$VHOST"
  if nginx -t >/dev/null 2>&1; then
    ok "Rollback completato"
  else
    err "ROLLBACK FALLITO. Recupero manuale:"
    say "  sudo cp '$BACKUP' '$VHOST' && sudo nginx -t && sudo systemctl reload nginx"
  fi
  exit 1
fi

# ===== Step 5: verifica curl =================================================
say ""
say "${C_BOLD}═══════════════════════════════════════════════════════════════${C_END}"
say "${C_BOLD} VERIFICA HEADER (curl https://prenotazioneaule.it/)${C_END}"
say "${C_BOLD}═══════════════════════════════════════════════════════════════${C_END}"
if command -v curl >/dev/null 2>&1; then
  curl -sI "https://prenotazioneaule.it/?nocache=${TS}" 2>/dev/null | \
    grep -i -e strict-transport -e content-security -e x-frame -e x-content \
            -e referrer -e permissions -e cross-origin -e reporting || \
    warn "(curl ha funzionato ma nessun header matcha — controllo problema)"
else
  warn "curl non disponibile, verifica manuale."
fi

say ""
ok "Fatto. Backup: $BACKUP"
say "  Rilancia gli scanner online per i nuovi voti:"
say "    https://securityheaders.com/?q=prenotazioneaule.it"
say "    https://observatory.mozilla.org/analyze/prenotazioneaule.it"
say "    https://www.ssllabs.com/ssltest/analyze.html?d=prenotazioneaule.it"
say "    https://hstspreload.org/?domain=prenotazioneaule.it"
